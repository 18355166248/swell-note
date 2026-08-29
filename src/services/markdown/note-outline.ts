import { obsidianAnchorId } from "./markdown-preview-utils"

export type NoteOutlineItem = {
  anchor: string
  level: number
  line: number
  text: string
}

export function extractNoteOutline(content: string): NoteOutlineItem[] {
  const lines = content.split(/\r?\n/)
  const outline: NoteOutlineItem[] = []
  let fence: "`" | "~" | null = null
  let frontmatter = lines[0]?.trim() === "---"

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (frontmatter) {
      if (index > 0 && line.trim() === "---") frontmatter = false
      continue
    }
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~"
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence) continue

    const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (atx) {
      appendOutlineItem(outline, atx[2], atx[1].length, index + 1)
      continue
    }
    const setext = lines[index + 1]?.match(/^\s{0,3}(=+|-+)\s*$/)
    if (line.trim() && setext) {
      appendOutlineItem(outline, line, setext[1][0] === "=" ? 1 : 2, index + 1)
      index += 1
    }
  }
  return outline
}

function appendOutlineItem(outline: NoteOutlineItem[], rawText: string, level: number, line: number) {
  const text = rawText
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim()
  if (!text) return
  outline.push({ anchor: obsidianAnchorId(text), level, line, text })
}
