import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"

import {
  cacheSyncedVaultAttachment,
  cacheVaultNoteDocuments,
  commitVaultDirectoryRename,
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
  remapVaultAttachmentsForDirectory,
  remapCachedVaultDocumentsForDirectory,
  remapVaultAttachmentNoteId,
  saveVaultCache,
  saveVaultDirectoryQueueCheckpoint,
  saveVaultNoteQueueCheckpoint,
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

  it("后台来源库检查点不会改写当前库指针", async () => {
    await saveVaultCache({ activeNoteId: "", id: "source", label: "来源库", notes: [], savedAt: 1, sourceKind: "webdav" })
    await saveVaultCache({ activeNoteId: "", id: "current", label: "当前库", notes: [], savedAt: 2, sourceKind: "webdav" })
    await saveVaultCache({
      activeNoteId: "",
      id: "source",
      label: "来源库",
      notes: [],
      pendingDirectoryMoves: [{ id: "moved", moved: true, sourceFolder: "A", targetFolder: "B" }],
      savedAt: 3,
      sourceKind: "webdav",
    }, { updateLastCache: false })

    expect(await readLastCachePointer()).toBe("current")
    await expect(loadVaultCache("source")).resolves.toMatchObject({
      pendingDirectoryMoves: [expect.objectContaining({ id: "moved", moved: true })],
    })
  })

  it("陈旧目录检查点只合并结构字段，不覆盖等待期间保存的新正文", async () => {
    const old = {
      content: "OLD",
      contentLoaded: true,
      folder: "Other",
      id: "webdav:/Swell/Other/n.md",
      preview: "OLD",
      remotePath: "/Swell/Other/n.md",
      source: "webdav" as const,
      starred: false,
      syncStatus: "modified" as const,
      title: "n",
      updatedAt: "待同步",
    }
    const stale = {
      activeNoteId: old.id,
      id: "checkpoint-merge",
      label: "检查点合并",
      notes: [old],
      pendingDirectoryMoves: [{ id: "move", sourceFolder: "A", targetFolder: "B" }],
      savedAt: 1,
      sourceKind: "webdav" as const,
    }
    await saveVaultCache(stale)
    await saveVaultCache({ ...stale, notes: [{ ...old, content: "NEW DURING MOVE", preview: "NEW" }], savedAt: 2 })
    const merged = await saveVaultDirectoryQueueCheckpoint({
      ...stale,
      pendingDirectoryMoves: [{ id: "move", moved: true, sourceFolder: "A", targetFolder: "B" }],
      savedAt: 3,
    })

    expect(merged.notes[0].content).toBe("NEW DURING MOVE")
    await expect(loadVaultCache(stale.id, { hydrate: "all" })).resolves.toMatchObject({
      notes: [expect.objectContaining({ content: "NEW DURING MOVE" })],
      pendingDirectoryMoves: [expect.objectContaining({ moved: true })],
    })
  })

  it("文件 MOVE 检查点保留后来正文，并把远端阶段推进为可恢复的普通修改", async () => {
    const moved = {
      content: "SYNC START",
      contentLoaded: true,
      folder: "Y",
      id: "webdav:/Swell/Y/n.md",
      pendingOperation: "move" as const,
      preview: "SYNC START",
      previousRemotePath: "/Swell/X/n.md",
      remotePath: "/Swell/Y/n.md",
      revision: '"old"',
      source: "webdav" as const,
      starred: false,
      syncStatus: "modified" as const,
      title: "n",
      updatedAt: "待同步",
    }
    const base = { activeNoteId: moved.id, id: "note-checkpoint", label: "文件检查点", notes: [moved], savedAt: 1, sourceKind: "webdav" as const }
    await saveVaultCache(base)
    await saveVaultCache({ ...base, notes: [{ ...moved, content: "LATEST UI" }], savedAt: 2 })
    const checkpoint = await saveVaultNoteQueueCheckpoint(base.id, {
      note: { ...moved, pendingOperation: undefined, previousRemotePath: undefined, revision: '"moved"' },
      type: "moved",
    })
    expect(checkpoint.notes[0]).toMatchObject({
      content: "LATEST UI",
      pendingOperation: undefined,
      previousRemotePath: undefined,
      revision: '"moved"',
      syncStatus: "modified",
    })

    const synced = await saveVaultNoteQueueCheckpoint(base.id, {
      note: { ...moved, content: "SYNC START", pendingOperation: undefined, previousRemotePath: undefined, revision: '"written"', syncStatus: "synced" },
      type: "synced",
    })
    expect(synced.notes[0]).toMatchObject({
      baseContent: "SYNC START",
      content: "LATEST UI",
      revision: '"written"',
      syncStatus: "modified",
    })
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

  it("目录重命名同时迁移附件路径与笔记标识", async () => {
    await queueVaultAttachment({ cacheId: "cache", data: new ArrayBuffer(1), noteId: "old", path: "/Swell/旧/attachments/a.png" })
    await remapVaultAttachmentsForDirectory({
      cacheId: "cache",
      noteIds: new Map([["old", "next"]]),
      sourceDirectory: "/Swell/旧",
      targetDirectory: "/Swell/新",
    })
    await expect(loadVaultAttachment("cache", "/Swell/旧/attachments/a.png")).resolves.toBeNull()
    await expect(loadVaultAttachment("cache", "/Swell/新/attachments/a.png")).resolves.toMatchObject({ noteId: "next", status: "pending" })
  })

  it("目录重命名保留尚未载入 React 的缓存正文", async () => {
    await cacheVaultNoteDocuments("cache", [{ content: "离线正文", id: "old", remotePath: "/Swell/旧/a.md", title: "a" }])
    await remapCachedVaultDocumentsForDirectory({
      cacheId: "cache",
      noteIds: new Map([["old", "next"]]),
      sourceDirectory: "/Swell/旧",
      targetDirectory: "/Swell/新",
    })
    await expect(loadCachedNoteDocument("cache", "old")).resolves.toBeNull()
    await expect(loadCachedNoteDocument("cache", "next")).resolves.toMatchObject({ content: "离线正文", path: "/Swell/新/a.md" })
  })

  it("目录重命名在一个事务内提交快照、正文、附件和结构队列", async () => {
    const oldId = "webdav:/Swell/旧/a.md"
    const nextId = "webdav:/Swell/新/a.md"
    await saveVaultCache({
      activeNoteId: oldId,
      directories: ["旧"],
      id: "atomic-rename",
      label: "原子重命名",
      notes: [{
        content: "未同步正文",
        contentLoaded: true,
        folder: "旧",
        id: oldId,
        preview: "未同步正文",
        remotePath: "/Swell/旧/a.md",
        source: "webdav",
        starred: false,
        syncStatus: "modified",
        title: "a",
        updatedAt: "待同步",
      }],
      pendingDirectoryMoves: [],
      savedAt: 1,
      sourceKind: "webdav",
    })
    await queueVaultAttachment({
      cacheId: "atomic-rename",
      data: new Uint8Array([7]).buffer,
      noteId: oldId,
      path: "/Swell/旧/attachments/a.png",
    })

    await commitVaultDirectoryRename({
      noteIds: new Map([[oldId, nextId]]),
      snapshot: {
        activeNoteId: nextId,
        directories: ["新"],
        id: "atomic-rename",
        label: "原子重命名",
        notes: [{
          content: "未同步正文",
          contentLoaded: true,
          folder: "新",
          id: nextId,
          preview: "未同步正文",
          remotePath: "/Swell/新/a.md",
          source: "webdav",
          starred: false,
          syncStatus: "modified",
          title: "a",
          updatedAt: "待同步",
        }],
        pendingDirectoryMoves: [{ id: "move-1", sourceFolder: "旧", targetFolder: "新" }],
        savedAt: 2,
        sourceKind: "webdav",
      },
      sourceDirectory: "/Swell/旧",
      targetDirectory: "/Swell/新",
    })

    await expect(loadVaultCache("atomic-rename", { hydrate: "all" })).resolves.toMatchObject({
      activeNoteId: nextId,
      directories: ["新"],
      notes: [expect.objectContaining({ content: "未同步正文", id: nextId, remotePath: "/Swell/新/a.md" })],
      pendingDirectoryMoves: [expect.objectContaining({ id: "move-1" })],
    })
    await expect(loadCachedNoteDocument("atomic-rename", oldId)).resolves.toBeNull()
    await expect(loadCachedNoteDocument("atomic-rename", nextId)).resolves.toMatchObject({
      content: "未同步正文",
      path: "/Swell/新/a.md",
    })
    await expect(loadVaultAttachment("atomic-rename", "/Swell/旧/attachments/a.png")).resolves.toBeNull()
    await expect(loadVaultAttachment("atomic-rename", "/Swell/新/attachments/a.png")).resolves.toMatchObject({ noteId: nextId })
  })

  it("原子目录改名完整保留 modified、conflict、create 与未加载缓存正文", async () => {
    const variants = [
      { name: "modified", syncStatus: "modified" as const },
      { name: "conflict", syncStatus: "conflict" as const },
      { name: "create", pendingOperation: "create" as const, syncStatus: "modified" as const },
      { name: "unloaded", syncStatus: "synced" as const },
    ]
    const oldNotes = variants.map((variant) => ({
      content: `仅本机正文-${variant.name}`,
      contentLoaded: true,
      folder: "旧",
      id: `webdav:/Swell/旧/${variant.name}.md`,
      pendingOperation: variant.pendingOperation,
      preview: variant.name,
      remotePath: `/Swell/旧/${variant.name}.md`,
      source: "webdav" as const,
      starred: false,
      syncStatus: variant.syncStatus,
      title: variant.name,
      updatedAt: "待同步",
    }))
    await saveVaultCache({
      activeNoteId: oldNotes[0].id,
      id: "atomic-variants",
      label: "正文边界",
      notes: oldNotes,
      savedAt: 1,
      sourceKind: "webdav",
    })
    const noteIds = new Map(oldNotes.map((note) => [note.id, note.id.replace("/旧/", "/新/")]))
    const nextNotes = oldNotes.map((note) => {
      const unloaded = note.title === "unloaded"
      return {
        ...note,
        content: unloaded ? "" : note.content,
        contentCached: unloaded ? true : undefined,
        contentLoaded: unloaded ? false : note.contentLoaded,
        folder: "新",
        id: noteIds.get(note.id)!,
        remotePath: note.remotePath.replace("/旧/", "/新/"),
      }
    })
    await commitVaultDirectoryRename({
      noteIds,
      snapshot: {
        activeNoteId: nextNotes[0].id,
        id: "atomic-variants",
        label: "正文边界",
        notes: nextNotes,
        pendingDirectoryMoves: [{ id: "variants", sourceFolder: "旧", targetFolder: "新" }],
        savedAt: 2,
        sourceKind: "webdav",
      },
      sourceDirectory: "/Swell/旧",
      targetDirectory: "/Swell/新",
    })

    const reopened = await loadVaultCache("atomic-variants", { hydrate: "all" })
    expect(reopened?.notes.map((note) => ({ content: note.content, id: note.id }))).toEqual(variants.map((variant) => ({
      content: `仅本机正文-${variant.name}`,
      id: `webdav:/Swell/新/${variant.name}.md`,
    })))
    for (const note of oldNotes) await expect(loadCachedNoteDocument("atomic-variants", note.id)).resolves.toBeNull()
  })

  it("目录改名提交发现正文版本已变化时拒绝旧输入并保留最新工作副本", async () => {
    const oldId = "webdav:/Swell/A/n.md"
    const nextId = "webdav:/Swell/B/n.md"
    const original = {
      content: "OLD",
      contentLoaded: true,
      folder: "A",
      id: oldId,
      preview: "OLD",
      remotePath: "/Swell/A/n.md",
      source: "webdav" as const,
      starred: false,
      syncStatus: "modified" as const,
      title: "n",
      updatedAt: "待同步",
    }
    const base = { activeNoteId: oldId, directories: ["A"], id: "rename-version", label: "版本校验", notes: [original], savedAt: 1, sourceKind: "webdav" as const }
    await saveVaultCache(base)
    await saveVaultCache({ ...base, notes: [{ ...original, content: "NEW WHILE WAITING" }], savedAt: 2 })

    await expect(commitVaultDirectoryRename({
      expectedDocuments: new Map([[oldId, "OLD"]]),
      noteIds: new Map([[oldId, nextId]]),
      snapshot: {
        ...base,
        activeNoteId: nextId,
        directories: ["B"],
        notes: [{ ...original, id: nextId, folder: "B", remotePath: "/Swell/B/n.md" }],
      },
      sourceDirectory: "/Swell/A",
      targetDirectory: "/Swell/B",
    })).rejects.toThrow("正文已在重命名期间变化")
    await expect(loadVaultCache(base.id, { hydrate: "all" })).resolves.toMatchObject({
      directories: ["A"],
      notes: [expect.objectContaining({ content: "NEW WHILE WAITING", id: oldId })],
    })
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
