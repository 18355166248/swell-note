import type { Note } from "@/types/note"

export function findMissingNoteSuggestions(missingNoteId: string, notes: Note[], limit = 3) {
  const target = parseNoteIdentity(missingNoteId)
  if (!target.title) return []

  return notes
    .map((note) => {
      const candidate = parseNoteIdentity(note.remotePath ?? note.id)
      const titleScore = titleSimilarity(target.title, normalizeTitle(note.title || candidate.title))
      // 文件夹只用于相似标题之间的排序，不能让同目录的无关笔记进入建议列表。
      const score = titleScore + (target.folder && target.folder === candidate.folder ? 0.12 : 0)
      return { note, score, titleScore }
    })
    .filter((candidate) => candidate.titleScore >= 0.12)
    .sort((left, right) => right.score - left.score || left.note.title.localeCompare(right.note.title))
    .slice(0, limit)
    .map((candidate) => candidate.note)
}

function parseNoteIdentity(value: string) {
  const decoded = safeDecode(value.replace(/^[a-z][a-z\d+.-]*:/i, ""))
  const segments = decoded.split("/").filter(Boolean)
  const fileName = segments.pop() ?? ""
  return {
    folder: segments.join("/"),
    title: normalizeTitle(fileName.replace(/\.(?:canvas|md)$/i, "")),
  }
}

function normalizeTitle(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[【\[].*?[】\]]/g, "")
    .replace(/[\s\p{P}\p{S}_]+/gu, "")
}

function titleSimilarity(left: string, right: string) {
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length)
  }

  const leftPairs = bigrams(left)
  const rightPairs = bigrams(right)
  if (leftPairs.size === 0 || rightPairs.size === 0) return 0
  let overlap = 0
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1
  return (2 * overlap) / (leftPairs.size + rightPairs.size)
}

function bigrams(value: string) {
  const result = new Set<string>()
  const characters = Array.from(value)
  for (let index = 0; index < characters.length - 1; index += 1) {
    result.add(`${characters[index]}${characters[index + 1]}`)
  }
  return result
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
