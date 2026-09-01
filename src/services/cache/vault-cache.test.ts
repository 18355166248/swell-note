import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"

import {
  cacheSyncedVaultAttachment,
  cacheVaultNoteDocuments,
  createVaultCacheId,
  deleteVaultCache,
  discardPendingVaultAttachments,
  listPendingVaultAttachments,
  loadVaultAttachment,
  loadCachedNoteDocument,
  listVaultCaches,
  loadLastVaultCache,
  loadVaultCache,
  queueVaultAttachment,
  remapVaultAttachmentNoteId,
  saveVaultCache,
  searchCachedNoteDocuments,
  updateVaultAttachmentStatus,
} from "./vault-cache"

// loadLastVaultCache 在指针悬空时同样返回 null，必须直读 settings 表才能验证指针是否被清理。
async function readLastCachePointer() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("swell-note-vault-cache", 3)
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

  it("Web Crypto 不可用时返回可操作的安全提示，而不是访问 digest 崩溃", async () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} })
    try {
      await expect(createVaultCacheId("webdav:test")).rejects.toThrow(/Web Crypto|HTTPS/)
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
    }
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

  it("按需恢复当前正文，其他正文保留为可离线读取状态", async () => {
    await saveVaultCache({
      activeNoteId: "active",
      id: "large-vault",
      label: "大笔记库",
      notes: ["active", "other"].map((id) => ({
        content: `# ${id} 正文`,
        contentLoaded: true,
        id,
        preview: `${id} 摘要`,
        remotePath: `/Swell/${id}.md`,
        source: "webdav" as const,
        starred: false,
        syncStatus: "synced" as const,
        title: id,
        updatedAt: "刚刚",
      })),
      savedAt: 1,
      sourceKind: "webdav",
    })

    const snapshot = await loadVaultCache("large-vault", { hydrate: "active" })
    expect(snapshot?.notes[0]).toMatchObject({ content: "# active 正文", contentCached: true, contentLoaded: true })
    expect(snapshot?.notes[1]).toMatchObject({ content: "", contentCached: true, contentLoaded: false })
    await expect(loadCachedNoteDocument("large-vault", "other")).resolves.toMatchObject({ content: "# other 正文" })
  })

  it("非当前的未同步工作副本也必须完整恢复", async () => {
    await saveVaultCache({
      activeNoteId: "active",
      id: "working-copy",
      label: "坚果云",
      notes: [{
        content: "离线修改不能丢",
        contentLoaded: true,
        id: "pending",
        preview: "离线修改",
        remotePath: "/Swell/pending.md",
        source: "webdav",
        starred: false,
        syncStatus: "modified",
        title: "pending",
        updatedAt: "待同步",
      }],
      savedAt: 1,
      sourceKind: "webdav",
    })

    await expect(loadVaultCache("working-copy", { hydrate: "active" })).resolves.toMatchObject({
      notes: [expect.objectContaining({ content: "离线修改不能丢", contentLoaded: true })],
    })
  })

  it("缓存正文支持 Web 端全文搜索且结果返回原始路径", async () => {
    await cacheVaultNoteDocuments("search-cache", [{
      content: "这里记录了跨设备冲突合并方案",
      id: "note",
      remotePath: "/Swell/同步方案.md",
      title: "同步方案",
    }])

    await expect(searchCachedNoteDocuments("search-cache", "冲突合并")).resolves.toEqual(["/Swell/同步方案.md"])
    await expect(searchCachedNoteDocuments("search-cache", "不存在")).resolves.toEqual([])
  })

  it("切换仅目录模式后删除之前保存的同步正文", async () => {
    const base = {
      activeNoteId: "note",
      id: "privacy-cache",
      label: "隐私缓存",
      savedAt: 1,
      sourceKind: "webdav" as const,
    }
    await saveVaultCache({
      ...base,
      notes: [{
        content: "敏感正文",
        contentLoaded: true,
        id: "note",
        preview: "敏感正文",
        remotePath: "/Swell/note.md",
        source: "webdav",
        starred: false,
        syncStatus: "synced",
        title: "note",
        updatedAt: "刚刚",
      }],
    })
    await saveVaultCache({
      ...base,
      notes: [{
        content: "",
        contentCached: false,
        contentLoaded: false,
        id: "note",
        preview: "正文未保存在本机",
        remotePath: "/Swell/note.md",
        source: "webdav",
        starred: false,
        syncStatus: "synced",
        title: "note",
        updatedAt: "刚刚",
      }],
    })

    await expect(loadCachedNoteDocument("privacy-cache", "note")).resolves.toBeNull()
  })

  it("笔记从快照移除后同步清理孤立正文", async () => {
    const makeNote = (id: string) => ({
      content: `正文 ${id}`,
      contentLoaded: true,
      id,
      preview: id,
      remotePath: `/Swell/${id}.md`,
      source: "webdav" as const,
      starred: false,
      syncStatus: "synced" as const,
      title: id,
      updatedAt: "刚刚",
    })
    const base = { activeNoteId: "keep", id: "cleanup", label: "清理测试", savedAt: 1, sourceKind: "webdav" as const }
    await saveVaultCache({ ...base, notes: [makeNote("keep"), makeNote("removed")] })
    await saveVaultCache({ ...base, notes: [makeNote("keep")] })

    await expect(loadCachedNoteDocument("cleanup", "keep")).resolves.not.toBeNull()
    await expect(loadCachedNoteDocument("cleanup", "removed")).resolves.toBeNull()
  })

  it("首次读取时把 v2 快照正文无损迁移到独立 Store", async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("swell-note-vault-cache", 2)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore("vaults", { keyPath: "id" })
        db.createObjectStore("settings", { keyPath: "key" })
        const attachments = db.createObjectStore("attachments", { keyPath: "key" })
        attachments.createIndex("cacheId", "cacheId")
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(["vaults", "settings"], "readwrite")
    transaction.objectStore("vaults").put({
      activeNoteId: "legacy-note",
      id: "legacy",
      label: "旧缓存",
      notes: [{
        content: "# v2 正文",
        contentLoaded: true,
        id: "legacy-note",
        preview: "v2 正文",
        remotePath: "/Swell/legacy.md",
        source: "webdav",
        starred: false,
        syncStatus: "synced",
        title: "legacy",
        updatedAt: "之前",
      }],
      savedAt: 1,
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: "legacy" })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    await expect(loadVaultCache("legacy", { hydrate: "active" })).resolves.toMatchObject({
      notes: [expect.objectContaining({ content: "# v2 正文", contentCached: true, contentLoaded: true })],
    })
    await expect(loadCachedNoteDocument("legacy", "legacy-note")).resolves.toMatchObject({ content: "# v2 正文" })
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

  it("缓存远程已同步附件供离线预览，并可覆盖旧内容", async () => {
    const path = "/Swell/attachments/remote.png"
    await cacheSyncedVaultAttachment({
      cacheId: "cache",
      data: new Uint8Array([1]).buffer,
      mimeType: "image/png",
      noteId: "note",
      path,
    })
    await cacheSyncedVaultAttachment({
      cacheId: "cache",
      data: new Uint8Array([2, 3]).buffer,
      mimeType: "image/png",
      noteId: "note",
      path,
    })

    const cached = await loadVaultAttachment("cache", path)
    expect(cached).toMatchObject({ status: "synced" })
    expect(Array.from(new Uint8Array(cached!.data))).toEqual([2, 3])
    await expect(listPendingVaultAttachments("cache")).resolves.toEqual([])
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
