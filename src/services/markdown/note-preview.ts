import {
  extractExcalidrawTextElements,
  isExcalidrawMarkdown,
  stripMarkdownFrontmatter,
} from "@/services/markdown/markdown-preview-utils"
import type { Note } from "@/types/note"

const PREVIEW_LENGTH = 90
// isExcalidrawMarkdown 的正则在含大量 `---` 分隔线的长文档上会退化成「分隔线数 × 文档长度」的回溯，
// 而摘要只用得到开头一小段。这里统一先截断：Excalidraw 标记必定位于文件头部，判定结果不受影响，
// 但每次按键都重算摘要时不会再对整篇正文做全文扫描。
const SCAN_LENGTH = 4096

// 列表摘要统一走这里：正文首行往往是 YAML frontmatter 或画布数据，直接截断会把元数据当成正文展示。
export function buildNotePreview(content: string, format?: Note["format"]) {
  if (format === "canvas") return summarizeCanvas(content)
  const head = content.slice(0, SCAN_LENGTH)
  if (isExcalidrawMarkdown(head)) {
    return summarizeDrawingTexts(extractExcalidrawTextElements(content), "Excalidraw 画布")
  }
  return collapse(stripMarkdownSyntax(stripMarkdownFrontmatter(head))).slice(0, PREVIEW_LENGTH)
}

// 命中词经常落在摘要之外的正文深处：搜索列表这时候还是显示固定的开头摘要，用户看不出这篇为什么会命中。
// 只在摘要本身没包含关键词时才用得到——调用方应该先检查 title/preview，找不到再退回来正文找片段。
const SNIPPET_SCAN_LENGTH = 20000
const SNIPPET_RADIUS = 42

export function buildNoteSearchSnippet(content: string, query: string, format?: Note["format"]): string | null {
  const needle = query.trim()
  if (!needle || format === "canvas") return null
  const head = content.slice(0, SNIPPET_SCAN_LENGTH)
  if (isExcalidrawMarkdown(head)) return null

  const stripped = collapse(stripMarkdownSyntax(stripMarkdownFrontmatter(head)))
  const index = stripped.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
  if (index === -1) return null

  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(stripped.length, index + needle.length + SNIPPET_RADIUS)
  return `${start > 0 ? "…" : ""}${stripped.slice(start, end)}${end < stripped.length ? "…" : ""}`
}

// 摘要是给人扫一眼的，此前只去掉了标题的 #，**加粗**、`代码`、[链接](url)、![[图.png]]
// 这些标记都原样留在列表里。这里把常见写法统一还原成纯文字。
function stripMarkdownSyntax(body: string) {
  return body
    // 图片没有可读文字，整段去掉；链接与双链只留可见文字。
    .replace(/!\[\[[^\]\n]*\]\]/g, " ")
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, " ")
    .replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    // 块级标记：标题、引用、列表、表格分隔行、分割线。
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-+*]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, " ")
    .replace(/^\s{0,3}(?:```|~~~).*$/gm, " ")
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, " ")
    // 行内强调与代码：只摘掉标记，保留文字。
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}])__([^_\n]+)__(?![\p{L}\p{N}])/gu, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`+([^`\n]+)`+/g, "$1")
}

function summarizeCanvas(content: string) {
  let canvas: { nodes?: { file?: string; text?: string; type?: string }[] } | null
  try {
    // JSON.parse 对 "null" 之类的合法字面量会返回非对象值，属性访问必须一并防御。
    canvas = JSON.parse(content) as typeof canvas
  } catch {
    return "Canvas 画布"
  }
  const nodes = canvas && Array.isArray(canvas.nodes) ? canvas.nodes : []
  const labels = nodes.flatMap((node) => {
    if (node && typeof node.text === "string" && node.text.trim()) {
      return [collapse(node.text.replace(/^#+\s*/gm, ""))]
    }
    if (node && typeof node.file === "string" && node.file.trim()) {
      const segments = node.file.split("/")
      return [segments[segments.length - 1] || node.file]
    }
    return []
  })
  return summarizeDrawingTexts(labels, "Canvas 画布")
}

function summarizeDrawingTexts(texts: readonly string[], fallback: string) {
  const summary = collapse(texts.join(" · ")).slice(0, PREVIEW_LENGTH)
  return summary || fallback
}

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim()
}
