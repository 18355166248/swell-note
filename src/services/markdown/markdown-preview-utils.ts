const WIKI_SCHEME = "swell-note://wiki/"

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
      return fencedCode ? line : rewriteWikiLinksInLine(line)
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
