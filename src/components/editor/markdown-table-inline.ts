import { parseMarkdownNoteHref } from "@/services/markdown/markdown-preview-utils"
import { openExternalUrl } from "@/services/open-external-url"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import { resolveCachedImageUrl } from "./markdown-image-cache"

export type TableInlineOptions = {
  onOpenExternalLink?: (href: string) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  // 单元格进入/退出编辑以及编辑中移动选区时，向工具栏汇报行内格式状态；null 表示离开单元格编辑。
  onTableFormatState?: (state: { code: boolean; emphasis: boolean; strike: boolean; strong: boolean } | null) => void
  tableStorageKey?: string
}

const LINK_HINT = "点击打开链接"
const WIKI_HINT = "点击打开笔记"

// 行内内容始终使用 DOM API 和 textContent 装配，不解析原始 HTML，避免云端笔记形成注入面。
// 下划线强调要求两侧不是字母数字，避免把 snake_case_name 错误渲染成强调。
const tableInlinePattern
  = /!\[([^\]\n]*)\]\((\S+?)(?:\s+["'][^"']*["'])?\)|\[([^\]\n]+)\]\((\S+?)(?:\s+["'][^"']*["'])?\)|~~(.+?)~~|\*\*(.+?)\*\*|(?<![\p{L}\p{N}])__(.+?)__(?![\p{L}\p{N}])|\*(.+?)\*|(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])|`([^`]+)`|(https?:\/\/[^\s<>]+)|(<br\s*\/?>)/giu

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
    if (displayOffset <= shown + inner.text.length) return index + inner.start + Math.max(0, displayOffset - shown)
    shown += inner.text.length
    raw = index + match[0].length
  }
  return Math.min(text.length, raw + Math.max(0, displayOffset - shown))
}

// 返回 token 的显示文字及其在原文中的相对起点；无显示文字的 token（图片、换行）返回 null。
function inlineTokenDisplaySegment(match: RegExpMatchArray): { start: number; text: string } | null {
  if (match[2] !== undefined || match[12] !== undefined) return null
  if (match[3] !== undefined) return { start: 1, text: match[3] }
  if (match[11] !== undefined) return { start: 0, text: match[11] }
  if (match[5] !== undefined) return { start: 2, text: match[5] }
  if (match[6] !== undefined) return { start: 2, text: match[6] }
  if (match[7] !== undefined) return { start: 2, text: match[7] }
  if (match[8] !== undefined) return { start: 1, text: match[8] }
  if (match[9] !== undefined) return { start: 1, text: match[9] }
  if (match[10] !== undefined) return { start: 1, text: match[10] }
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
    const imageAlt = match[1]
    const imageSource = match[2]
    const linkLabel = match[3]
    const linkHref = match[4]
    const strikeText = match[5]
    const strongText = match[6] ?? match[7]
    const emphasisText = match[8] ?? match[9]
    const codeText = match[10]
    const bareHref = match[11]
    const lineBreak = match[12]

    if (imageSource !== undefined) {
      appendMarkdownImage(parent, imageAlt ?? "", imageSource, options, registerObjectUrl)
    } else if (linkHref !== undefined || bareHref !== undefined) {
      appendLink(parent, linkLabel ?? bareHref ?? "", linkHref ?? bareHref ?? "", options)
    } else if (strikeText !== undefined) {
      const del = document.createElement("del")
      del.textContent = strikeText
      parent.appendChild(del)
    } else if (strongText !== undefined) {
      const strong = document.createElement("strong")
      strong.textContent = strongText
      parent.appendChild(strong)
    } else if (emphasisText !== undefined) {
      const em = document.createElement("em")
      em.textContent = emphasisText
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

function appendLink(parent: HTMLElement, label: string, href: string, options: TableInlineOptions) {
  const link = document.createElement("a")
  link.className = "cm-md-table-link"
  link.textContent = label
  const noteTarget = parseMarkdownNoteHref(href)
  if (noteTarget) link.dataset.mdNoteTarget = noteTarget
  else if (/^(?:https?|mailto):/i.test(href)) link.dataset.mdHref = href
  link.title = noteTarget ? WIKI_HINT : link.dataset.mdHref ? LINK_HINT : href
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
) {
  const image = document.createElement("img")
  image.alt = alt
  image.className = "cm-md-table-image"
  image.decoding = "async"
  image.loading = "lazy"
  image.addEventListener("error", () => {
    const failure = document.createElement("span")
    failure.className = "cm-md-table-asset-state"
    failure.textContent = `无法读取图片：${alt || source}`
    failure.title = source
    image.replaceWith(failure)
  })
  if (/^(?:https?:|data:|blob:)/i.test(source)) {
    image.src = source
    parent.appendChild(image)
    return
  }
  if (!options.onResolveAsset) {
    appendAssetState(parent, alt || source)
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
      if (loading.isConnected) loading.textContent = alt ? `无法读取图片：${alt}` : "无法读取图片"
      return
    }
    image.src = url
    loading.replaceWith(image)
  }).catch(() => {
    if (loading.isConnected) loading.textContent = alt ? `无法读取图片：${alt}` : "无法读取图片"
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
