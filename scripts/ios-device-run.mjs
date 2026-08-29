import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { resolve } from "node:path"
import { spawn, spawnSync } from "node:child_process"

const projectRoot = resolve(import.meta.dirname, "..")
const defaultPorts = [1420, 1421]
const bundleIdentifier = "com.xmly.swell-note"
const generatedIosInfoPlist = resolve(
  projectRoot,
  "src-tauri/gen/apple/swell-note_iOS/Info.plist",
)

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: projectRoot, encoding: "utf8", ...options })
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function fail(message) {
  throw new Error(message)
}

function readPhysicalDevices() {
  const result = run("xcrun", ["xcdevice", "list"])
  if (result.status !== 0) fail("无法读取 iOS 设备，请打开 Xcode 并确认手机已解锁、已信任此 Mac。")

  try {
    return JSON.parse(result.stdout).filter((device) =>
      device.simulator === false
      && device.available === true
      && String(device.platform ?? "").includes("iphoneos"),
    )
  } catch {
    fail("Xcode 返回了无法解析的设备列表。")
  }
}

function selectDevice(devices, preferredName) {
  if (preferredName) {
    const matched = devices.find((device) =>
      device.name === preferredName || device.identifier === preferredName,
    )
    if (matched) return matched
  }

  if (devices.length === 1) return devices[0]
  const names = devices.map((device) => device.name).join("、")
  fail(preferredName
    ? `未找到设备“${preferredName}”。当前可用设备：${names || "无"}`
    : `检测到多台设备：${names}。请使用 --device 指定目标设备。`)
}

function validateEnvironment() {
  if (process.platform !== "darwin") fail("iOS 真机安装只能在 macOS 上执行。")
  if (run("xcodebuild", ["-version"]).status !== 0) fail("未检测到完整 Xcode。")

  const identities = run("security", ["find-identity", "-v", "-p", "codesigning"])
  const identityCount = Number.parseInt(identities.stdout.match(/(\d+) valid identities found/)?.[1] ?? "0", 10)
  if (identityCount === 0) fail("缺少 Apple Development 签名，请先在 Xcode 登录 Apple ID。")
}

function runVisible(command, args, errorMessage) {
  const result = run(command, args, { stdio: "inherit" })
  if (result.status !== 0) fail(errorMessage)
}

function buildNumber() {
  // Tauri 将构建号解析为 u32；Unix 秒既保持递增，也不会超出允许范围。
  return String(Math.floor(Date.now() / 1000))
}

function preserveFile(path) {
  if (!existsSync(path)) return () => {}
  const original = readFileSync(path)
  return () => writeFileSync(path, original)
}

function findBuiltApp() {
  const candidates = [
    resolve(projectRoot, "src-tauri/gen/apple/build/swell-note_iOS.xcarchive/Products/Applications/Swell Note.app"),
    resolve(projectRoot, "src-tauri/gen/apple/build/Payload/Swell Note.app"),
  ]
  return candidates.find(existsSync)
}

function installRelease(device) {
  console.log(`✓ 目标设备：${device.name} (${device.modelName})`)
  console.log("✓ 安装模式：Release（资源内置，脱离电脑也能启动）")

  if (process.argv.includes("--dry-run")) {
    console.log("✓ 真机一键安装检查通过")
    return
  }

  const refreshIcons = process.argv.includes("--refresh-icons")
  if (refreshIcons) {
    console.log("\n[准备] 重新生成全平台图标…")
    runVisible("pnpm", ["icons"], "图标生成失败。")
  } else {
    console.log("\n[准备] 使用现有应用图标（如需更新请传入 --refresh-icons）")
  }

  console.log("\n[1/3] 构建 iOS Release 安装包…")
  const restoreInfoPlist = preserveFile(generatedIosInfoPlist)
  try {
    // 构建号只服务于本次产物；构建结束恢复生成文件，避免一次真机安装污染 Git 工作区。
    runVisible(
      "pnpm",
      ["tauri", "ios", "build", "--target", "aarch64", "--export-method", "debugging", "--build-number", buildNumber()],
      "iOS Release 构建失败，请检查上方 Xcode 签名日志。",
    )
  } finally {
    restoreInfoPlist()
  }

  const appPath = findBuiltApp()
  if (!appPath) fail("构建完成但没有找到 Swell Note.app。")

  console.log("\n[2/3] 覆盖安装到真机（保留本地数据）…")
  runVisible(
    "xcrun",
    ["devicectl", "device", "install", "app", "--device", device.identifier, appPath],
    "App 安装失败，请保持手机解锁并确认开发者模式已开启。",
  )

  console.log("\n[3/3] 启动 Swell Note…")
  const launch = run("xcrun", [
    "devicectl", "device", "process", "launch",
    "--device", device.identifier,
    "--terminate-existing",
    bundleIdentifier,
  ], { stdio: "inherit" })

  if (launch.status === 0) {
    console.log("\n✓ Release 已安装并启动，后续打开不依赖电脑开发服务。")
  } else {
    console.log("\n✓ Release 已安装；手机可能处于锁屏状态，请解锁后手动打开 App。")
  }
}

function selectLanAddress() {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => ({ address: address.address, name })),
  )

  // 真机调试优先走 Wi-Fi 常用网段，避免误选 VPN、USB 或 169.254 自分配地址。
  const score = ({ address, name }) => {
    if (name === "en0" && address.startsWith("192.168.")) return 0
    if (address.startsWith("192.168.")) return 1
    if (name === "en0" && address.startsWith("10.")) return 2
    if (address.startsWith("10.")) return 3
    if (address.startsWith("172.")) return 4
    if (address.startsWith("169.254.")) return 9
    return 5
  }

  return candidates.sort((left, right) => score(left) - score(right))[0]?.address
}

function listenerPids(port) {
  const result = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
  return result.stdout.trim().split("\n").filter(Boolean).map(Number)
}

function processCwd(pid) {
  const result = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
  return result.stdout.split("\n").find((line) => line.startsWith("n"))?.slice(1)
}

async function releaseProjectDevPorts() {
  const listeners = [...new Set(defaultPorts.flatMap(listenerPids))]
  for (const pid of listeners) {
    const cwd = processCwd(pid)
    if (cwd !== projectRoot) fail(`端口 1420/1421 被其他程序占用（PID ${pid}），请先关闭后重试。`)

    // 只终止工作目录明确属于当前项目的旧开发进程，避免误伤其他应用。
    console.log(`• 正在关闭旧的 Swell Note 开发进程（PID ${pid}）`)
    process.kill(pid, "SIGTERM")
  }

  if (listeners.length > 0) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (defaultPorts.every((port) => listenerPids(port).length === 0)) return
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
    }
    fail("旧开发进程未能释放端口 1420/1421，请手动关闭后重试。")
  }
}

async function runDevelopment(device) {
  const host = readOption("--host") ?? process.env.SWELL_IOS_HOST ?? selectLanAddress()
  if (!host) fail("无法识别局域网 IP，请使用 --host 手动指定。")

  console.log(`✓ 目标设备：${device.name} (${device.modelName})`)
  console.log(`✓ 调试地址：http://${host}:1420/`)

  if (process.argv.includes("--dry-run")) {
    console.log("✓ 真机调试检查通过")
    return
  }

  await releaseProjectDevPorts()
  console.log("• 正在构建、安装并启动 Swell Note 调试版…\n")
  const child = spawn("pnpm", ["tauri", "ios", "dev", "--host", host, device.name], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  })

  // 将退出信号传给 Tauri/Vite，确保下次执行不会遗留端口占用。
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal))
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
}

async function main() {
  validateEnvironment()
  const preferredDevice = readOption("--device") ?? process.env.SWELL_IOS_DEVICE
  const device = selectDevice(readPhysicalDevices(), preferredDevice)

  if (process.argv.includes("--dev")) await runDevelopment(device)
  else installRelease(device)
}

try {
  await main()
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
