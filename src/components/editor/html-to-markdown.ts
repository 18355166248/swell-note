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

/** HTML 里的一张图片，按渲染顺序取出。 */
export type ClipboardImage = { alt: string; src: string }

export type HtmlToMarkdownOptions = {
  /**
   * 这张**导入不了**的图片是否有剪贴板文件来补上引用（Word/飞书等本地图片富文本）。
   * 判定为真时这里只保留 alt 说明文字，真正的正文引用由附件队列写入，同一张图不会被插两次。
   *
   * 必须是逐图判定，不能退化成一个全局布尔值：HTML 里有两张导入不了的图片、剪贴板只给了
   * 一个图片文件时，全局开关会把两张图的占位一起删掉，可只有一张真的会被补上，
   * 另一张连占位都不剩——图片从正文里静默消失，正是这条降级反馈要防的情况。
   */
  imageCoveredByFile?: (image: ClipboardImage) => boolean
}

/** HTML 里所有本函数导入不了（src 不是 http(s)）的图片。 */
function unsupportedImages(html: string): ClipboardImage[] {
  try {
    const document = new DOMParser().parseFromString(html, "text/html")
    return Array.from(document.querySelectorAll("img"))
      .map((img) => ({ alt: (img.getAttribute("alt") ?? "").trim(), src: (img.getAttribute("src") ?? "").trim() }))
      .filter((image) => !SAFE_IMAGE_PATTERN.test(image.src))
  } catch {
    // 解析失败按「没有图片」处理：这条路径只影响占位文案，异常不能把整次粘贴带下水。
    return []
  }
}

/**
 * 剪贴板 HTML 里是否存在“本函数导入不了、但剪贴板可能给了真实文件”的图片。
 *
 * 只在剪贴板同时带文件时才会被调用，用来决定这批文件是否该交给附件队列：
 * 网页复制的富文本（图片本来就是 http(s) 外链）不该把附带的资源当附件插入，
 * 而 Word/飞书那种 src 为 file:/data: 的本地图片，正文里没有可用引用，必须靠文件补齐。
 */
export function htmlNeedsClipboardImageFiles(html: string): boolean {
  return unsupportedImages(html).length > 0
}

/**
 * 剪贴板里的图片文件该不该当作附件插入。
 *
 * 两个条件必须同时成立，缺一个都会出错：
 * - HTML 里确实有本函数导入不了的图片，否则网页富文本附带的资源文件会被当成附件插进来；
 * - 剪贴板真的给了至少一个图片文件，否则没有任何东西能补上这些图片的引用。
 *
 * 第二个条件最容易写漏：`图片数 === 文件数` 在两者都为 0 时也成立，
 * 单凭它判断会让「只有 HTML、没有附带文件」的粘贴走进「只留 alt」的分支，
 * 图片连同占位一起从正文里消失——正是这条降级反馈要防的静默丢失。
 */
export function shouldInsertClipboardImageFiles(html: string | null, files: File[]): boolean {
  const images = files.filter((file) => file.type.startsWith("image/"))
  return images.length > 0
    && images.length === files.length
    && htmlNeedsClipboardImageFiles(html ?? "")
}

/** src 末尾的文件名，用于和剪贴板文件名比对。取不到时返回空串（视作对不上）。 */
function imageFileName(source: string): string {
  const path = source.split(/[?#]/)[0]
  const name = path.split(/[/\\]/).pop() ?? ""
  try {
    return decodeURIComponent(name).trim().toLowerCase()
  } catch {
    // 非法百分号转义：按原样比对，不要因为一个解码异常让整次粘贴退回纯文本。
    return name.trim().toLowerCase()
  }
}

/**
 * 建立「HTML 里导入不了的图片 → 是否确实有剪贴板文件补上引用」的逐图判定。
 *
 * 能确认的只有两种情形：
 * 1. src 的文件名与剪贴板文件同名，且该名称在两侧各只出现一次；
 * 2. 导入不了的图片数与图片文件数一一对应，映射没有歧义（Word / 飞书的典型形态，
 *    它们的 src 常指向临时目录甚至 data:，只认文件名会把每一张都判成未覆盖，
 *    于是每张图都多出一个「导入失败」的占位，而引用紧接着就插进来了）。
 *
 * 对不上就返回 false，宁可多留一个占位，也不能让图片连同占位一起消失。
 */
export function createClipboardImageCoverage(html: string | null, files: File[]): (image: ClipboardImage) => boolean {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"))
  // 文件里混了非图片，或压根没有图片文件：没有任何东西能补上 HTML 图片的引用。
  if (imageFiles.length === 0 || imageFiles.length !== files.length) return () => false
  const unsupported = unsupportedImages(html ?? "")
  if (unsupported.length === 0) return () => false
  const paired = unsupported.length === imageFiles.length
  if (paired) return () => true
  const countNames = (names: string[]) => {
    const counts = new Map<string, number>()
    for (const name of names) if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    return counts
  }
  const sourceNames = countNames(unsupported.map((image) => imageFileName(image.src)))
  const fileNames = countNames(imageFiles.map((file) => file.name.trim().toLowerCase()))
  // 文件名不含目录，a/image.png 与 b/image.png 不能靠一个同名文件区分。
  // 数量不匹配时仅接受两侧都唯一的名称，其余保留占位；判定保持纯函数，重复渲染不会消耗匹配。
  return (image) => {
    const name = imageFileName(image.src)
    return sourceNames.get(name) === 1 && fileNames.get(name) === 1
  }
}

/**
 * 本次转换的选项。渲染是同步的、且只会从 htmlToMarkdown 这一条链路进入，
 * 因此用模块级变量传参，避免让 renderInline 这条被递归调用的链路多背一个只为 IMG 分支服务的参数。
 *
 * 只在单次调用内有效：入口先存旧值、finally 里还原，嵌套调用（万一将来出现）也只会覆盖再复位回外层值。
 * 不能把它做成跨调用的全局开关——粘贴的图片文件和网页 HTML 会走同一条分发路径，
 * 泄漏一次就会让所有后续粘贴都丢掉远程图片。
 */
let currentHtmlOptions: HtmlToMarkdownOptions = {}

export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): string | null {
  const previous = currentHtmlOptions
  currentHtmlOptions = options
  try {
    const document = new DOMParser().parseFromString(html, "text/html")
    const body = document.body
    if (!body || !body.querySelector(STRUCTURE_SELECTOR)) return null
    const blocks = renderBlockChildren(body, "")
    const markdown = compressBlockGaps(blocks.join("\n\n")).trim()
    return markdown || null
  } catch {
    return null
  } finally {
    currentHtmlOptions = previous
  }
}

// 图片无法按外链导入时的可见占位。有 alt 时保留原有说明文字，没有时给一段可搜索的说明。
// 静默丢弃会让「粘贴后图片消失」无从排查，用户至少要看得出这里原本有一张图以及为什么没进来。
//
// 刻意用全角括号而不是方括号：`[` 会被 escapeText 转义成 `\[`，源码模式里会出现一堆
// 与可见文字不一致的反斜杠，读起来像转义错误。
function imageImportPlaceholder(alt: string, reason: string): string {
  return alt ? `${alt}（${reason}）` : `（${reason}）`
}

function imageImportReason(source: string): string {
  if (!source) return "图片无法导入：图片地址为空"
  if (/^data:/i.test(source)) return "图片无法导入：data: 地址不导入"
  if (/^(?:file|blob):/i.test(source)) return "图片无法导入：本地文件地址不导入"
  return "图片无法导入：仅支持 http(s) 地址"
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
    // 非 http(s) 图片（data:、file: 等）不引入笔记，但保留可见占位，不静默丢内容。
    // 剪贴板同时给了这些图片的真实文件时，正文引用由附件队列写入，这里只留 alt 说明文字，
    // 避免同一张图片既进队列又在正文里留一份原始地址。
    if (!SAFE_IMAGE_PATTERN.test(source)) {
      // 逐图确认「这张」是否有剪贴板文件补上引用：有就只留 alt 说明文字，没有就留可见占位。
      // 补上的那些绝不能退回「图片无法导入」占位：图片马上由文件插进来，写一句导入失败
      // 是假消息，还会和紧跟其后的引用打架。未被文件覆盖的图片则必须保住占位——
      // 它们不会有任何引用补充，静默删掉就是真的丢了。
      const covered = currentHtmlOptions.imageCoveredByFile?.({ alt, src: source }) ?? false
      if (covered) return alt ? escapeText(alt, atLineStart) : ""
      return escapeText(imageImportPlaceholder(alt, imageImportReason(source)), atLineStart)
    }
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
