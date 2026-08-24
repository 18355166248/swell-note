const WIKI_SCHEME = "swell-note://wiki/"
const ASSET_SCHEME = "swell-note://asset/"
const imageExtensionPattern = /\.(avif|gif|jpe?g|png|svg|webp)$/i

function rewriteEmbeddedAssetsInLine(line: string) {
  return line.replace(/!\[\[([^\[\]\n]+)\]\]/g, (match, value: string) => {
    const [rawTarget, rawAlias] = value.split("|", 2)
    const target = rawTarget.trim()
    if (!target) return match
    const label = rawAlias?.trim() || target.split("/").pop() || "附件"
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

export function isRelativeAttachmentHref(href?: string) {
  if (!href || href.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(href)) return false
  if (/(?:^|\/)attachments\/[^?#]+(?:[?#].*)?$/i.test(href.replace(/\\/g, "/"))) return true
  // Vault 内的相对链接除 Markdown 笔记外都按附件处理，保证上传的任意格式文件都能在预览里打开。
  return /\.[a-z\d]{1,8}(?:[?#].*)?$/i.test(href) && !/\.md(?:[?#].*)?$/i.test(href)
}
