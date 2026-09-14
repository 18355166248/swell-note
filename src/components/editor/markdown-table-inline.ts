import { parseMarkdownNoteHref } from "@/services/markdown/markdown-preview-utils"
import { openExternalUrl } from "@/services/open-external-url"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import { resolveCachedImageUrl } from "./markdown-image-cache"
import type { EditorLinkTap } from "./markdown-input"

export type TableInlineOptions = {
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

// 表格列宽有限，完整 URL（尤其带大段编码参数的设计稿链接）会任意断行、把整行撑到
// 十几行高。显示文本超过阈值时先剥协议头，再中段省略；完整地址保留在 title 与点击行为里。
// 编辑态与阅读态共用这一套规则，两态看到同一截断结果。
// 头尾长度同时被 rawOffsetInLinkLabel 用于点击定位，调整阈值时两边必须保持一致。
const LINK_LABEL_MAX = 40
const LINK_LABEL_TAIL = Math.min(10, Math.floor((LINK_LABEL_MAX - 1) / 3))
const LINK_LABEL_HEAD = LINK_LABEL_MAX - 1 - LINK_LABEL_TAIL

export function truncateLinkLabel(label: string, max = LINK_LABEL_MAX): string {
  const text = label.replace(/^https?:\/\//i, "")
  if (text.length <= max) return text
  const tailLength = Math.min(10, Math.floor((max - 1) / 3))
  const headLength = max - 1 - tailLength
  return `${text.slice(0, headLength)}…${text.slice(-tailLength)}`
}

// 剥协议头与中段省略都会让显示偏移与原文偏移脱节：显示 example.com 末尾是第 11 位，
// 原文里却是第 19 位。点击定位沿 truncateLinkLabel 的同一套规则把显示偏移还原回原文：
// 头部 1:1，省略号右侧落到尾部在原文中的起点，尾部按剩余偏移 1:1。
function rawOffsetInLinkLabel(label: string, displayOffset: number): number {
  const protocol = label.match(/^https?:\/\//i)?.[0].length ?? 0
  const strippedLength = label.length - protocol
  if (strippedLength <= LINK_LABEL_MAX) return Math.min(label.length, protocol + displayOffset)
  if (displayOffset <= LINK_LABEL_HEAD) return protocol + displayOffset
  const tailStart = label.length - LINK_LABEL_TAIL
  return Math.min(label.length, tailStart + Math.max(0, displayOffset - LINK_LABEL_HEAD - 1))
}

// 行内内容始终使用 DOM API 和 textContent 装配，不解析原始 HTML，避免云端笔记形成注入面。
// 下划线强调要求两侧不是字母数字，避免把 snake_case_name 错误渲染成强调。
const tableInlinePattern
  = /(?<escape>\\[!"#$%&'()*+,\-.\/:;<=>?@[\]^_`{|}~])|(?<entity>&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)|!\[(?<imageAlt>(?:\\.|[^\]\\\n])*)\]\((?<imageSource>\S+?)(?:\s+["'][^"']*["'])?\)|\[(?<linkLabel>(?:\\.|[^\]\\\n])+)\]\((?<linkHref>\S+?)(?:\s+["'][^"']*["'])?\)|~~(?<strike>(?:\\.|(?!~~).)+?)~~|\*\*(?<strongStar>(?:\\.|(?!\*\*).)+?)\*\*|(?<![\p{L}\p{N}])__(?<strongUnder>(?:\\.|(?!__).)+?)__(?![\p{L}\p{N}])|\*(?<emStar>(?:\\.|[^*])+?)\*|(?<![\p{L}\p{N}])_(?<emUnder>(?:\\.|[^_])+?)_(?![\p{L}\p{N}])|(?<codeFence>`+)(?<codeText>.+?)\k<codeFence>|(?<bareHref>https?:\/\/[^\s<>]+)|(?<break><br\s*\/?>)/gisu

// 单元格点击定位：展示层渲染后的文字偏移 ↔ 原始 Markdown 偏移。
// 展示层会吃掉标记字符（**加粗** 只显示「加粗」），直接用 DOM 偏移会落进标记内部，
// 这里沿同一条行内正则把每个 token 的显示文字映射回它在原文里的起点。
export function rawOffsetForDisplayOffset(text: string, displayOffset: number): number {
  let raw = 0
  let shown = 0
  for (const match of text.matchAll(tableInlinePattern)) {
    const index = match.index ?? 0
    // token 前的普通文本段非空时，落在段内的偏移按 1:1 映射；段为空（offset 0 处就是 token）
    // 不能在这里截获，否则光标会落到标记起点之前。
    if (index > raw && displayOffset <= shown + (index - raw)) return raw + Math.max(0, displayOffset - shown)
    shown += index - raw
    const inner = inlineTokenDisplaySegment(match)
    if (!inner) {
      // 图片与 <br> 在展示层不产生文本偏移。
      raw = index + match[0].length
      continue
    }
    if (displayOffset <= shown + inner.text.length) {
      const within = Math.max(0, displayOffset - shown)
      // 链接显示文本经过截短，段内偏移要按截断规则还原；其余标记只是吃掉两侧符号，1:1 即可。
      if (inner.rawEnd !== undefined) return index + (within > 0 ? inner.rawEnd : 0)
      if (inner.innerRaw !== undefined) {
        const decodedOffset = inner.label !== undefined ? rawOffsetInLinkLabel(inner.label, within) : within
        return index + inner.start + rawOffsetForDisplayOffset(inner.innerRaw, decodedOffset)
      }
      return index + inner.start + (inner.label !== undefined ? rawOffsetInLinkLabel(inner.label, within) : within)
    }
    shown += inner.text.length
    raw = index + match[0].length
  }
  return Math.min(text.length, raw + Math.max(0, displayOffset - shown))
}

// 返回 token 的显示文字及其在原文中的相对起点；无显示文字的 token（图片、换行）返回 null。
// 链接附带原始 label：显示文字是 truncateLinkLabel 的截断结果，点击定位需要原文才能还原偏移。
function inlineTokenDisplaySegment(match: RegExpMatchArray): { innerRaw?: string; label?: string; rawEnd?: number; start: number; text: string } | null {
  const groups = match.groups ?? {}
  if (groups.escape !== undefined) return { start: 1, text: groups.escape.slice(1) }
  if (groups.entity !== undefined) return { rawEnd: match[0].length, start: 0, text: decodeMarkdownEntity(match[0]) }
  if (groups.imageSource !== undefined || groups.break !== undefined) return null
  if (groups.linkLabel !== undefined) {
    const label = tableInlineDisplayText(groups.linkLabel)
    return { innerRaw: groups.linkLabel, label, start: 1, text: truncateLinkLabel(label) }
  }
  if (groups.bareHref !== undefined) return { label: groups.bareHref, start: 0, text: truncateLinkLabel(groups.bareHref) }
  const marked = groups.strike ?? groups.strongStar ?? groups.strongUnder ?? groups.emStar ?? groups.emUnder
  if (marked !== undefined) return { innerRaw: marked, start: groups.strike !== undefined || groups.strongStar !== undefined || groups.strongUnder !== undefined ? 2 : 1, text: tableInlineDisplayText(marked) }
  if (groups.codeText !== undefined) return { start: groups.codeFence.length, text: groups.codeText }
  return null
}

export function renderTableInlineMarkdown(
  parent: HTMLElement,
  text: string,
  options: TableInlineOptions = {},
  registerObjectUrl?: (url: string) => void,
) {
  let cursor = 0
  for (const match of text.matchAll(tableInlinePattern)) {
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

    if (groups.escape !== undefined) {
      parent.appendChild(document.createTextNode(groups.escape.slice(1)))
    } else if (groups.entity !== undefined) {
      parent.appendChild(document.createTextNode(decodeMarkdownEntity(match[0])))
    } else if (imageSource !== undefined) {
      appendMarkdownImage(parent, imageAlt ?? "", imageSource, options, registerObjectUrl)
    } else if (linkHref !== undefined || bareHref !== undefined) {
      appendLink(parent, linkLabel !== undefined ? tableInlineDisplayText(linkLabel) : bareHref ?? "", linkHref ?? bareHref ?? "", options)
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
      code.textContent = codeText
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

function tableInlineDisplayText(source: string): string {
  let cursor = 0
  let result = ""
  for (const match of source.matchAll(tableInlinePattern)) {
    const index = match.index ?? 0
    result += source.slice(cursor, index)
    result += inlineTokenDisplaySegment(match)?.text ?? ""
    cursor = index + match[0].length
  }
  return result + source.slice(cursor)
}

function appendLink(parent: HTMLElement, label: string, href: string, options: TableInlineOptions) {
  const link = document.createElement("a")
  link.className = "cm-md-table-link"
  const display = truncateLinkLabel(label)
  link.textContent = display
  const noteTarget = parseMarkdownNoteHref(href)
  if (noteTarget) link.dataset.mdNoteTarget = noteTarget
  else if (/^(?:https?|mailto):/i.test(href)) link.dataset.mdHref = href
  const hint = noteTarget ? WIKI_HINT : link.dataset.mdHref ? LINK_HINT : href
  // 截短后悬停要能看到完整原文。
  link.title = display !== label ? `${label}\n${hint}` : hint
  link.addEventListener("click", (event) => {
    event.preventDefault()
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
