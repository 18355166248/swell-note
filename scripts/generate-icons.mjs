import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const projectRoot = resolve(import.meta.dirname, "..")
const source = resolve(projectRoot, "src/assets/brand/swell-note-logo-book-s.svg")
const output = resolve(projectRoot, "src-tauri/icons")
const staging = mkdtempSync(join(tmpdir(), "swell-note-icons-"))

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status ?? "unknown"}）`)
}

try {
  // 独立暂存目录规避 Tauri 在默认 icons 目录内复用旧 iOS 源图的情况。
  run("pnpm", ["tauri", "icon", source, "--output", staging, "--ios-color", "#F7FAFF"])
  cpSync(staging, output, { force: true, recursive: true })

  if (process.platform === "darwin") {
    run("swift", ["scripts/strip-ios-icon-alpha.swift", "src-tauri/icons/ios"])
  }

  console.log("✓ Swell Note 全平台图标已更新")
} catch (error) {
  console.error(`✗ 图标生成失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  rmSync(staging, { force: true, recursive: true })
}
