import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const source = resolve(projectRoot, "node_modules/vditor/dist")
const target = resolve(projectRoot, "public/vendor/vditor/dist")

// Vditor 会按内容动态加载 Lute、图标、代码高亮和图表脚本；构建前复制完整 dist，
// 保证桌面端和移动端离线编辑时不会回退到公共 CDN。
await rm(target, { force: true, recursive: true })
await mkdir(dirname(target), { recursive: true })
await cp(source, target, { recursive: true })
