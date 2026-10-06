import { describe, expect, it } from "vitest"

import type { Note } from "@/types/note"
import { syncCompletionMessage, summarizeSyncQueue, summarizeWebDavSync } from "./sync-summary"

const baseNote: Note = {
  content: "",
  id: "note",
  preview: "",
  starred: false,
  title: "笔记",
  updatedAt: "刚刚",
}

it("结束文案按最新工作副本显示续写、失败附件和冲突", () => {
  expect(syncCompletionMessage([{ ...baseNote, source: "webdav", syncStatus: "modified" }], 1, 1)).toContain("3 项修改待同步")
  expect(syncCompletionMessage([{ ...baseNote, source: "webdav", syncStatus: "conflict" }], 0, 0)).toContain("冲突待处理")
  expect(syncCompletionMessage([], 0, 0)).toContain("云端与本机一致")
})

describe("summarizeWebDavSync", () => {
  it("仅置顶或取消置顶也计入待同步，多个条目合为一个配置项目", () => {
    const notes: Note[] = [
      { ...baseNote, source: "webdav", remotePath: "/a.md", pinned: true, pinPending: true, syncStatus: "synced" },
      { ...baseNote, id: "b", source: "webdav", remotePath: "/b.md", pinned: false, pinPending: true, syncStatus: "synced" },
    ]
    expect(summarizeSyncQueue(notes, 0, 0)).toEqual({ pending: 1, failed: 0, work: 1 })
  })
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
