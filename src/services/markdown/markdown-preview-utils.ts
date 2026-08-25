const WIKI_SCHEME = "swell-note://wiki/"
const ASSET_SCHEME = "swell-note://asset/"
const EMBED_SCHEME = "swell-note://embed/"
const imageExtensionPattern = /\.(avif|gif|jpe?g|png|svg|webp)$/i
const fileExtensionPattern = /\.[a-z\d]{1,8}(?:#.*)?$/i

function rewriteEmbeddedAssetsInLine(line: string) {
  return line.replace(/!\[\[([^\[\]\n]+)\]\]/g, (match, value: string) => {
    const [rawTarget, rawAlias] = value.split("|", 2)
    const target = rawTarget.trim()
    if (!target) return match
    const label = rawAlias?.trim() || target.split("/").pop() || "附件"
    if (!fileExtensionPattern.test(target) || /\.md(?:#.*)?$/i.test(target)) {
      return `[${label}](${EMBED_SCHEME}${encodeURIComponent(target)})`
    }
    const href = `${ASSET_SCHEME}${encodeURIComponent(target)}`
    return imageExtensionPattern.test(target) ? `![${label}](${href})` : `[${label}](${href})`
  })
}

function rewriteWikiLinksInLine(line: string) {
  return line.replace(/\[\[([^\[\]\n]+)\]\]/g, (match, value: string) => {
    const [rawTarget, rawAlias] = value.split("|", 2)
    const target = rawTarget.trim()
    if (!target) return match

    const label = rawAlias?.trim() || target.replace(/#.*$/, "")
    return `[${label}](${WIKI_SCHEME}${encodeURIComponent(target)})`
  })
}

export function rewriteWikiLinks(content: string) {
  let fencedCode = false

  // Wiki 链接只在正文中转换；围栏代码块必须保持原文，避免预览改变代码语义。
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fencedCode = !fencedCode
        return line
      }
      return fencedCode ? line : rewriteWikiLinksInLine(rewriteEmbeddedAssetsInLine(line))
    })
    .join("\n")
}

export function parseWikiHref(href?: string) {
  if (!href?.startsWith(WIKI_SCHEME)) return null

  try {
    return decodeURIComponent(href.slice(WIKI_SCHEME.length))
  } catch {
    return null
  }
}

export function parseVaultAssetHref(href?: string) {
  if (!href?.startsWith(ASSET_SCHEME)) return null

  try {
    return decodeURIComponent(href.slice(ASSET_SCHEME.length))
  } catch {
    return null
  }
}

export function parseWikiEmbedHref(href?: string) {
  if (!href?.startsWith(EMBED_SCHEME)) return null

  try {
    return decodeURIComponent(href.slice(EMBED_SCHEME.length))
  } catch {
    return null
  }
}

export function splitWikiTarget(target: string) {
  const separator = target.indexOf("#")
  return separator < 0
    ? { anchor: "", noteTarget: target }
    : { anchor: target.slice(separator + 1).trim(), noteTarget: target.slice(0, separator).trim() }
}

export function obsidianAnchorId(value: string) {
  const normalized = value.trim().replace(/^\^/, "")
  if (!normalized) return ""
  if (value.trim().startsWith("^")) return `block-${normalized}`
  return normalized
    .toLocaleLowerCase()
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function isExcalidrawMarkdown(content: string) {
  return /^---[\s\S]*?^excalidraw-plugin:\s*.+$[\s\S]*?^---/m.test(content)
    || /^# Excalidraw Data\s*$/m.test(content)
}

export function extractExcalidrawTextElements(content: string) {
  const section = content.match(/^## Text Elements\s*\r?\n([\s\S]*?)(?=^%%\s*$|^## (?:Embedded Files|Drawing)\s*$)/m)?.[1] ?? ""
  return section
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+\^[\w-]+\s*$/, "").trim())
    .filter(Boolean)
}

export function stripMarkdownFrontmatter(content: string) {
  return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
}

export function isRelativeAttachmentHref(href?: string) {
  if (!href || href.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(href)) return false
  if (/(?:^|\/)attachments\/[^?#]+(?:[?#].*)?$/i.test(href.replace(/\\/g, "/"))) return true
  // Vault 内的相对链接除 Markdown 笔记外都按附件处理，保证上传的任意格式文件都能在预览里打开。
  return /\.[a-z\d]{1,8}(?:[?#].*)?$/i.test(href) && !/\.md(?:[?#].*)?$/i.test(href)
}
