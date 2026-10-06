export type ReadingAnchor = { line: number; text: string; fraction: number }
export type NoteReadingPosition = { anchor: ReadingAnchor | null; scrollTop: number }
const STORAGE_KEY = "swell-note:reading-positions:v1"
const MAX_ENTRIES = 200

export function readingPositionKey(cacheId: string | null, noteId: string) {
  return JSON.stringify([cacheId ?? "session", noteId])
}

function validPosition(value: unknown): value is NoteReadingPosition {
  if (!value || typeof value !== "object") return false
  const position = value as NoteReadingPosition
  const anchor = position.anchor
  return Number.isFinite(position.scrollTop) && position.scrollTop >= 0 && (anchor === null || (
    !!anchor && Number.isInteger(anchor.line) && anchor.line >= 1 && typeof anchor.text === "string"
    && anchor.text.length <= 256 && Number.isFinite(anchor.fraction) && anchor.fraction >= 0 && anchor.fraction <= 1
  ))
}

export function resolveReadingAnchor(anchor: ReadingAnchor, content: string): ReadingAnchor {
  const lines = content.split("\n")
  const index = Math.min(anchor.line - 1, lines.length - 1)
  if (lines[index].slice(0, 256) === anchor.text) return { ...anchor, line: index + 1 }
  // 前文增删后优先找回原段落；重复段落选择离原行号最近的，整段被删则退到有效行首。
  let nearest = -1
  if (anchor.text.trim()) lines.forEach((text, candidate) => {
    if (text.slice(0, 256) === anchor.text && (nearest < 0 || Math.abs(candidate - index) < Math.abs(nearest - index))) nearest = candidate
  })
  return nearest < 0
    ? { line: index + 1, text: lines[index].slice(0, 256), fraction: 0 }
    : { ...anchor, line: nearest + 1 }
}

export function createNoteReadingPositions(storage: () => Pick<Storage, "getItem" | "setItem">, limit = MAX_ENTRIES) {
  const positions = new Map<string, NoteReadingPosition>()
  let loaded = false
  const trim = () => {
    while (positions.size > limit) positions.delete(positions.keys().next().value!)
  }
  const load = () => {
    if (loaded) return
    loaded = true
    try {
      const entries: unknown = JSON.parse(storage().getItem(STORAGE_KEY) ?? "[]")
      if (Array.isArray(entries)) for (const entry of entries) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && validPosition(entry[1])) positions.set(entry[0], entry[1])
      }
      trim()
    } catch { /* 阅读偏好不可用时仍保留本次会话，不影响正文保存。 */ }
  }
  return {
    get(key: string) {
      load()
      const position = positions.get(key) ?? null
      if (position) { positions.delete(key); positions.set(key, position) }
      return position
    },
    set(key: string, position: NoteReadingPosition) {
      load()
      if (!validPosition(position)) return
      positions.delete(key)
      positions.set(key, position)
      trim()
    },
    move(from: string, to: string) {
      load()
      const position = positions.get(from)
      if (!position || from === to) return
      positions.delete(from)
      positions.delete(to)
      positions.set(to, position)
    },
    flush() {
      load()
      try { storage().setItem(STORAGE_KEY, JSON.stringify([...positions])) }
      catch { /* 隐私模式或存储满时只失去跨重启恢复，内存记录仍可继续用。 */ }
    },
  }
}

export const noteReadingPositions = createNoteReadingPositions(() => window.localStorage)
