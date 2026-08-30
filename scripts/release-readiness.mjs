import { readFileSync } from "node:fs"

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const tauriConfig = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"))
const cargo = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8")
const appleProject = readFileSync(new URL("../src-tauri/gen/apple/project.yml", import.meta.url), "utf8")
const versions = {
  cargo: cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
  ios: appleProject.match(/CFBundleShortVersionString:\s*([^\s]+)/)?.[1],
  package: packageJson.version,
  tauri: tauriConfig.version,
}
const expected = versions.package
const mismatches = Object.entries(versions).filter(([, version]) => version !== expected)
if (mismatches.length > 0) {
  throw new Error(`版本不一致：${mismatches.map(([name, version]) => `${name}=${version ?? "缺失"}`).join("，")}，期望 ${expected}`)
}

const secretGroups = {
  Android: ["ANDROID_KEY_BASE64", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"],
  iOS: ["IOS_CERTIFICATE", "IOS_CERTIFICATE_PASSWORD", "IOS_MOBILE_PROVISION", "KEYCHAIN_PASSWORD", "APPLE_TEAM_ID"],
  macOS: ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID", "KEYCHAIN_PASSWORD"],
  updater: ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "TAURI_UPDATER_PUBLIC_KEY"],
  Windows: ["WINDOWS_CERTIFICATE", "WINDOWS_CERTIFICATE_PASSWORD", "WINDOWS_CERTIFICATE_THUMBPRINT"],
}

const onlyArgument = process.argv.find((argument) => argument.startsWith("--only="))
const selectedGroup = onlyArgument?.slice("--only=".length)
if (selectedGroup && !Object.hasOwn(secretGroups, selectedGroup)) {
  throw new Error(`未知发布平台：${selectedGroup}；可选值为 ${Object.keys(secretGroups).join(", ")}`)
}
const groups = selectedGroup
  ? { [selectedGroup]: secretGroups[selectedGroup] }
  : secretGroups
const strict = process.argv.includes("--strict")

console.log(`版本一致：${expected}`)
for (const [platform, names] of Object.entries(groups)) {
  const missing = names.filter((name) => !process.env[name]?.trim())
  console.log(`${platform}：${missing.length === 0 ? "凭据齐全" : `缺少 ${missing.join(", ")}`}`)
  if (strict && missing.length > 0) process.exitCode = 1
}
