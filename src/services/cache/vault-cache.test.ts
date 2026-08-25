import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"

import {
  createVaultCacheId,
  deleteVaultCache,
  discardPendingVaultAttachments,
  listPendingVaultAttachments,
  loadVaultAttachment,
  listVaultCaches,
  loadLastVaultCache,
  loadVaultCache,
  queueVaultAttachment,
  remapVaultAttachmentNoteId,
  saveVaultCache,
  updateVaultAttachmentStatus,
} from "./vault-cache"

// loadLastVaultCache 在指针悬空时同样返回 null，必须直读 settings 表才能验证指针是否被清理。
async function readLastCachePointer() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("swell-note-vault-cache", 2)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const value = await new Promise<{ key: string; value: string } | undefined>((resolve) => {
    const request = database.transaction("settings", "readonly").objectStore("settings").get("last-cache")
    request.onsuccess = () => resolve(request.result)
  })
  database.close()
  return value?.value
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("swell-note-vault-cache")
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe("vault cache", () => {
  it("使用不可逆哈希生成稳定缓存标识", async () => {
    const identity = "webdav:https://dav.example.com:user@example.com:/notes/"
    expect(await createVaultCacheId(identity)).toBe(await createVaultCacheId(identity))
    expect(await createVaultCacheId(identity)).not.toContain("user@example.com")
  })

  it("保存多个缓存并恢复最后使用项", async () => {
    await saveVaultCache({
      activeNoteId: "a",
      id: "one",
      label: "坚果云 · /A/",
      lastSyncedAt: 100,
      notes: [{
        content: "# 已缓存正文",
        contentLoaded: true,
        id: "a",
        preview: "已缓存正文",
        readOnly: true,
        starred: false,
        title: "缓存文档",
        updatedAt: "刚刚",
      }],
      savedAt: 1,
      sourceKind: "webdav",
    })
    await saveVaultCache({ activeNoteId: "b", id: "two", label: "坚果云 · /B/", notes: [], savedAt: 2, sourceKind: "webdav" })

    await expect(loadLastVaultCache()).resolves.toMatchObject({ id: "two" })
    await expect(loadVaultCache("one")).resolves.toMatchObject({
      id: "one",
      notes: [expect.objectContaining({ content: "# 已缓存正文", id: "a" })],
    })
    await expect(listVaultCaches()).resolves.toEqual([
      expect.objectContaining({ id: "two", noteCount: 0 }),
      expect.objectContaining({ id: "one", lastSyncedAt: 100, noteCount: 1 }),
    ])
  })

  it("删除指定缓存且不影响其他 Vault", async () => {
    await saveVaultCache({ activeNoteId: "a", id: "one", label: "A", notes: [], savedAt: 1, sourceKind: "webdav" })
    await saveVaultCache({ activeNoteId: "b", id: "two", label: "B", notes: [], savedAt: 2, sourceKind: "webdav" })
    await deleteVaultCache("one")

    await expect(loadVaultCache("one")).resolves.toBeNull()
    await expect(listVaultCaches()).resolves.toEqual([
      expect.objectContaining({ id: "two" }),
    ])
  })

  it("持久化离线新建笔记的待同步操作", async () => {
    await saveVaultCache({
      activeNoteId: "webdav:new.md",
      id: "offline-create",
      label: "坚果云 · /Swell/",
      notes: [{
        content: "# 离线新建",
        contentLoaded: true,
        id: "webdav:new.md",
        pendingOperation: "create",
        preview: "离线新建",
        readOnly: false,
        remotePath: "/Swell/new.md",
        source: "webdav",
        starred: false,
        syncError: "网络错误",
        syncStatus: "modified",
        title: "离线新建",
        updatedAt: "待同步",
      }],
      savedAt: 3,
      sourceKind: "webdav",
    })

    await expect(loadLastVaultCache()).resolves.toMatchObject({
      notes: [expect.objectContaining({
        pendingOperation: "create",
        syncError: "网络错误",
        syncStatus: "modified",
      })],
    })
  })

  it("持久化附件队列、同步状态并随 Vault 缓存删除", async () => {
    await saveVaultCache({ activeNoteId: "note", id: "cache", label: "坚果云", notes: [], savedAt: 1, sourceKind: "webdav" })
    const entry = await queueVaultAttachment({
      cacheId: "cache",
      data: new Uint8Array([1, 2, 3]).buffer,
      mimeType: "image/png",
      noteId: "note",
      path: "/Swell/attachments/a.png",
    })

    await expect(listPendingVaultAttachments("cache")).resolves.toHaveLength(1)
    await expect(loadVaultAttachment("cache", entry.path)).resolves.toMatchObject({ status: "pending" })
    await updateVaultAttachmentStatus(entry, "synced")
    await expect(listPendingVaultAttachments("cache")).resolves.toEqual([])
    await deleteVaultCache("cache")
    await expect(loadVaultAttachment("cache", entry.path)).resolves.toBeNull()
  })

  it("笔记移动时改绑附件，删除时清理未同步附件", async () => {
    await queueVaultAttachment({ cacheId: "cache", data: new ArrayBuffer(1), noteId: "old", path: "/a.png" })
    await remapVaultAttachmentNoteId("cache", "old", "next")
    await expect(listPendingVaultAttachments("cache")).resolves.toEqual([
      expect.objectContaining({ noteId: "next" }),
    ])
    await discardPendingVaultAttachments("cache", new Set(["next"]))
    await expect(listPendingVaultAttachments("cache")).resolves.toEqual([])
  })

  it("删除最后使用的缓存会一并清掉悬空指针", async () => {
    const base = {
      activeNoteId: "n1",
      notes: [{
        content: "正文",
        contentLoaded: true,
        id: "n1",
        preview: "摘要",
        starred: false,
        title: "笔记",
        updatedAt: "刚刚",
      }],
      savedAt: 1,
      sourceKind: "webdav" as const,
    }
    await saveVaultCache({ ...base, id: "keep", label: "保留库" })
    await saveVaultCache({ ...base, id: "drop", label: "待删库" })
    expect((await loadLastVaultCache())?.id).toBe("drop")

    expect(await readLastCachePointer()).toBe("drop")

    await deleteVaultCache("drop")

    // 指针必须一并删除，否则 settings 表会长期留着指向不存在记录的脏数据。
    expect(await readLastCachePointer()).toBeUndefined()
    expect(await loadLastVaultCache()).toBeNull()
    expect((await listVaultCaches()).map(({ id }) => id)).toEqual(["keep"])
    expect((await loadVaultCache("keep"))?.label).toBe("保留库")
  })

  it("删除非当前缓存时保留原有指针", async () => {
    const base = {
      activeNoteId: "n1",
      notes: [],
      savedAt: 1,
      sourceKind: "webdav" as const,
    }
    await saveVaultCache({ ...base, id: "other", label: "其他库" })
    await saveVaultCache({ ...base, id: "current", label: "当前库" })

    await deleteVaultCache("other")

    expect(await readLastCachePointer()).toBe("current")
    expect((await loadLastVaultCache())?.id).toBe("current")
  })
})
