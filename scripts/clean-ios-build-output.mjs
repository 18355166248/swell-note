import { rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"

// Tauri CLI 会把 xcarchive 内的模拟器 App rename 到 arm64-sim；连续构建时不会覆盖旧目录，
// 最终会以 Directory not empty 失败。这里只清理两处生成物，不碰签名配置、工程文件或 DerivedData。
const archiveUrl = new URL("../src-tauri/gen/apple/build/swell-note_iOS.xcarchive", import.meta.url)
const simulatorAppUrl = new URL("../src-tauri/gen/apple/build/arm64-sim/Swell Note.app", import.meta.url)

await Promise.all([
  rm(fileURLToPath(archiveUrl), { force: true, recursive: true }),
  rm(fileURLToPath(simulatorAppUrl), { force: true, recursive: true }),
])
