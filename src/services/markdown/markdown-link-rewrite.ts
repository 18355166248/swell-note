export type MarkdownPathMove = {
  fromPath: string
  kind?: "directory" | "file"
  toPath: string
}

export type MarkdownLinkRewriteResult = {
  changedCount: number
  content: string
}

const inlineLinkPattern = /(!?\[(?:\\.|[^\]])*\]\(\s*)(<[^>\n]+>|(?:\\.|[^)\s])+)(?=(?:\s+(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\((?:\\.|[^)])*\)))?\s*\))/g
const referenceLinkPattern = /^(\s{0,3}\[(?!\^)[^\]\n]+\]:\s*)(<[^>\n]+>|\S+)/
const fencePattern = /^\s{0,3}(`{3,}|~{3,})/
const externalDestinationPattern = /^[a-z][a-z0-9+.-]*:/i

/**
 * 在文件或目录移动后修复标准 Markdown 相对链接。
 * 这里同时重算“被移动文档自身”的相对路径和其他文档指向移动目标的入链，
 * 但刻意跳过代码块、行内代码、外链和根路径，避免误改示例文本或非 Vault 资源。
 */
export function rewriteMarkdownLinksForMoves(
  content: string,
  documentPath: string,
  moves: MarkdownPathMove[],
): MarkdownLinkRewriteResult {
  const normalizedMoves = moves
    .map((move) => ({
      fromPath: normalizeMarkdownPath(move.fromPath),
      kind: move.kind ?? "file",
      toPath: normalizeMarkdownPath(move.toPath),
    }))
    .filter((move) => move.fromPath && move.toPath && move.fromPath !== move.toPath)
    .sort((left, right) => right.fromPath.length - left.fromPath.length)

  if (normalizedMoves.length === 0 || !content) return { changedCount: 0, content }

  const oldDocumentPath = normalizeMarkdownPath(documentPath)
  const newDocumentPath = applyMoves(oldDocumentPath, normalizedMoves)
  let changedCount = 0
  let activeFence: { marker: string; size: number } | null = null

  const parts = content.split(/(\r?\n)/)
  const rewritten = parts.map((part, index) => {
    if (index % 2 === 1) return part

    const fence = part.match(fencePattern)?.[1]
    if (fence) {
      const marker = fence[0]
      if (!activeFence) activeFence = { marker, size: fence.length }
      else if (activeFence.marker === marker && fence.length >= activeFence.size) activeFence = null
      return part
    }
    if (activeFence) return part

    const protectedRanges = findInlineCodeRanges(part)
    let line = part.replace(inlineLinkPattern, (match, prefix: string, destination: string, offset: number) => {
      if (isProtectedOffset(offset, protectedRanges)) return match
      const next = rewriteDestination(destination, oldDocumentPath, newDocumentPath, normalizedMoves)
      if (next === destination) return match
      changedCount += 1
      return `${prefix}${next}`
    })

    const reference = line.match(referenceLinkPattern)
    if (reference && !isProtectedOffset(reference.index ?? 0, protectedRanges)) {
      const destination = reference[2]
      const next = rewriteDestination(destination, oldDocumentPath, newDocumentPath, normalizedMoves)
      if (next !== destination) {
        line = `${reference[1]}${next}${line.slice(reference[0].length)}`
        changedCount += 1
      }
    }
    return line
  }).join("")

  return { changedCount, content: rewritten }
}

export function resolveMarkdownMovedPath(path: string, moves: MarkdownPathMove[]) {
  const hasLeadingSlash = path.replace(/\\/g, "/").startsWith("/")
  const normalizedMoves = moves
    .map((move) => ({
      fromPath: normalizeMarkdownPath(move.fromPath),
      kind: move.kind ?? "file",
      toPath: normalizeMarkdownPath(move.toPath),
    }))
    .filter((move) => move.fromPath && move.toPath && move.fromPath !== move.toPath)
    .sort((left, right) => right.fromPath.length - left.fromPath.length)
  const moved = applyMoves(normalizeMarkdownPath(path), normalizedMoves)
  return hasLeadingSlash && moved ? `/${moved}` : moved
}

function rewriteDestination(
  rawDestination: string,
  oldDocumentPath: string,
  newDocumentPath: string,
  moves: Array<Required<MarkdownPathMove>>,
) {
  const wrapped = rawDestination.startsWith("<") && rawDestination.endsWith(">")
  const destination = wrapped ? rawDestination.slice(1, -1) : rawDestination
  if (
    !destination
    || destination.startsWith("#")
    || destination.startsWith("/")
    || destination.startsWith("//")
    || externalDestinationPattern.test(destination)
  ) return rawDestination

  const suffixIndex = destination.search(/[?#]/)
  const rawPath = suffixIndex >= 0 ? destination.slice(0, suffixIndex) : destination
  const suffix = suffixIndex >= 0 ? destination.slice(suffixIndex) : ""
  if (!rawPath) return rawDestination

  const decodedPath = decodePathSegments(rawPath)
  const oldTargetPath = normalizeMarkdownPath(`${dirname(oldDocumentPath)}/${decodedPath}`)
  const newTargetPath = applyMoves(oldTargetPath, moves)
  if (oldDocumentPath === newDocumentPath && oldTargetPath === newTargetPath) return rawDestination

  const nextPath = buildRelativePath(newDocumentPath, newTargetPath)
  if (!nextPath) return rawDestination
  const nextDestination = `${nextPath}${suffix}`
  return wrapped ? `<${nextDestination}>` : nextDestination
}

function applyMoves(path: string, moves: Array<Required<MarkdownPathMove>>) {
  for (const move of moves) {
    if (path === move.fromPath) return move.toPath
    if (move.kind === "directory" && path.startsWith(`${move.fromPath}/`)) {
      return `${move.toPath}${path.slice(move.fromPath.length)}`
    }
  }
  return path
}

function buildRelativePath(fromDocumentPath: string, targetPath: string) {
  const fromSegments = normalizeMarkdownPath(fromDocumentPath).split("/").filter(Boolean)
  const targetSegments = normalizeMarkdownPath(targetPath).split("/").filter(Boolean)
  fromSegments.pop()
  let common = 0
  while (
    common < fromSegments.length
    && common < targetSegments.length
    && fromSegments[common] === targetSegments[common]
  ) common += 1

  const parents = Array.from({ length: fromSegments.length - common }, () => "..")
  const relative = [...parents, ...targetSegments.slice(common)]
  if (relative.length === 0) return ""
  return relative
    .map((segment) => segment === ".." ? segment : encodeURIComponent(segment))
    .join("/")
}

function dirname(path: string) {
  const normalized = normalizeMarkdownPath(path)
  const separator = normalized.lastIndexOf("/")
  return separator >= 0 ? normalized.slice(0, separator) : ""
}

function decodePathSegments(path: string) {
  return path.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  }).join("/")
}

function normalizeMarkdownPath(value: string) {
  const segments: string[] = []
  for (const segment of value.replace(/\\/g, "/").replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") segments.pop()
    else segments.push(segment)
  }
  return segments.join("/")
}

function findInlineCodeRanges(line: string) {
  const ranges: Array<[number, number]> = []
  let cursor = 0
  while (cursor < line.length) {
    if (line[cursor] !== "`") {
      cursor += 1
      continue
    }
    let size = 1
    while (line[cursor + size] === "`") size += 1
    const marker = "`".repeat(size)
    const end = line.indexOf(marker, cursor + size)
    if (end < 0) break
    ranges.push([cursor, end + size])
    cursor = end + size
  }
  return ranges
}

function isProtectedOffset(offset: number, ranges: Array<[number, number]>) {
  return ranges.some(([start, end]) => offset >= start && offset < end)
}
