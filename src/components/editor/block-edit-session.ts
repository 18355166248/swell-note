import type { EditorView } from "@codemirror/view"

export type BlockEditDraft = {
  draft: string
  open: boolean
  originalSource: string
  persistenceFailed?: boolean
  dirty?: boolean
}

const sessions = new WeakMap<EditorView, Map<string, BlockEditDraft>>()
const PREFIX = "swell-note:block-draft:v1:"

export function blockEditSessionKey(scope: string | undefined, kind: string, from: number) {
  return `${scope ?? "current-editor"}:${kind}:${from}`
}

export function readBlockEditDraft(view: EditorView, key: string): BlockEditDraft | undefined {
  const current = sessions.get(view)?.get(key)
  if (current) return current
  // 无明确笔记身份的独立编辑器不落盘，避免不同库或测试画布共用草稿。
  if (key.startsWith("current-editor:")) return undefined
  try {
    const saved = JSON.parse(localStorage.getItem(PREFIX + key) ?? "null")
    if (!saved || typeof saved.draft !== "string" || typeof saved.originalSource !== "string" || saved.open !== true) return undefined
    writeBlockEditDraft(view, key, saved)
    return saved as BlockEditDraft
  } catch { return undefined }
}

export function writeBlockEditDraft(view: EditorView, key: string, draft: BlockEditDraft) {
  let current = sessions.get(view)
  if (!current) {
    current = new Map()
    sessions.set(view, current)
  }
  current.set(key, draft)
  if (!key.startsWith("current-editor:")) {
    // 未确认的内容属于恢复草稿，不写入正文；存储失败仍保留本会话内存副本。
    try {
      if (draft.dirty === false || draft.draft === draft.originalSource) {
        localStorage.removeItem(PREFIX + key)
        draft.persistenceFailed = false
        return
      }
      localStorage.setItem(PREFIX + key, JSON.stringify({ draft: draft.draft, open: draft.open, originalSource: draft.originalSource }))
      draft.persistenceFailed = false
    } catch { draft.persistenceFailed = true }
  }
}

export function hasUnpersistedBlockDraft(view: EditorView) {
  return [...sessions.get(view)?.values() ?? []].some((draft) => draft.persistenceFailed && draft.draft !== draft.originalSource)
}

export function clearBlockEditDraft(view: EditorView, key: string) {
  const current = sessions.get(view)
  current?.delete(key)
  if (current?.size === 0) sessions.delete(view)
  try { localStorage.removeItem(PREFIX + key) } catch { /* 内存清理仍然有效。 */ }
}

export function clearPersistedBlockDrafts(scope: string) {
  const prefix = PREFIX + scope + ":"
  for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key)
}
