import { spawnSync } from "node:child_process"

const checks = []

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" })
}

function addCheck(name, ok, detail) {
  checks.push({ detail, name, ok })
}

if (process.platform !== "darwin") {
  console.error("iOS 真机构建只能在 macOS 上执行。")
  process.exit(1)
}

const xcode = run("xcodebuild", ["-version"])
addCheck("Xcode", xcode.status === 0, xcode.status === 0 ? xcode.stdout.trim().replaceAll("\n", " · ") : "未安装完整 Xcode")

const rustTargets = run("rustup", ["target", "list", "--installed"])
const hasIosTarget = rustTargets.status === 0 && rustTargets.stdout.split("\n").includes("aarch64-apple-ios")
addCheck("Rust iOS target", hasIosTarget, hasIosTarget ? "aarch64-apple-ios" : "请运行 rustup target add aarch64-apple-ios")

const pods = run("pod", ["--version"])
addCheck("CocoaPods", pods.status === 0, pods.status === 0 ? `v${pods.stdout.trim()}` : "请运行 brew install cocoapods")

const identities = run("security", ["find-identity", "-v", "-p", "codesigning"])
const identityCount = Number.parseInt(identities.stdout.match(/(\d+) valid identities found/)?.[1] ?? "0", 10)
addCheck("Apple Development 签名", identityCount > 0, identityCount > 0 ? `${identityCount} 个有效身份` : "请在 Xcode > Settings > Accounts 登录 Apple ID，并让 Xcode 管理签名")

const devices = run("xcrun", ["xcdevice", "list"])
let physicalIosDevices = []
if (devices.status === 0) {
  try {
    physicalIosDevices = JSON.parse(devices.stdout).filter((device) =>
      device.simulator === false
      && device.available === true
      && String(device.platform ?? "").includes("iphoneos"),
    )
  } catch {
    physicalIosDevices = []
  }
}
addCheck(
  "已连接 iPhone / iPad",
  physicalIosDevices.length > 0,
  physicalIosDevices.length > 0
    ? physicalIosDevices.map((device) => device.name).join("、")
    : "连接设备、解锁并信任此 Mac，然后在 Xcode 的 Devices and Simulators 中确认可用",
)

for (const check of checks) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`)
}

if (checks.some((check) => !check.ok)) {
  console.error("\niOS 真机环境尚未就绪。首次配置请运行 pnpm dev:ios:open。")
  process.exit(1)
}

console.log("\niOS 真机环境已就绪。运行 pnpm dev:ios -- \"设备名称\" 安装并启动调试版。")
