import { serializeMarkdownTable, type MarkdownTable } from "./markdown-table-model"

// 正文富文本粘贴：把剪贴板 HTML 中 Markdown 能表达的结构转成 Markdown。
// 安全前提：DOMParser 解析的文档是惰性的，脚本不会执行；这里只用白名单标签逐个装配文本，
// 链接/图片只保留 http(s)、mailto 与相对地址，其余协议（javascript:、data: 等）一律降级为纯文字。
// 任何解析或转换异常都返回 null，由调用方回退为纯文本粘贴，保证内容不丢失。

const STRUCTURE_SELECTOR = "h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,hr,a,strong,b,em,i,del,s,strike,code,img,br,div,li"

const SAFE_LINK_PATTERN = /^(?:https?:|mailto:|\/|#|\.\/|\.\.\/)/i
const SAFE_IMAGE_PATTERN = /^https?:/i

// 块级容器：遇到时产生段落边界，而不是把文字直接拼接在一起。
const BLOCK_TAGS = new Set(["ADDRESS", "ARTICLE", "ASIDE", "DD", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "MAIN", "NAV", "P", "PRE", "SECTION", "TABLE"])

export function htmlToMarkdown(html: string): string | null {
  try {
    const document = new DOMParser().parseFromString(html, "text/html")
    const body = document.body
    if (!body || !body.querySelector(STRUCTURE_SELECTOR)) return null
    const blocks = renderBlockChildren(body, "")
    const markdown = compressBlockGaps(blocks.join("\n\n")).trim()
    return markdown || null
  } catch {
    return null
  }
}

// 块与块之间的连续空行压成一段；代码围栏内部的空行是内容本身（<pre> 允许空行），
// 逐行跟踪围栏开合，围栏内一律原样保留。围栏行可能带列表缩进或引用前缀；
// 关闭围栏的反引号不得短于开启围栏——更短的反引号行只是代码内容
// （代码含 ``` 时外层会用 ```` 包裹，不能把内层 ``` 误判成关闭）。
function compressBlockGaps(markdown: string): string {
  const fencePattern = /^(?:\s|> )*(`{3,})(.*)$/
  // 0 表示不在围栏内，否则为开启围栏的反引号数。
  let fenceLength = 0
  let blank = false
  const out: string[] = []
  for (const line of markdown.split("\n")) {
    const fence = fencePattern.exec(line)
    if (fence) {
      if (fenceLength === 0) {
        fenceLength = fence[1].length
      } else if (fence[1].length >= fenceLength && !fence[2].trim()) {
        // 关闭围栏：长度不得短于开启围栏，且反引号之后仅能有空白——
        // 带尾随文字（如 ````js）的等长反引号行只是代码内容。
        fenceLength = 0
      }
    }
    if (fenceLength === 0 && !line.trim()) {
      if (blank) continue
      blank = true
    } else {
      blank = false
    }
    out.push(line)
  }
  return out.join("\n")
}

// 转换结果是否只是行内片段（单个加粗词、链接、图片等）：这种粘贴应原位插进当前段落，
// 调用方不要补空行把原段落拆成三段。块级结构（标题/列表/表格/围栏等）永远多行或带行首标记。
const BLOCK_START_PATTERN = /^(?:#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|`{3,}|~{3,}|-{3,}\s*$|\|)/

export function isInlineMarkdownFragment(markdown: string): boolean {
  return !markdown.includes("\n") && !BLOCK_START_PATTERN.test(markdown)
}

function renderBlockChildren(parent: ParentNode, indent: string): string[] {
  const blocks: string[] = []
  // 连续的行内片段先攒在一起，作为一个段落输出，避免每个 <span> 都变成独立段落。
  let inlineBuffer = ""
  const flushInline = () => {
    const text = normalizeInlineWhitespace(inlineBuffer)
    inlineBuffer = ""
    if (text) blocks.push(text)
  }
  for (const node of Array.from(parent.childNodes)) {
    if (node instanceof Element) {
      const block = renderBlockElement(node, indent)
      if (block !== null) {
        flushInline()
        if (block) blocks.push(block)
        continue
      }
    }
    inlineBuffer += renderInline(node)
  }
  flushInline()
  return blocks
}

// 返回 null 表示该元素不是块级结构，应交给行内渲染；返回 "" 表示已处理但不产生内容。
function renderBlockElement(element: Element, indent: string): string | null {
  const tag = element.tagName
  const heading = /^H([1-6])$/.exec(tag)
  if (heading) return `${"#".repeat(Number(heading[1]))} ${normalizeInlineWhitespace(renderInlineChildren(element))}`
  if (tag === "P") {
    const text = normalizeInlineWhitespace(renderInlineChildren(element))
    // 空段落只是排版空隙，丢弃不丢内容。
    return text
  }
  if (tag === "HR") return "---"
  if (tag === "BLOCKQUOTE") {
    const inner = renderBlockChildren(element, indent).join("\n\n")
    if (!inner.trim()) return ""
    // 引用嵌套用 > 逐层叠加即可，无需递归深度信息。
    return inner.split("\n").map((line) => (line.trim() ? `> ${line}` : ">")).join("\n")
  }
  if (tag === "PRE") {
    const code = (element.textContent ?? "").replace(/\n$/, "")
    const fence = code.includes("```") ? "````" : "```"
    return `${fence}\n${code}\n${fence}`
  }
  if (tag === "UL" || tag === "OL") return renderList(element, indent)
  if (tag === "TABLE") return tableToMarkdown(element as HTMLTableElement) ?? ""
  if (tag === "LI") {
    // 独立的 li（不在 ul/ol 里）按段落处理，内容不丢。
    return renderBlockChildren(element, indent).join("\n\n")
  }
  if (BLOCK_TAGS.has(tag)) {
    // 未单独处理的块级容器（div/section 等）：内部若有块级结构则递归，否则整段作为行内容。
    if (element.querySelector(STRUCTURE_SELECTOR)) return renderBlockChildren(element, indent).join("\n\n")
    return normalizeInlineWhitespace(renderInlineChildren(element))
  }
  return null
}

function renderList(list: Element, indent: string): string {
  const ordered = list.tagName === "OL"
  const start = Number(list.getAttribute("start")) || 1
  const lines: string[] = []
  let index = 0
  for (const item of Array.from(list.children)) {
    if (item.tagName !== "LI") continue
    const checkbox = item.querySelector(":scope > input[type=checkbox]")
    const task = checkbox instanceof HTMLInputElement ? (checkbox.checked || checkbox.hasAttribute("checked") ? "[x] " : "[ ] ") : ""
    // 嵌套内容（子列表、续段）必须缩进到这个条目的内容起始位置，也就是标记宽度：
    // 有序标记 "10. " 比 "- " 宽，固定两格缩进会让子列表被解析成顶层列表。
    const marker = ordered ? `${start + index}. ` : "- "
    const contentIndent = `${indent}${" ".repeat(marker.length)}`
    // 条目本身可能直接包含块级子元素（嵌套列表、段落），先抽出行内首段，再递归其余块。
    const inlineParts: string[] = []
    // indented 标记该块已自带缩进（嵌套列表按 contentIndent 渲染），追加时不再重复缩进。
    const nestedBlocks: Array<{ indented: boolean; text: string }> = []
    for (const node of Array.from(item.childNodes)) {
      if (node instanceof Element) {
        if (node instanceof HTMLInputElement && node.type === "checkbox") continue
        if (node.tagName === "UL" || node.tagName === "OL") { nestedBlocks.push({ indented: true, text: renderList(node, contentIndent) }); continue }
        if (BLOCK_TAGS.has(node.tagName)) { for (const text of renderBlockChildren(node, contentIndent)) nestedBlocks.push({ indented: false, text }); continue }
      }
      inlineParts.push(renderInline(node))
    }
    // 任务勾选框追加在列表标记之后（- [x] 项），单独输出 "[x]" 会被当成普通段落。
    lines.push(`${indent}${marker}${task}${normalizeInlineWhitespace(inlineParts.join(""))}`)
    for (const block of nestedBlocks) {
      if (!block.text.trim()) continue
      lines.push(block.indented ? block.text : block.text.split("\n").map((line) => (line ? `${contentIndent}${line}` : line)).join("\n"))
    }
    index += 1
  }
  return lines.join("\n")
}

function renderInlineChildren(element: Element): string {
  return Array.from(element.childNodes, renderInline).join("")
}

function renderInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return collapseWhitespace(node.textContent ?? "")
  if (!(node instanceof Element)) return ""
  const tag = node.tagName
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE" || tag === "IFRAME" || tag === "OBJECT") return ""
  if (tag === "BR") return "\n"
  if (tag === "STRONG" || tag === "B") return wrapInline("**", renderInlineChildren(node))
  if (tag === "EM" || tag === "I") return wrapInline("*", renderInlineChildren(node))
  if (tag === "DEL" || tag === "S" || tag === "STRIKE") return wrapInline("~~", renderInlineChildren(node))
  if (tag === "CODE" && node.parentElement?.tagName !== "PRE") {
    const text = node.textContent ?? ""
    if (!text.trim()) return collapseWhitespace(text)
    // 内容本身带反引号时换用双反引号包裹，避免标记被内容截断。
    return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``
  }
  if (tag === "A") {
    const label = normalizeInlineWhitespace(renderInlineChildren(node)) || (node.textContent ?? "").trim()
    const href = (node.getAttribute("href") ?? "").trim()
    if (!label) return ""
    if (!href || !SAFE_LINK_PATTERN.test(href)) return label
    if (label === href) return href
    return `[${label.replace(/[[\]]/g, "")}](${href.replace(/[()]/g, (character) => encodeURIComponent(character))})`
  }
  if (tag === "IMG") {
    const source = (node.getAttribute("src") ?? "").trim()
    const alt = (node.getAttribute("alt") ?? "").trim()
    // 非 http(s) 图片（data:、file: 等）不引入笔记，只保留 alt 文字以免静默丢内容。
    if (!SAFE_IMAGE_PATTERN.test(source)) return alt
    return `![${alt}](${source})`
  }
  // 其余行内标签（span、font、mark 等）不对应 Markdown 结构，剥掉标签保留文字。
  return renderInlineChildren(node)
}

function wrapInline(mark: string, content: string): string {
  const text = normalizeInlineWhitespace(content)
  if (!text) return ""
  return `${mark}${text}${mark}`
}

// HTML 行内容里的连续空白（含换行缩进）按渲染规则折叠成单个空格。
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ")
}

function normalizeInlineWhitespace(text: string): string {
  return text.replace(/ *\n */g, "\n").replace(/[ \t]+/g, " ").trim()
}

// colspan/rowspan 超出 GFM 表达能力：展开为完整网格，内容只保留在跨度起始格，
// 被覆盖的格子留空——文字一个不丢，但不再表达合并关系。
function tableToMarkdown(table: HTMLTableElement): string | null {
  const grid: string[][] = []
  // spans[column] = 该列被上方 rowspan 覆盖的剩余行数。
  const spans: number[] = []
  for (const row of Array.from(table.rows)) {
    const line: string[] = []
    let column = 0
    const cells = Array.from(row.cells)
    for (const cell of cells) {
      while (spans[column] > 0) { line[column] = line[column] ?? ""; column += 1 }
      const content = normalizeInlineWhitespace(renderInlineChildren(cell)).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")
      const colspan = Math.max(1, Math.min(cell.colSpan || 1, 50))
      const rowspan = Math.max(1, Math.min(cell.rowSpan || 1, 200))
      line[column] = content
      for (let offset = 1; offset < colspan; offset += 1) line[column + offset] = ""
      if (rowspan > 1) {
        // 占位计数按完整跨度写入，行末统一减一（当前行也算一行）；
        // 若写成 rowspan - 1，下一行结束就被消耗干净，跨行覆盖会提前失效。
        for (let offset = 0; offset < colspan; offset += 1) spans[column + offset] = rowspan
      }
      column += colspan
    }
    for (let index = 0; index < spans.length; index += 1) {
      if (spans[index] > 0) { line[index] = line[index] ?? ""; spans[index] -= 1 }
    }
    grid.push(line)
  }
  if (grid.length === 0) return null
  const width = Math.max(...grid.map((line) => line.length))
  if (width === 0) return null
  const pad = (line: string[]) => [...line, ...Array(Math.max(0, width - line.length)).fill("")]
  const model: MarkdownTable = {
    aligns: Array(width).fill("left"),
    // GFM 表格必须有表头；源表格没有 thead 时就把第一行当作表头。
    header: pad(grid[0]),
    rows: grid.slice(1).map(pad),
  }
  return serializeMarkdownTable(model)
}
