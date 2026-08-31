import { describe, expect, it } from "vitest"

import type { Note } from "@/types/note"
import { summarizeSyncQueue, summarizeWebDavSync } from "./sync-summary"

const baseNote: Note = {
  content: "",
  id: "note",
  preview: "",
  starred: false,
  title: "笔记",
  updatedAt: "刚刚",
}

describe("summarizeWebDavSync", () => {
  it("区分待同步、失败、冲突和已同步笔记", () => {
    const notes: Note[] = [
      { ...baseNote, id: "pending", source: "webdav", syncStatus: "modified" },
      { ...baseNote, id: "failed", source: "webdav", syncError: "网络错误", syncStatus: "modified" },
      { ...baseNote, id: "conflict", source: "webdav", syncStatus: "conflict" },
      { ...baseNote, id: "synced", source: "webdav", syncStatus: "synced" },
      { ...baseNote, id: "local", source: "local" },
    ]

    expect(summarizeWebDavSync(notes)).toEqual({ conflicts: 1, failed: 1, pending: 1, synced: 1 })
  })

  it("附件失败项不会同时重复计入待同步和总工作量", () => {
    const notes = [
      { ...baseNote, id: "pending", source: "webdav" as const, syncStatus: "modified" as const },
      { ...baseNote, id: "failed", source: "webdav" as const, syncError: "网络错误", syncStatus: "modified" as const },
    ]

    expect(summarizeSyncQueue(notes, 3, 1)).toEqual({
      failed: 2,
      pending: 3,
      work: 5,
    })
  })
})
