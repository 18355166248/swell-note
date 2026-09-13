import type { EditorView } from "@codemirror/view"

export type BlockEditDraft = {
  draft: string
  open: boolean
  originalSource: string
}

const sessions = new WeakMap<EditorView, Map<string, BlockEditDraft>>()

export function blockEditSessionKey(scope: string | undefined, kind: string, from: number) {
  return `${scope ?? "current-editor"}:${kind}:${from}`
}

export function readBlockEditDraft(view: EditorView, key: string): BlockEditDraft | undefined {
  return sessions.get(view)?.get(key)
}

export function writeBlockEditDraft(view: EditorView, key: string, draft: BlockEditDraft) {
  let current = sessions.get(view)
  if (!current) {
    current = new Map()
    sessions.set(view, current)
  }
  current.set(key, draft)
}

export function clearBlockEditDraft(view: EditorView, key: string) {
  const current = sessions.get(view)
  current?.delete(key)
  if (current?.size === 0) sessions.delete(view)
}
