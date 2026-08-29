export function buildRelativeMarkdownHref(fromNotePath: string, targetNotePath: string) {
  const from = normalizePath(fromNotePath)
  const target = normalizePath(targetNotePath)
  if (!from || !target || !/\.md$/i.test(target)) return null

  const fromSegments = from.split("/")
  const targetSegments = target.split("/")
  fromSegments.pop()
  let common = 0
  while (common < fromSegments.length && common < targetSegments.length && fromSegments[common] === targetSegments[common]) common += 1
  const parents = Array.from({ length: fromSegments.length - common }, () => "..")
  const relativeSegments = [...parents, ...targetSegments.slice(common)]
  const relative = relativeSegments.length > 0 ? relativeSegments : [targetSegments[targetSegments.length - 1]]
  // URL 编码让空格、括号和中文文件名在标准 Markdown 解析器中保持无歧义。
  return relative.map((segment) => segment === ".." ? segment : encodeURIComponent(segment)).join("/")
}

export function buildMarkdownNoteLink(title: string, href: string) {
  const label = title.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1") || "未命名笔记"
  return `[${label}](${href})`
}

function normalizePath(value: string) {
  const segments: string[] = []
  for (const segment of value.replace(/\\/g, "/").replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") segments.pop()
    else segments.push(segment)
  }
  return segments.join("/")
}
