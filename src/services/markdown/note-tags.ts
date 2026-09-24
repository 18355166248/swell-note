import { extractFrontmatter } from "@/services/search/note-index"

const MAX_TAGS = 30
const MAX_TAG_LENGTH = 50

export function parseEditableTags(input: string) {
  const tags: string[] = []
  const seen = new Set<string>()
  for (const raw of input.split(/[,，]/)) {
    const tag = raw.trim().replace(/^#/, "").trim()
    if (!tag) continue
    if (tag.length > MAX_TAG_LENGTH || /[\r\n\[\]"'\\\x00-\x1f]/.test(tag)) {
      throw new Error(`标签“${tag}”包含不支持的字符或超过 ${MAX_TAG_LENGTH} 字`)
    }
    const key = tag.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      tags.push(tag)
    }
  }
  if (tags.length > MAX_TAGS) throw new Error(`一篇笔记最多保留 ${MAX_TAGS} 个标签`)
  return tags
}

export function setNoteTags(content: string, tags: readonly string[]) {
  const current = extractFrontmatter(content).tags
  if (current.length === tags.length && current.every((tag, index) => tag === tags[index])) return content

  const newline = content.includes("\r\n") ? "\r\n" : "\n"
  const tagLine = `tags: [${tags.map((tag) => `"${tag}"`).join(", ")}]`
  const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(content)
  if (!frontmatter) {
    if (tags.length === 0) return content
    return `---${newline}${tagLine}${newline}---${newline}${newline}${content}`
  }

  const lines = frontmatter[1].split(/\r?\n/)
  const preserved: string[] = []
  let insertAt = -1
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(tags?):[ \t]*(.*)$/.exec(lines[index])
    if (!match) {
      preserved.push(lines[index])
      continue
    }
    if (insertAt < 0) insertAt = preserved.length
    // tags 下的缩进行属于旧值；连同空行后的续行一起移除，避免留下孤立 YAML 列表项。
    while (index + 1 < lines.length) {
      const next = lines[index + 1]
      if (/^[ \t]+\S/.test(next)) { index += 1; continue }
      if (!next.trim() && index + 2 < lines.length && /^[ \t]+\S/.test(lines[index + 2])) { index += 1; continue }
      break
    }
  }
  if (tags.length > 0) preserved.splice(insertAt < 0 ? preserved.length : insertAt, 0, tagLine)
  if (preserved.every((line) => !line.trim())) {
    return content.slice(frontmatter[0].length).replace(/^\r?\n(?:\r?\n)?/, "")
  }
  return `---${newline}${preserved.join(newline)}${newline}---${content.slice(frontmatter[0].length)}`
}
