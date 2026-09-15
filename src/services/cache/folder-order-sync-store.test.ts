import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"

import { deleteVaultCache, saveVaultCache } from "./vault-cache"
import {
  deleteFolderOrderSyncRecord,
  getFolderOrderSyncStatus,
  getOrCreateFolderOrderSyncRecord,
  loadFolderOrderSyncRecord,
  recordFolderOrderLocalEdit,
  recordFolderOrderPathMigration,
  recordFolderOrderVisibleEdit,
  subscribeFolderOrderSyncRecord,
  updateFolderOrderSyncRecord,
  type FolderOrderSyncRecord,
} from "./folder-order-sync-store"

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("swell-note-vault-cache")
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe("folder-order-sync-store", () => {
  it("首次访问建立空工作副本，未观察远端且不计迁移", async () => {
    const record = await getOrCreateFolderOrderSyncRecord("cache-a", null)

    expect(record.base).toBeNull()
    expect(record.pendingIntent).toBeNull()
    expect(record.migrationDone).toBe(true)
    expect(getFolderOrderSyncStatus(record)).toBe("clean")
  })

  it("v1 历史排序一次性迁移为待上传候选并保留备份", async () => {
    const record = await getOrCreateFolderOrderSyncRecord("cache-a", ["Beta", "Alpha"])

    expect(record.localOrder).toEqual(["Beta", "Alpha"])
    expect(record.pendingIntent).toEqual({ generation: 1, order: ["Beta", "Alpha"], origin: "migration" })
    expect(record.migratedFromV1Backup).toEqual(["Beta", "Alpha"])
    expect(getFolderOrderSyncStatus(record)).toBe("pending")

    // 已有记录时 v1 不再作为输入，不会每次启动重新标成待上传。
    const again = await getOrCreateFolderOrderSyncRecord("cache-a", ["别的", "顺序"])
    expect(again.localOrder).toEqual(["Beta", "Alpha"])
  })

  it("单事务 read-modify-write 串行叠加代次", async () => {
    await getOrCreateFolderOrderSyncRecord("cache-a", null)
    const [first, second] = await Promise.all([
      updateFolderOrderSyncRecord("cache-a", (record) => { record.localGeneration += 1 }),
      updateFolderOrderSyncRecord("cache-a", (record) => { record.localGeneration += 1 }),
    ])

    expect(first.changed && second.changed).toBe(true)
    expect((await loadFolderOrderSyncRecord("cache-a"))!.localGeneration).toBe(2)
  })

  it("mutate 返回 false 时放弃写入并返回最新记录", async () => {
    await getOrCreateFolderOrderSyncRecord("cache-a", ["A"])
    const result = await updateFolderOrderSyncRecord("cache-a", () => false)

    expect(result.changed).toBe(false)
    expect(result.record?.localOrder).toEqual(["A"])
    expect((await loadFolderOrderSyncRecord("cache-a"))!.pendingIntent?.origin).toBe("migration")
  })

  it("订阅者按库收到写入广播，删除时收到 null", async () => {
    const seen: Array<FolderOrderSyncRecord | null> = []
    const unsubscribe = subscribeFolderOrderSyncRecord("cache-a", (record) => seen.push(record))
    subscribeFolderOrderSyncRecord("cache-b", (record) => seen.push(record))

    await getOrCreateFolderOrderSyncRecord("cache-a", null)
    await updateFolderOrderSyncRecord("cache-a", (record) => { record.localOrder = ["B"] })
    await deleteFolderOrderSyncRecord("cache-a")
    unsubscribe()

    expect(seen.map((record) => record?.localOrder ?? null)).toEqual([[], ["B"], null])
  })

  it("状态派生：conflict 优先于 error，error 优先于 pending", async () => {
    await getOrCreateFolderOrderSyncRecord("cache-a", null)
    const { record } = await updateFolderOrderSyncRecord("cache-a", (draft) => {
      draft.error = { kind: "read", message: "x" }
      draft.pendingIntent = { generation: 1, order: ["A"], origin: "edit" }
    })
    expect(getFolderOrderSyncStatus(record!)).toBe("error")

    const { record: conflicted } = await updateFolderOrderSyncRecord("cache-a", (draft) => {
      draft.conflict = {
        localGeneration: 1,
        localOrder: ["A"],
        remoteChangeId: null,
        remoteEtag: null,
        remoteExists: true,
        remoteOrder: ["B"],
      }
    })
    expect(getFolderOrderSyncStatus(conflicted!)).toBe("conflict")
  })

  it("删除笔记缓存时同步元数据一并清理", async () => {
    await saveVaultCache({
      activeNoteId: "",
      id: "cache-a",
      label: "坚果云 · /A/",
      notes: [],
      savedAt: 1,
      sourceKind: "webdav",
    })
    await getOrCreateFolderOrderSyncRecord("cache-a", ["A"])

    await deleteVaultCache("cache-a")

    expect(await loadFolderOrderSyncRecord("cache-a")).toBeNull()
  })

  it("重命名迁移命中：保持位置、推进代次并标为待上传，冲突候选随之刷新", async () => {
    await getOrCreateFolderOrderSyncRecord("cache-a", null)
    await updateFolderOrderSyncRecord("cache-a", (draft) => {
      draft.localOrder = ["Alpha", "Beta", "Gamma"]
      draft.localGeneration = 5
      draft.base = { changeId: "c", etag: '"e"', exists: true, order: ["Alpha", "Beta", "Gamma"] }
      draft.conflict = {
        localGeneration: 5,
        localOrder: ["Alpha", "Beta", "Gamma"],
        remoteChangeId: "c2",
        remoteEtag: '"e2"',
        remoteExists: true,
        remoteOrder: ["远端"],
      }
      draft.error = { kind: "read", message: "旧错误" }
    })

    const record = await recordFolderOrderPathMigration("cache-a", "Beta", "Delta")

    expect(record?.localOrder).toEqual(["Alpha", "Delta", "Gamma"])
    expect(record?.localGeneration).toBe(6)
    expect(record?.pendingIntent).toEqual({ generation: 6, order: ["Alpha", "Delta", "Gamma"], origin: "edit" })
    // 旧错误清除；冲突中的本机候选同步刷新为新顺序，避免“使用本机”写回旧路径。
    expect(record?.error).toBeNull()
    expect(record?.conflict).toMatchObject({ localGeneration: 6, localOrder: ["Alpha", "Delta", "Gamma"] })
  })

  it("重命名迁移未命中：不写盘、不推进代次，意图与冲突保持原样", async () => {
    await getOrCreateFolderOrderSyncRecord("cache-a", null)
    await updateFolderOrderSyncRecord("cache-a", (draft) => {
      draft.localOrder = ["Alpha", "Beta"]
      draft.localGeneration = 3
      draft.base = { changeId: "c", etag: '"e"', exists: true, order: ["Alpha", "Beta"] }
      draft.error = { kind: "read", message: "x" }
    })

    const record = await recordFolderOrderPathMigration("cache-a", "Missing", "Nope")

    expect(record?.localGeneration).toBe(3)
    expect(record?.localOrder).toEqual(["Alpha", "Beta"])
    expect(record?.pendingIntent).toBeNull()
    // 未写入：error 等其余字段原样保留。
    expect(record?.error).toMatchObject({ kind: "read" })
  })

  it("迁移与后续排序编辑叠加：代次串行推进、互不覆盖", async () => {
    await getOrCreateFolderOrderSyncRecord("cache-a", null)
    await updateFolderOrderSyncRecord("cache-a", (draft) => {
      draft.localOrder = ["Alpha", "Beta", "Gamma"]
      draft.localGeneration = 1
      draft.base = { changeId: "c", etag: '"e"', exists: true, order: ["Alpha", "Beta", "Gamma"] }
    })

    // 迁移完成后再拖动排序：两次写入都落在最新代次之上。
    const migrated = await recordFolderOrderPathMigration("cache-a", "Beta", "Delta")
    const edited = await recordFolderOrderLocalEdit("cache-a", ["Delta", "Gamma", "Alpha"])

    expect(migrated?.localGeneration).toBe(2)
    expect(edited?.localGeneration).toBe(3)
    expect(edited?.localOrder).toEqual(["Delta", "Gamma", "Alpha"])
    expect(edited?.pendingIntent).toEqual({ generation: 3, order: ["Delta", "Gamma", "Alpha"], origin: "edit" })
  })

  it("可见子集提交以副本最新顺序为基合并：不可见成员槽位保留、代次推进、冲突候选刷新", async () => {
    await getOrCreateFolderOrderSyncRecord("cache-a", null)
    await updateFolderOrderSyncRecord("cache-a", (draft) => {
      // X 是其他设备记录、本机界面尚未显示的成员。
      draft.localOrder = ["A", "X", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "c", etag: '"e"', exists: true, order: ["A", "X", "B"] }
      draft.conflict = {
        localGeneration: 4,
        localOrder: ["A", "X", "B"],
        remoteChangeId: "c2",
        remoteEtag: '"e2"',
        remoteExists: true,
        remoteOrder: ["远端"],
      }
    })

    // 界面只见 [A, B]，提交 [B, A]：X 保留在原槽位。
    const record = await recordFolderOrderVisibleEdit("cache-a", ["B", "A"])

    expect(record?.localOrder).toEqual(["B", "X", "A"])
    expect(record?.localGeneration).toBe(5)
    expect(record?.pendingIntent).toEqual({ generation: 5, order: ["B", "X", "A"], origin: "edit" })
    expect(record?.conflict).toMatchObject({ localGeneration: 5, localOrder: ["B", "X", "A"] })
  })

  it("可见子集合并结果与副本一致：不写盘、不推进代次", async () => {
    await getOrCreateFolderOrderSyncRecord("cache-a", null)
    await updateFolderOrderSyncRecord("cache-a", (draft) => {
      draft.localOrder = ["A", "X", "B"]
      draft.localGeneration = 3
      draft.base = { changeId: "c", etag: '"e"', exists: true, order: ["A", "X", "B"] }
    })

    const record = await recordFolderOrderVisibleEdit("cache-a", ["A", "B"])

    expect(record?.localGeneration).toBe(3)
    expect(record?.pendingIntent).toBeNull()
  })
})
