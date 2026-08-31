import { describe, expect, it } from "vitest"

import type { Note } from "@/types/note"
import { buildAutoSyncQueueKey } from "./auto-sync-queue"

function pendingNote(patch: Partial<Note> = {}): Note {
  return {
    content: "正文",
    id: "webdav:/note.md",
    preview: "正文",
    source: "webdav",
    starred: false,
    syncStatus: "modified",
    title: "标题",
    updatedAt: "刚刚",
    ...patch,
  }
}

describe("auto sync queue key", () => {
  it("keeps the same key when only the previous failure message changes", () => {
    const first = buildAutoSyncQueueKey("cache", [pendingNote()], [], 0)
    const failed = buildAutoSyncQueueKey("cache", [pendingNote({ syncError: "网络错误" })], [], 0)
    expect(failed).toBe(first)
  })

  it("creates a new key after the user changes the pending document", () => {
    const first = buildAutoSyncQueueKey("cache", [pendingNote()], [], 0)
    const edited = buildAutoSyncQueueKey("cache", [pendingNote({ content: "新的正文" })], [], 0)
    expect(edited).not.toBe(first)
  })

  it("tracks directory and attachment queue changes", () => {
    const first = buildAutoSyncQueueKey("cache", [], ["A"], 0)
    expect(buildAutoSyncQueueKey("cache", [], ["B"], 0)).not.toBe(first)
    expect(buildAutoSyncQueueKey("cache", [], ["A"], 1)).not.toBe(first)
  })
})
