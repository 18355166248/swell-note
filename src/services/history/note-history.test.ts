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

  it("迁移等待已发起的快照，目标的新快照在迁移后保留", async () => {
    const old = saveNoteVersion({ cacheId: "vault", content: "旧路径最后快照", noteId: "old", reason: "手动快照", title: "标题" }, 1000)
    const move = remapNoteVersions("vault", "old", "new")
    const next = saveNoteVersion({ cacheId: "vault", content: "新路径快照", noteId: "new", reason: "手动快照", title: "标题" }, 2000)
    await Promise.all([old, move, next])
    expect(await listNoteVersions("vault", "old")).toEqual([])
    expect((await listNoteVersions("vault", "new")).map((value) => value.content)).toEqual(["新路径快照", "旧路径最后快照"])
  })

  it("清理等待待写快照，双向迁移不互相锁死", async () => {
    const save = saveNoteVersion({ cacheId: "vault", content: "待清理", noteId: "old", reason: "手动快照", title: "标题" }, 1000)
    await Promise.all([save, deleteNoteVersions("vault", "old")])
    expect(await listNoteVersions("vault", "old")).toEqual([])
    await saveNoteVersion({ cacheId: "vault", content: "迁回", noteId: "old", reason: "手动快照", title: "标题" }, 1000)
    await Promise.all([remapNoteVersions("vault", "old", "new"), remapNoteVersions("vault", "new", "old")])
    expect((await listNoteVersions("vault", "old"))[0].content).toBe("迁回")
    expect(await listNoteVersions("vault", "new")).toEqual([])
  })
})
