import { parseMarkdownNoteHref } from "@/services/markdown/markdown-preview-utils"
import { openExternalUrl } from "@/services/open-external-url"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import { resolveCachedImageUrl } from "./markdown-image-cache"

export type TableInlineOptions = {
  onOpenExternalLink?: (href: string) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  tableStorageKey?: string
}

const LINK_HINT = "点击打开链接"
const WIKI_HINT = "点击打开笔记"

// 行内内容始终使用 DOM API 和 textContent 装配，不解析原始 HTML，避免云端笔记形成注入面。
// 下划线强调要求两侧不是字母数字，避免把 snake_case_name 错误渲染成强调。
const tableInlinePattern
  = /!\[([^\]\n]*)\]\((\S+?)(?:\s+["'][^"']*["'])?\)|\[([^\]\n]+)\]\((\S+?)(?:\s+["'][^"']*["'])?\)|~~(.+?)~~|\*\*(.+?)\*\*|(?<![\p{L}\p{N}])__(.+?)__(?![\p{L}\p{N}])|\*(.+?)\*|(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])|`([^`]+)`|(https?:\/\/[^\s<>]+)|(<br\s*\/?>)/giu

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
