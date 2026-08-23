import { describe, expect, it } from "vitest"

import type { Note } from "@/types/note"
import { summarizeWebDavSync } from "./sync-summary"

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
})
