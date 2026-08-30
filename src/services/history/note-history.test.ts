import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"

import {
  deleteNoteVersions,
  listNoteVersions,
  remapNoteVersions,
  saveNoteVersion,
  summarizeLineChanges,
} from "./note-history"

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("swell-note-history")
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe("note history", () => {
  it("deduplicates rapid edit snapshots and keeps a later stage", async () => {
    await saveNoteVersion({ cacheId: "vault", content: "A", noteId: "note", reason: "编辑前", title: "标题" }, 1_000)
    await saveNoteVersion({ cacheId: "vault", content: "B", noteId: "note", reason: "编辑前", title: "标题" }, 2_000)
    await saveNoteVersion({ cacheId: "vault", content: "C", noteId: "note", reason: "编辑前", title: "标题" }, 302_000)

    expect((await listNoteVersions("vault", "note")).map((version) => version.content)).toEqual(["C", "A"])
  })

  it("remaps history after a note moves and supports clearing", async () => {
    await saveNoteVersion({ cacheId: "vault", content: "A", noteId: "old", reason: "恢复前", title: "标题" }, 1_000)
    await remapNoteVersions("vault", "old", "new")

    expect(await listNoteVersions("vault", "old")).toHaveLength(0)
    expect(await listNoteVersions("vault", "new")).toHaveLength(1)
    await deleteNoteVersions("vault", "new")
    expect(await listNoteVersions("vault", "new")).toHaveLength(0)
  })

  it("summarizes the changed middle lines", () => {
    expect(summarizeLineChanges("a\nb\nc", "a\nx\ny\nc")).toEqual({ added: 2, removed: 1 })
  })
})
