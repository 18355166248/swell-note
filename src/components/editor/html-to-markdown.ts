import { serializeMarkdownTable, type MarkdownTable } from "./markdown-table-model"

// 正文富文本粘贴：把剪贴板 HTML 中 Markdown 能表达的结构转成 Markdown。
// 安全前提：DOMParser 解析的文档是惰性的，脚本不会执行；这里只用白名单标签逐个装配文本，
// 链接/图片只保留 http(s)、mailto 与相对地址，其余协议（javascript:、data: 等）一律降级为纯文字。
// 任何解析或转换异常都返回 null，由调用方回退为纯文本粘贴，保证内容不丢失。

const STRUCTURE_SELECTOR = "h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,hr,a,strong,b,em,i,del,s,strike,code,img,br,div,li"

const SAFE_LINK_PATTERN = /^(?:https?:|mailto:|\/|#|\.\/|\.\.\/)/i
const SAFE_IMAGE_PATTERN = /^https?:/i
const HARD_BREAK = "\uE000"

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
    // 行首标记只在段落真正开头生效：缓冲区已有内容时，这个节点落在段落中间。
    inlineBuffer += renderInline(node, stillAtLineStart(inlineBuffer))
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
    const fence = "`".repeat(Math.max(3, longestBacktickRun(code) + 1))
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
    // 按 DOM 顺序组装条目。行内文本与 p/pre/子列表分桶会把
    // <p>首</p>中间<p>尾</p> 错排成「中间、首、尾」。
    const itemBlocks: Array<{ indented: boolean; text: string }> = []
    let inline = ""
    const flushInline = () => {
      const text = normalizeInlineWhitespace(inline)
      inline = ""
      if (text) itemBlocks.push({ indented: false, text })
    }
    for (const node of Array.from(item.childNodes)) {
      if (node instanceof Element) {
        if (node instanceof HTMLInputElement && node.type === "checkbox") continue
        if (node.tagName === "UL" || node.tagName === "OL") {
          flushInline()
          itemBlocks.push({ indented: true, text: renderList(node, contentIndent) })
          continue
        }
        if (BLOCK_TAGS.has(node.tagName)) {
          flushInline()
          const rendered = renderBlockElement(node, contentIndent)
          if (rendered) itemBlocks.push({ indented: false, text: rendered })
          continue
        }
      }
      // 条目内容虽然接在列表标记之后，但独立成分块时会另起一行，行首标记仍需转义。
      inline += renderInline(node, stillAtLineStart(inline))
    }
    flushInline()
    // 任务勾选框追加在列表标记之后（- [x] 项），单独输出 "[x]" 会被当成普通段落。
    // 富文本列表常用 <li><p>首段</p><p>续段</p></li>。首个段落接在列表标记后，
    // 后续段落用空行和内容缩进保留为同一条目的续段，避免预览时被拆成顶层正文。
    const firstBlock = itemBlocks[0] && !itemBlocks[0].indented ? itemBlocks.shift() : null
    const firstText = firstBlock?.text ?? ""
    const firstLines = firstText.split("\n")
    lines.push(`${indent}${marker}${task}${firstLines[0] ?? ""}`)
    if (firstLines.length > 1) lines.push(firstLines.slice(1).map((line) => `${contentIndent}${line}`).join("\n"))
    for (const block of itemBlocks) {
      if (!block.text.trim()) continue
      const continuation = block.text.split("\n").map((line) => (line ? `${contentIndent}${line}` : line)).join("\n")
      lines.push(block.indented ? block.text : `\n${continuation}`)
    }
    index += 1
  }
  return lines.join("\n")
}

function renderInlineChildren(element: Element, atLineStart = true): string {
  let rendered = ""
  let lineStart = atLineStart
  for (const node of Array.from(element.childNodes)) {
    const part = renderInline(node, lineStart)
    rendered += part
    lineStart = lineStartAfter(part, lineStart)
  }
  return rendered
}

// 已渲染内容是否仍停在当前行开头：硬换行后的缩进空白不改变行首状态。
// 这样 <p>首<span><br> # 次行</span></p> 即使进入 span 时不在行首，<br> 之后
// 也会重新识别出真正的行首，避免把次行误解析成标题。
function stillAtLineStart(rendered: string): boolean {
  const lastBreak = rendered.lastIndexOf(HARD_BREAK)
  const currentLine = lastBreak >= 0 ? rendered.slice(lastBreak + HARD_BREAK.length) : rendered
  return currentLine.trim() === ""
}

function lineStartAfter(rendered: string, previous: boolean): boolean {
  if (!rendered) return previous
  const lastBreak = rendered.lastIndexOf(HARD_BREAK)
  if (lastBreak >= 0) return rendered.slice(lastBreak + HARD_BREAK.length).trim() === ""
  return previous && rendered.trim() === ""
}

function renderInline(node: Node, atLineStart: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // 行首标记只在真正的行首转义。富文本会用 span/strong 把一句话切成多个文本节点，
    // 段落中间恰好以 # 或 - 开头的节点不是结构，转义只会给原文平白塞进反斜杠。
    return escapeText(collapseWhitespace(node.textContent ?? ""), atLineStart)
  }
  if (!(node instanceof Element)) return ""
  const tag = node.tagName
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE" || tag === "IFRAME" || tag === "OBJECT") return ""
  if (tag === "BR") return HARD_BREAK
  // 格式标记各自带前缀（**、*、~~、[、![），行首标记在它们内部不可能成为结构，
  // 因此一律按「不在行首」传给子节点，避免多余的反斜杠。
  if (tag === "STRONG" || tag === "B") return wrapInline("**", renderInlineChildren(node, false))
  if (tag === "EM" || tag === "I") return wrapInline("*", renderInlineChildren(node, false))
  if (tag === "DEL" || tag === "S" || tag === "STRIKE") return wrapInline("~~", renderInlineChildren(node, false))
  if (tag === "CODE" && node.parentElement?.tagName !== "PRE") {
    const text = node.textContent ?? ""
    if (!text.trim()) return collapseWhitespace(text)
    // 围栏必须长于内容中最长的连续反引号；内容首尾是反引号时加一格内衬，
    // CommonMark 会移除这层内衬，同时完整保留用户看见的代码文字。
    const fence = "`".repeat(longestBacktickRun(text) + 1)
    const padding = text.startsWith("`") || text.endsWith("`") || (/^\s/.test(text) && /\s$/.test(text) && text.trim()) ? " " : ""
    return `${fence}${padding}${text}${padding}${fence}`
  }
  if (tag === "A") {
    // 标签文字前面已经有 "["，永远不在行首。
    const label = normalizeInlineWhitespace(renderInlineChildren(node, false)) || (node.textContent ?? "").trim()
    const visibleLabel = normalizeInlineWhitespace(node.textContent ?? "")
    const href = (node.getAttribute("href") ?? "").trim()
    if (!label) return ""
    if (!href || !SAFE_LINK_PATTERN.test(href)) return label
    if (visibleLabel === href) return href
    return `[${label}](${serializeLinkDestination(href)})`
  }
  if (tag === "IMG") {
    const source = (node.getAttribute("src") ?? "").trim()
    const alt = (node.getAttribute("alt") ?? "").trim()
    // alt 落在 "![" 之后（或被降级成裸文字时可能位于行首），按行首参数决定是否转义行首标记。
    // 非 http(s) 图片（data:、file: 等）不引入笔记，只保留 alt 文字以免静默丢内容。
    if (!SAFE_IMAGE_PATTERN.test(source)) return escapeText(alt, atLineStart)
    return `![${escapeText(alt, false)}](${serializeLinkDestination(source)})`
  }
  // 其余行内标签（span、font、mark 等）不对应 Markdown 结构，剥掉标签保留文字，
  // 行首状态原样传给子节点——剥掉标签不会改变内容是否落在行首。
  return renderInlineChildren(node, atLineStart)
}

function wrapInline(mark: string, content: string): string {
  // HARD_BREAK 要保留到整个行内片段完成后再展开；若在格式标签内部提前变成两个空格，
  // 外层 normalize 会把它们折叠，最终只剩普通换行。
  const text = content.replace(/ *\n */g, "\n").replace(/[ \t]+/g, " ")
  if (!text.trim()) return text
  const leading = text.match(/^\s+/)?.[0] ?? ""
  const trailing = text.match(/\s+$/)?.[0] ?? ""
  const inner = text.slice(leading.length, trailing.length ? text.length - trailing.length : undefined)
  return inner ? `${leading}${mark}${inner}${mark}${trailing}` : text
}

// HTML 行内容里的连续空白（含换行缩进）按渲染规则折叠成单个空格。
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ")
}

function normalizeInlineWhitespace(text: string): string {
  return text.replace(/ *\n */g, "\n").replace(/[ \t]+/g, " ").trim().split(HARD_BREAK).join("  \n")
}

// 只转义真的会改变解析的字符。反斜杠、行内代码的反引号、强调星号、方括号（方括号必须成对
// 转义，只转义左括号会让标签与链接文本的配对错位）、尖括号（HTML 标签、自动链接）、
// 波浪号在任何位置都成语法，一律转义；下划线只在词首词尾成强调，snake_case 里的 _ 是字面量；
// & 只在构成实体引用时才被解析。
// 星号与波浪号不收窄：星号允许词内成对（a*b*c 会被解析成强调），波浪号更是单个就能配成
// 删除线（remark-gfm 的 singleTilde 默认开启，x~y~z 里的 ~y~ 同样成语法），都不能靠两侧判断。
// 行首标记（- + # > 数字序号 表格竖线）另由 escapeLineStartMarks 按真实行首判断——
// 正文中间的它们都是字面量，「100-200」「v1.2.3」不该被塞进反斜杠，粘贴后 ⌘F 才能搜到原文。
const INLINE_MARK_PATTERN = /[\\`*\[\]<~]|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])|&(?=[A-Za-z][A-Za-z0-9]{1,31};|#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};)/g

function escapeInlineMarks(text: string): string {
  return text.replace(INLINE_MARK_PATTERN, "\\$&")
}

// 落在一段内容开头的裸文字：行内标记与行首标记都要转义。
function escapeText(text: string, atLineStart: boolean): string {
  const escaped = escapeInlineMarks(text)
  return atLineStart ? escapeLineStartMarks(escaped) : escaped
}

// 行首标记要同时满足「在行首」与「后面跟空白（或整行只有它）」才是结构：
// `--flag`、`2.3.4`、`#标签` 都不满足，因此保持原样。缩进空白要一并吃掉再判断，
// 否则 HTML 源里 <p>\n  - x\n</p> 的缩进会漏判。
//
// 「在行首」不能按文本节点判断：富文本会用 span/strong 把一句话切成多个文本节点，
// <p>前缀<strong>粗</strong># 标签</p> 里的 # 落在段落中间，按节点判断会平白多一个
// 反斜杠，粘贴后按原文搜索就被打断。真正的行首状态由 renderInlineChildren 累积已渲染
// 内容得出，只有确实空着的那一行才调用本函数。
function escapeLineStartMarks(text: string): string {
  return text
    .replace(/^([ \t]*)(#{1,6})(?=\s|$)/, "$1\\$2")
    .replace(/^([ \t]*)>/, "$1\\>")
    .replace(/^([ \t]*)([-+])(?=\s|$)/, "$1\\$2")
    .replace(/^([ \t]*\d+)([.)])(?=\s|$)/, "$1\\$2")
    .replace(/^([ \t]*)(-{3,})[ \t]*$/, "$1\\$2")
    .replace(/^([ \t]*)\|/, "$1\\|")
}

function longestBacktickRun(text: string): number {
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return longest
}

function serializeLinkDestination(href: string): string {
  // Markdown 目的地址中的空白和括号会改变解析边界；逐字符编码且保留既有 %xx，
  // 避免 encodeURI 对括号放行，也避免把整个 URL 编码成不可用文本。
  return href.replace(/[\s()<>]/g, (character) => encodeURIComponent(character))
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
      const content = normalizeInlineWhitespace(renderInlineChildren(cell)).replace(/(?<!\\)\|/g, "\\|").replace(/ {2}\r?\n|\r?\n/g, "<br>")
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
