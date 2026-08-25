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
  const body = stripMarkdownFrontmatter(head).replace(/^#+\s*/gm, "")
  return collapse(body).slice(0, PREVIEW_LENGTH)
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
