// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest"
import type { EditorView } from "@codemirror/view"
import { blockEditSessionKey, clearBlockEditDraft, clearPersistedBlockDrafts, readBlockEditDraft, writeBlockEditDraft } from "./block-edit-session"
afterEach(() => localStorage.clear())
const view = () => ({} as EditorView)

it("重建编辑器恢复草稿，跨库同名笔记不混用；取消后不再恢复", () => {
  const key = blockEditSessionKey("vault-a:note.md", "math", 10)
  const draft = { draft: "$$\ny\n$$", originalSource: "$$\nx\n$$", open: true }
  writeBlockEditDraft(view(), key, draft)
  const fresh = view()
  expect(readBlockEditDraft(fresh, key)).toEqual(draft)
  expect(readBlockEditDraft(fresh, blockEditSessionKey("vault-b:note.md", "math", 10))).toBeUndefined()
  clearBlockEditDraft(fresh, key)
  expect(readBlockEditDraft(view(), key)).toBeUndefined()
})

it("清除库缓存会删除该库的恢复草稿，保留其他库", () => {
  const draft = { draft: "new", originalSource: "old", open: true }
  const a = blockEditSessionKey("a:note", "math", 0), b = blockEditSessionKey("ab:note", "math", 0)
  writeBlockEditDraft(view(), a, draft); writeBlockEditDraft(view(), b, draft)
  clearPersistedBlockDrafts("a")
  expect(readBlockEditDraft(view(), a)).toBeUndefined()
  expect(readBlockEditDraft(view(), b)).toEqual(draft)
})
