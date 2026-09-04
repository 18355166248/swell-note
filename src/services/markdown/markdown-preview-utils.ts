const WIKI_SCHEME = "swell-note://wiki/"
const ASSET_SCHEME = "swell-note://asset/"
const EMBED_SCHEME = "swell-note://embed/"
const imageExtensionPattern = /\.(avif|gif|jpe?g|png|svg|webp)$/i
const fileExtensionPattern = /\.[a-z\d]{1,8}(?:#.*)?$/i
// 旧 Vault 图片尺寸别名：|300 只限宽，|300x200 同时限高；仅用于读取历史内容。
const imageSizePattern = /^(\d+)(?:x(\d+))?$/
const hybridMarkdownImagePattern = /!\[\[([^\[\]\n]+)\]\]\(/g

// 判断一个 Vault 内的相对路径是不是图片；编辑态决定 ![[...]] 要不要渲染成图片时共用同一份判断。
export function isImageAssetPath(path: string) {
  return imageExtensionPattern.test(path)
}

function rewriteHybridMarkdownImagesInLine(line: string) {
  // 兼容历史内容里的 ![[说明|300]](path) 混合写法，统一转换为标准 Markdown 图片后再解析。
  return line.replace(hybridMarkdownImagePattern, "![$1](")
}

function rewriteEmbeddedAssetsInLine(line: string) {
  return line.replace(/!\[\[([^\[\]\n]+)\]\]/g, (match, value: string) => {
    const [rawTarget, rawAlias] = value.split("|", 2)
    const target = rawTarget.trim()
    if (!target) return match
    const alias = rawAlias?.trim() ?? ""
    const label = alias || target.split("/").pop() || "附件"
    if (!fileExtensionPattern.test(target) || /\.md(?:#.*)?$/i.test(target)) {
      return `[${label}](${EMBED_SCHEME}${encodeURIComponent(target)})`
    }
    const href = `${ASSET_SCHEME}${encodeURIComponent(target)}`
    if (imageExtensionPattern.test(target)) {
      const size = alias.match(imageSizePattern)
      if (size) {
        const dimensions = size[2] ? `${size[1]}x${size[2]}` : size[1]
        return `![${target.split("/").pop() || "图片"}](${href} "${dimensions}")`
      }
      return `![${label}](${href})`
    }
    return `[${label}](${href})`
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
      if (fencedCode) return line
      const normalized = rewriteHybridMarkdownImagesInLine(line)
      return rewriteWikiLinksInLine(rewriteEmbeddedAssetsInLine(normalized))
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

export function parseMarkdownNoteHref(href?: string) {
  const value = href?.trim().replace(/^<|>$/g, "")
  if (!value || value.startsWith("#") || value.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(value)) return null
  const notePart = value.split("#", 1)[0].split("?", 1)[0]
  if (!/\.md$/i.test(notePart)) return null
  try {
    return decodeURIComponent(value).replace(/\\/g, "/")
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

const headingPattern = /^(#{1,6})\s+(.+?)\s*$/
const blockIdPattern = /(?:^|\s)(\^[\w-]+)\s*$/
const listItemPattern = /^(\s*)(?:[-*+]|\d+[.)])\s+/

function lineIndent(value: string) {
  return value.match(/^\s*/)?.[0].length ?? 0
}

function normalizeHeadingText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase()
}

// Obsidian 的标题锚点大小写不敏感；块引用（^id）可以出现在段落末尾、列表项末尾或独立成行引用上一个块。
function splitBodyLines(content: string) {
  return stripMarkdownFrontmatter(content).replace(/\r\n?/g, "\n").split("\n")
}

function trimBlankLines(lines: string[]) {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start += 1
  while (end > start && !lines[end - 1].trim()) end -= 1
  return lines.slice(start, end).join("\n")
}

function extractBlockSection(lines: string[], blockId: string) {
  let fenced = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    const match = line.match(blockIdPattern)
    if (!match || match[1].slice(1) !== blockId) continue

    const body = line.slice(0, match.index).trimEnd()
    if (!body) return trimBlankLines(lines.slice(blockStartAbove(lines, index), index))
    if (listItemPattern.test(body)) return extractListItemBlock(lines, index, body)
    return trimBlankLines([...lines.slice(paragraphStartAbove(lines, index), index), body])
  }
  return null
}

// 独立成行的 ^id 引用它上方连续非空的整个块（可能是多行列表或表格）。
function blockStartAbove(lines: string[], idLine: number) {
  let start = idLine
  while (start > 0 && lines[start - 1].trim()) start -= 1
  return start
}

// 段落/表格末尾的 ^id：向上合并同一个段落的连续非空行，遇到标题或空行停止。
function paragraphStartAbove(lines: string[], idLine: number) {
  let start = idLine
  while (start > 0 && lines[start - 1].trim() && !headingPattern.test(lines[start - 1])) start -= 1
  return start
}

// 列表项末尾的 ^id：只引用该列表项及其缩进更深的子项。
function extractListItemBlock(lines: string[], idLine: number, body: string) {
  const itemIndent = lineIndent(body)
  let end = idLine
  while (end + 1 < lines.length) {
    const next = lines[end + 1]
    if (next.trim() && lineIndent(next) <= itemIndent) break
    if (!next.trim()) {
      const nextNonBlank = lines.slice(end + 2).find((candidate) => candidate.trim())
      if (!nextNonBlank || lineIndent(nextNonBlank) <= itemIndent) break
    }
    end += 1
  }
  return trimBlankLines([body, ...lines.slice(idLine + 1, end + 1)])
}

function extractHeadingSection(lines: string[], anchor: string) {
  const segments = anchor.split("#").map((segment) => segment.trim()).filter(Boolean)
  let cursor = 0
  let start = -1
  let level = 0
  for (const segment of segments) {
    const found = findHeadingLine(lines, segment, cursor)
    if (!found) return null
    start = found.index
    level = found.level
    cursor = found.index + 1
  }

  // 小节延伸到下一个同级或更高级标题之前，含标题行本身。
  let end = lines.length
  let fenced = false
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const heading = line.match(headingPattern)
    if (heading && heading[1].length <= level) {
      end = index
      break
    }
  }
  const section = trimBlankLines(lines.slice(start, end))
  return section || null
}

function findHeadingLine(lines: string[], anchor: string, from: number) {
  const expected = normalizeHeadingText(anchor)
  let fenced = false
  for (let index = from; index < lines.length; index++) {
    const line = lines[index]
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = line.match(headingPattern)
    if (match && normalizeHeadingText(match[2]) === expected) return { index, level: match[1].length }
  }
  return null
}

// 嵌入引用（![[笔记#^块id]] / ![[笔记#标题]]）只返回被引用的块或小节；锚点无效时返回 null 由调用方降级。
export function extractEmbeddedSection(content: string, anchor: string): string | null {
  const trimmedAnchor = anchor.trim()
  if (!trimmedAnchor) return null
  const lines = splitBodyLines(content)
  const section = trimmedAnchor.startsWith("^")
    ? extractBlockSection(lines, trimmedAnchor.slice(1))
    : extractHeadingSection(lines, trimmedAnchor)
  return section?.trim() ? section : null
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

// 预览正文去掉了 frontmatter，hast 行号换算回源文件行号时需要补回这段偏移。
export function frontmatterLineCount(content: string) {
  const match = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  return match ? match[0].split("\n").length - 1 : 0
}

export function isRelativeAttachmentHref(href?: string) {
  if (!href || href.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(href)) return false
  if (/(?:^|\/)attachments\/[^?#]+(?:[?#].*)?$/i.test(href.replace(/\\/g, "/"))) return true
  // Vault 内的相对链接除 Markdown 笔记外都按附件处理，保证上传的任意格式文件都能在预览里打开。
  return /\.[a-z\d]{1,8}(?:[?#].*)?$/i.test(href) && !/\.md(?:[?#].*)?$/i.test(href)
}
