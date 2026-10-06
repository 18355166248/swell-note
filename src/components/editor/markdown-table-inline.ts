import { markdownLanguage } from "@codemirror/lang-markdown"
import { collectMarkdownDefinitions, resolveMarkdownReference } from "@/services/markdown/markdown-reference-links"
import { parseMarkdownNoteHref } from "@/services/markdown/markdown-preview-utils"
import { openExternalUrl } from "@/services/open-external-url"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import { resolveCachedImageUrl } from "./markdown-image-cache"
import type { EditorLinkTap } from "./markdown-input"

export type TableInlineOptions = {
  referenceDefinitions?: ReturnType<typeof collectMarkdownDefinitions>
  // 表格 Widget 按平台与只读状态传入，与正文的链接激活规则一致。
  requireLinkModifier?: boolean
  // 移动端点按 [文字](地址) 链接时不直接打开，交给宿主弹出操作菜单；返回 true 表示已接管。
  onLinkTap?: (tap: EditorLinkTap) => boolean
  onOpenExternalLink?: (href: string) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  // 单元格进入/退出编辑以及编辑中移动选区时，向工具栏汇报行内格式状态；null 表示离开单元格编辑。
  onTableFormatState?: (state: { code: boolean; emphasis: boolean; strike: boolean; strong: boolean } | null) => void
  tableStorageKey?: string
}

export type MarkdownImageLoadState = "loading" | "loaded" | "error"

const LINK_HINT = "点击打开链接"
const WIKI_HINT = "点击打开笔记"

function codeSpanContent(text: string) {
  // CommonMark 只去掉成对的一个边缘空格；纯空格代码保留，不能用 trim() 改掉用户内容。
  const trimEdges = text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text)
  return { text: trimEdges ? text.slice(1, -1) : text, offset: trimEdges ? 1 : 0 }
}

// 行内内容始终使用 DOM API 和 textContent 装配，不解析原始 HTML，避免云端笔记形成注入面。
// 下划线强调要求两侧不是字母数字，避免把 snake_case_name 错误渲染成强调。
const tableInlinePattern
  = /(?<escape>\\[!"#$%&'()*+,\-.\/:;<=>?@[\]^_`{|}~])|(?<entity>&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)|!\[(?<imageAlt>(?:\\.|[^\]\\\n])*)\]\((?<imageSource>\S+?)(?:\s+["'][^"']*["'])?\)|\[(?<linkLabel>(?:\\.|[^\]\\\n])+)\]\((?<linkHref>\S+?)(?:\s+["'][^"']*["'])?\)|~~(?<strike>(?:\\.|(?!~~).)+?)~~|\*\*(?<strongStar>(?:\\.|(?!\*\*).)+?)\*\*|(?<![\p{L}\p{N}])__(?<strongUnder>(?:\\.|(?!__).)+?)__(?![\p{L}\p{N}])|\*(?<emStar>(?:\\.|[^*])+?)\*|(?<![\p{L}\p{N}])_(?<emUnder>(?:\\.|[^_])+?)_(?![\p{L}\p{N}])|(?<!`)(?<codeFence>`+)(?!`)(?<codeText>.+?)(?<!`)\k<codeFence>(?!`)|(?<bareHref>https?:\/\/[^\s<>]+)|(?<break><br\s*\/?>)/gisu

type InlineMatch = { 0: string; index?: number; groups?: Record<string, string> }

function inlineMatches(text: string, options: TableInlineOptions): InlineMatch[] {
  const matches: InlineMatch[] = [...text.matchAll(tableInlinePattern)]
  const definitions = options.referenceDefinitions
  if (!definitions?.size || !text.includes("[")) return matches
  // 引用式链接用同一语法解析器与全文定义解析；代码中的 [示例] 不能被正则误当成链接。
  markdownLanguage.parser.parse(text).iterate({
    enter(node) {
      if (node.name !== "Link" && node.name !== "Image") return
      if (node.node.getChild("URL") || text.slice(Math.max(0, node.from - 1), node.from + 1) === "[[") return
      const destination = resolveMarkdownReference(node.node, (from, to) => text.slice(from, to), definitions)
      const open = node.node.getChild("LinkMark")
      if (!destination || !open) return
      const explicit = node.node.getChild("LinkLabel")
      const close = text.lastIndexOf("]", (explicit?.from ?? node.to) - 1)
      const token: InlineMatch = {
        0: text.slice(node.from, node.to),
        index: node.from,
        groups: { referenceLabel: text.slice(open.to, close), referenceSource: destination.source,
          referenceImage: node.name === "Image" ? "true" : "false" },
      }
      matches.push(token)
      return false
    },
  })
  // 外层格式 token 先消费，再递归渲染内部引用，避免裸 URL 或内层标记把同一片段重复显示。
  matches.sort((left, right) => (left.index ?? 0) - (right.index ?? 0) || right[0].length - left[0].length)
  let end = 0
  return matches.filter((match) => {
    const start = match.index ?? 0
    if (start < end) return false
    end = start + match[0].length
    return true
  })
}

// 单元格点击定位：展示层渲染后的文字偏移 ↔ 原始 Markdown 偏移。
// 展示层会吃掉标记字符（**加粗** 只显示「加粗」），直接用 DOM 偏移会落进标记内部，
// 这里沿同一条行内正则把每个 token 的显示文字映射回它在原文里的起点。
export function rawOffsetForDisplayOffset(text: string, displayOffset: number, options: TableInlineOptions = {}): number {
  let raw = 0
  let shown = 0
  for (const match of inlineMatches(text, options)) {
    const index = match.index ?? 0
    // token 前的普通文本段非空时，落在段内的偏移按 1:1 映射；段为空（offset 0 处就是 token）
    // 不能在这里截获，否则光标会落到标记起点之前。
    if (index > raw && displayOffset <= shown + (index - raw)) return raw + Math.max(0, displayOffset - shown)
    shown += index - raw
    const inner = inlineTokenDisplaySegment(match, options)
    if (!inner) {
      // 图片与 <br> 在展示层不产生文本偏移。
      raw = index + match[0].length
      continue
    }
    if (displayOffset <= shown + inner.text.length) {
      const within = Math.max(0, displayOffset - shown)
      // 标记只是吃掉两侧符号，段内偏移 1:1 即可；链接标签还要递归还原标签内部的行内标记。
      if (inner.rawEnd !== undefined) return index + (within > 0 ? inner.rawEnd : 0)
      if (inner.innerRaw !== undefined) return index + inner.start + rawOffsetForDisplayOffset(inner.innerRaw, within, options)
      return index + inner.start + within
    }
    shown += inner.text.length
    raw = index + match[0].length
  }
  return Math.min(text.length, raw + Math.max(0, displayOffset - shown))
}

// 返回 token 的显示文字及其在原文中的相对起点；无显示文字的 token（图片、换行）返回 null。
// 链接标签保留 innerRaw：显示文字是标签内部行内标记渲染后的结果，点击定位要递归还原偏移。
function inlineTokenDisplaySegment(match: InlineMatch, options: TableInlineOptions): { innerRaw?: string; rawEnd?: number; start: number; text: string } | null {
  const groups = match.groups ?? {}
  if (groups.referenceSource !== undefined) return groups.referenceImage === "true" ? null : {
    innerRaw: groups.referenceLabel, start: 1, text: tableInlineDisplayText(groups.referenceLabel, options),
  }
  if (groups.escape !== undefined) return { start: 1, text: groups.escape.slice(1) }
  if (groups.entity !== undefined) return { rawEnd: match[0].length, start: 0, text: decodeMarkdownEntity(match[0]) }
  if (groups.imageSource !== undefined || groups.break !== undefined) return null
  if (groups.linkLabel !== undefined) {
    return { innerRaw: groups.linkLabel, start: 1, text: tableInlineDisplayText(groups.linkLabel, options) }
  }
  if (groups.bareHref !== undefined) return { start: 0, text: groups.bareHref }
  const marked = groups.strike ?? groups.strongStar ?? groups.strongUnder ?? groups.emStar ?? groups.emUnder
  if (marked !== undefined) return { innerRaw: marked, start: groups.strike !== undefined || groups.strongStar !== undefined || groups.strongUnder !== undefined ? 2 : 1, text: tableInlineDisplayText(marked, options) }
  if (groups.codeText !== undefined) {
    const content = codeSpanContent(groups.codeText)
    return { start: groups.codeFence.length + content.offset, text: content.text }
  }
  return null
}

export function renderTableInlineMarkdown(
  parent: HTMLElement,
  text: string,
  options: TableInlineOptions = {},
  registerObjectUrl?: (url: string) => void,
) {
  let cursor = 0
  for (const match of inlineMatches(text, options)) {
    const index = match.index ?? 0
    if (index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, index)))
    const groups = match.groups ?? {}
    const imageAlt = groups.imageAlt
    const imageSource = groups.imageSource
    const linkLabel = groups.linkLabel
    const linkHref = groups.linkHref
    const strikeText = groups.strike
    const strongText = groups.strongStar ?? groups.strongUnder
    const emphasisText = groups.emStar ?? groups.emUnder
    const codeText = groups.codeText
    const bareHref = groups.bareHref
    const lineBreak = groups.break

    if (groups.referenceSource !== undefined) {
      if (groups.referenceImage === "true") appendMarkdownImage(parent, tableInlineDisplayText(groups.referenceLabel, options), groups.referenceSource, options, registerObjectUrl)
      else appendLink(parent, tableInlineDisplayText(groups.referenceLabel, options), groups.referenceSource, options)
    } else if (groups.escape !== undefined) {
      parent.appendChild(document.createTextNode(groups.escape.slice(1)))
    } else if (groups.entity !== undefined) {
      parent.appendChild(document.createTextNode(decodeMarkdownEntity(match[0])))
    } else if (imageSource !== undefined) {
      appendMarkdownImage(parent, imageAlt ?? "", imageSource, options, registerObjectUrl)
    } else if (linkHref !== undefined || bareHref !== undefined) {
      appendLink(parent, linkLabel !== undefined ? tableInlineDisplayText(linkLabel, options) : bareHref ?? "", linkHref ?? bareHref ?? "", options)
    } else if (strikeText !== undefined) {
      const del = document.createElement("del")
      renderTableInlineMarkdown(del, strikeText, options, registerObjectUrl)
      parent.appendChild(del)
    } else if (strongText !== undefined) {
      const strong = document.createElement("strong")
      renderTableInlineMarkdown(strong, strongText, options, registerObjectUrl)
      parent.appendChild(strong)
    } else if (emphasisText !== undefined) {
      const em = document.createElement("em")
      renderTableInlineMarkdown(em, emphasisText, options, registerObjectUrl)
      parent.appendChild(em)
    } else if (codeText !== undefined) {
      const code = document.createElement("code")
      code.textContent = codeSpanContent(codeText).text
      parent.appendChild(code)
    } else if (lineBreak !== undefined) {
      parent.appendChild(document.createElement("br"))
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)))
}

function decodeMarkdownEntity(source: string) {
  // 只取解析后的 textContent，不把实体结果作为 HTML 插回表格 DOM。
  return new DOMParser().parseFromString(`<body>${source}</body>`, "text/html").body.textContent ?? source
}

function tableInlineDisplayText(source: string, options: TableInlineOptions = {}): string {
  let cursor = 0
  let result = ""
  for (const match of inlineMatches(source, options)) {
    const index = match.index ?? 0
    result += source.slice(cursor, index)
    result += inlineTokenDisplaySegment(match, options)?.text ?? ""
    cursor = index + match[0].length
  }
  return result + source.slice(cursor)
}

function appendLink(parent: HTMLElement, label: string, href: string, options: TableInlineOptions) {
  const link = document.createElement("a")
  link.className = "cm-md-table-link"
  link.textContent = label
  const noteTarget = parseMarkdownNoteHref(href)
  if (noteTarget) link.dataset.mdNoteTarget = noteTarget
  else if (/^(?:https?|mailto):/i.test(href)) link.dataset.mdHref = href
  const hint = noteTarget ? WIKI_HINT : link.dataset.mdHref ? LINK_HINT : href
  link.title = options.requireLinkModifier ? hint.replace("点击", "⌘ 点击") : hint
  link.addEventListener("click", (event) => {
    event.preventDefault()
    // 普通点击继续冒泡给单元格编辑/选区处理；Cmd 点击才交给跳转。
    if (options.requireLinkModifier && !event.metaKey) return
    event.stopPropagation()
    if (noteTarget) options.onOpenWikiLink?.(noteTarget)
    else if (link.dataset.mdHref) openExternalLink(link.dataset.mdHref, options)
  })
  parent.appendChild(link)
}

// cacheScope 给编辑态的图片装饰用：同一张图会随滚动反复挂载，按作用域缓存 Blob URL
// 才不会每次都重读附件。表格单元格不传，沿用原来的「用完即撤销」。
export function appendMarkdownImage(
  parent: HTMLElement,
  alt: string,
  source: string,
  options: TableInlineOptions,
  registerObjectUrl?: (url: string) => void,
  cacheScope?: string,
  onStateChange?: (state: MarkdownImageLoadState) => void,
) {
  const image = document.createElement("img")
  image.alt = alt
  image.className = "cm-md-table-image"
  image.decoding = "async"
  image.loading = "lazy"
  image.addEventListener("load", () => onStateChange?.("loaded"))
  image.addEventListener("error", () => {
    onStateChange?.("error")
    const failure = document.createElement("span")
    failure.className = "cm-md-table-asset-state"
    failure.textContent = `无法读取图片：${alt || source}`
    failure.title = source
    image.replaceWith(failure)
  })
  onStateChange?.("loading")
  if (/^(?:https?:|data:|blob:)/i.test(source)) {
    image.src = source
    parent.appendChild(image)
    return
  }
  if (!options.onResolveAsset) {
    appendAssetState(parent, alt || source)
    onStateChange?.("error")
    return
  }

  const resolveAsset = options.onResolveAsset
  const loading = appendAssetState(parent, alt ? `正在读取图片：${alt}` : "正在读取图片…")
  const objectUrl = cacheScope
    ? resolveCachedImageUrl(cacheScope, source, resolveAsset)
    : resolveAsset(source).then((asset) => {
      if (!asset) return null
      const url = URL.createObjectURL(new Blob([new Uint8Array(asset.data).buffer], { type: asset.mimeType }))
      registerObjectUrl?.(url)
      return url
    })
  void objectUrl.then((url) => {
    if (!url || !loading.isConnected) {
      if (loading.isConnected) {
        loading.textContent = alt ? `无法读取图片：${alt}` : "无法读取图片"
        onStateChange?.("error")
      }
      return
    }
    image.src = url
    loading.replaceWith(image)
  }).catch(() => {
    if (loading.isConnected) {
      loading.textContent = alt ? `无法读取图片：${alt}` : "无法读取图片"
      onStateChange?.("error")
    }
  })
}

function appendAssetState(parent: HTMLElement, label: string) {
  const state = document.createElement("span")
  state.className = "cm-md-table-asset-state"
  state.textContent = label
  parent.appendChild(state)
  return state
}

function openExternalLink(href: string, options: TableInlineOptions) {
  if (options.onOpenExternalLink) {
    options.onOpenExternalLink(href)
    return
  }
  void openExternalUrl(href)
}
