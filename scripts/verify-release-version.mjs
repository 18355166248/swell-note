import { readFileSync } from "node:fs"

const tag = process.argv[2]
if (!tag?.startsWith("v")) throw new Error("发布标签必须使用 v<version> 格式")

const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version
const tauriVersion = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).version
const cargoManifest = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8")
const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const appleProject = readFileSync(new URL("../src-tauri/gen/apple/project.yml", import.meta.url), "utf8")
const iosVersion = appleProject.match(/CFBundleShortVersionString:\s*([^\s]+)/)?.[1]
const expected = tag.slice(1)

const versions = { package: packageVersion, tauri: tauriVersion, cargo: cargoVersion, ios: iosVersion }
for (const [source, version] of Object.entries(versions)) {
  if (version !== expected) throw new Error(`${source} 版本 ${version ?? "缺失"} 与标签 ${tag} 不一致`)
}

console.log(`版本校验通过：${tag}`)
