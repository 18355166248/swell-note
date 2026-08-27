import { parseMarkdownNoteHref } from "@/services/markdown/markdown-preview-utils"
import type { VaultAsset } from "@/services/vault/vault-adapter"

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
      appendImage(parent, imageAlt ?? "", imageSource, options, registerObjectUrl)
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

function appendImage(
  parent: HTMLElement,
  alt: string,
  source: string,
  options: TableInlineOptions,
  registerObjectUrl?: (url: string) => void,
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

  const loading = appendAssetState(parent, alt ? `正在读取图片：${alt}` : "正在读取图片…")
  void options.onResolveAsset(source).then((asset) => {
    if (!asset || !loading.isConnected) {
      if (loading.isConnected) loading.textContent = alt ? `无法读取图片：${alt}` : "无法读取图片"
      return
    }
    const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(asset.data).buffer], { type: asset.mimeType }))
    registerObjectUrl?.(objectUrl)
    image.src = objectUrl
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
  window.open(href, "_blank", "noopener,noreferrer")
}
