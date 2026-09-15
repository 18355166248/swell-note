// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"

import {
  getOrCreateFolderOrderSyncRecord,
  loadFolderOrderSyncRecord,
  recordFolderOrderLocalEdit,
  updateFolderOrderSyncRecord,
} from "@/services/cache/folder-order-sync-store"
import { serializeFolderOrderDocument } from "@/services/preferences/folder-order-document"
import { saveFolderOrder } from "@/services/preferences/folder-order-preferences"
import type { VaultAdapter, VaultFolderOrderStore } from "@/services/vault/vault-adapter"
import { WebDavContentTooLargeError, WebDavNetworkError, WebDavRevisionConflictError } from "@/services/webdav-client"

import { decideFolderOrder, resolveFolderOrderConflict, syncFolderOrder } from "./folder-order-sync"

const DOCUMENT_PATH = "/Swell/.swell/folder-order.json"

// 共享的内存版远端：有 ETag 行为，两台“设备”（不同 cacheId）指向同一个实例。
function createMockRemote() {
  let document: { body: string; etag: string } | null = null
  let etagCounter = 0
  const calls: string[] = []
  const hooks: { beforeUpdate?: () => void; failNextUpdateWith?: () => Error } = {}

  const store: VaultFolderOrderStore = {
    async ensureMetadataDirectory() {
      calls.push("mkcol")
    },
    async readDocument() {
      calls.push("get")
      if (!document) return null
      return { bytes: new TextEncoder().encode(document.body), etag: document.etag, etagWeak: false }
    },
    async createDocument(body) {
      calls.push("create")
      if (document) throw new WebDavRevisionConflictError(DOCUMENT_PATH)
      etagCounter += 1
      document = { body, etag: `"e${etagCounter}"` }
      return { etag: document.etag, etagWeak: false }
    },
    async updateDocument(body, expectedEtag) {
      calls.push("update")
      hooks.beforeUpdate?.()
      if (hooks.failNextUpdateWith) {
        const error = hooks.failNextUpdateWith()
        hooks.failNextUpdateWith = undefined
        throw error
      }
      if (!document || document.etag !== expectedEtag) throw new WebDavRevisionConflictError(DOCUMENT_PATH)
      etagCounter += 1
      document = { body, etag: `"e${etagCounter}"` }
      return { etag: document.etag, etagWeak: false }
    },
    async verifyRoot() {
      calls.push("root")
      return true
    },
  }

  return {
    calls,
    hooks,
    store,
    readOrder(): string[] {
      return document ? (JSON.parse(document.body) as { order: string[] }).order : []
    },
    readChangeId(): string | null {
      return document ? (JSON.parse(document.body) as { changeId: string }).changeId : null
    },
    // 模拟另一台设备直接写入云端。
    writeRemote(order: string[], changeId = `remote-${etagCounter + 1}`) {
      etagCounter += 1
      document = { body: serializeFolderOrderDocument(null, order, changeId), etag: `"e${etagCounter}"` }
    },
    deleteRemote() {
      document = null
    },
  }
}

function adapterOf(store: VaultFolderOrderStore): VaultAdapter {
  return { folderOrderStore: store } as unknown as VaultAdapter
}

function recordFixture(overrides: Partial<Awaited<ReturnType<typeof loadFolderOrderSyncRecord>>> = {}) {
  return {
    attemptedUpload: null,
    base: null,
    cacheId: "cache-x",
    conflict: null,
    error: null,
    key: "folder-order-sync:v1:cache-x",
    localGeneration: 0,
    localOrder: [],
    migratedFromV1Backup: null,
    migrationDone: true,
    pendingIntent: null,
    updatedAt: 0,
    ...overrides,
  } as NonNullable<Awaited<ReturnType<typeof loadFolderOrderSyncRecord>>>
}

beforeEach(async () => {
  window.localStorage.clear()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("swell-note-vault-cache")
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe("decideFolderOrder 纯判定", () => {
  const found = (order: string[], strongEtag: string | null = '"e1"') =>
    ({ changeId: "c1", document: { changeId: "c1", order, schemaVersion: 1 }, kind: "found", order, strongEtag }) as const

  it("base 未知且无本地意图：云端存在则采用，不存在则用自然顺序不创建文件", () => {
    expect(decideFolderOrder(recordFixture(), found(["A"]))).toEqual({ order: ["A"], type: "adopt" })
    expect(decideFolderOrder(recordFixture(), { kind: "missing" })).toEqual({ order: [], type: "adopt" })
  })

  it("迁移候选：云端已存在则云端优先，确认不存在才条件创建", () => {
    const record = recordFixture({ pendingIntent: { generation: 1, order: ["旧"], origin: "migration" } })
    expect(decideFolderOrder(record, found(["新"]))).toEqual({ order: ["新"], type: "adopt" })
    expect(decideFolderOrder(record, { kind: "missing" })).toEqual({ etag: null, method: "create", type: "upload" })
  })

  it("首次读取前用户主动重排：相同则确认，不同进入首次并发选择", () => {
    const record = recordFixture({ pendingIntent: { generation: 1, order: ["A"], origin: "edit" } })
    expect(decideFolderOrder(record, found(["A"]))).toEqual({ type: "synced" })
    expect(decideFolderOrder(record, found(["B"]))).toEqual({ type: "conflict" })
    expect(decideFolderOrder(record, { kind: "missing" })).toEqual({ etag: null, method: "create", type: "upload" })
  })

  it("本地 clean：远端不同则采用，相同只更新基线", () => {
    const record = recordFixture({
      base: { changeId: "c0", etag: '"e0"', exists: true, order: ["A"] },
      localOrder: ["A"],
    })
    expect(decideFolderOrder(record, found(["B"]))).toEqual({ order: ["B"], type: "adopt" })
    expect(decideFolderOrder(record, found(["A"]))).toEqual({ type: "synced" })
  })

  it("远端被删：本地 clean 恢复自然顺序，本地有改动则冲突", () => {
    const clean = recordFixture({
      base: { changeId: "c0", etag: '"e0"', exists: true, order: ["A"] },
      localOrder: ["A"],
    })
    expect(decideFolderOrder(clean, { kind: "missing" })).toEqual({ order: [], type: "adopt" })

    const dirty = recordFixture({
      base: { changeId: "c0", etag: '"e0"', exists: true, order: ["A"] },
      localOrder: ["B", "A"],
      pendingIntent: { generation: 2, order: ["B", "A"], origin: "edit" },
    })
    expect(decideFolderOrder(dirty, { kind: "missing" })).toEqual({ type: "conflict" })
  })

  it("本地改动 + 远端未变：条件更新；相同语义收敛不重复 PUT", () => {
    const record = recordFixture({
      base: { changeId: "c0", etag: '"e0"', exists: true, order: ["A", "B"] },
      localOrder: ["B", "A"],
      pendingIntent: { generation: 2, order: ["B", "A"], origin: "edit" },
    })
    expect(decideFolderOrder(record, found(["A", "B"], '"e9"'))).toEqual({ etag: '"e9"', method: "update", type: "upload" })
    expect(decideFolderOrder(record, found(["B", "A"]))).toEqual({ type: "synced" })
  })

  it("两端相对基线都变了且不同：冲突", () => {
    const record = recordFixture({
      base: { changeId: "c0", etag: '"e0"', exists: true, order: ["A", "B"] },
      localOrder: ["B", "A"],
      pendingIntent: { generation: 2, order: ["B", "A"], origin: "edit" },
    })
    expect(decideFolderOrder(record, found(["A", "C", "B"]))).toEqual({ type: "conflict" })
  })

  it("无强 ETag：可读但本期不做条件更新，保留待同步", () => {
    const record = recordFixture({
      base: { changeId: "c0", etag: '"e0"', exists: true, order: ["A"] },
      localOrder: ["B"],
      pendingIntent: { generation: 2, order: ["B"], origin: "edit" },
    })
    const decision = decideFolderOrder(record, found(["A"], null))
    expect(decision).toMatchObject({ kind: "unsupported-remote", type: "error" })
  })

  it("远端配置不可读：只读报错", () => {
    const decision = decideFolderOrder(recordFixture(), { kind: "unreadable", message: "bad" })
    expect(decision).toEqual({ kind: "unreadable-remote", message: "bad", type: "error" })
  })
})

describe("syncFolderOrder 协调", () => {
  it("无旧排序且云端不存在：自然顺序，不创建空文件", async () => {
    const remote = createMockRemote()
    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("adopted-remote")
    expect(remote.calls).not.toContain("create")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.base).toEqual({ changeId: null, etag: null, exists: false, order: [] })
  })

  it("v1 旧排序 + 云端已存在：云端优先，旧值留备份，不上传", async () => {
    saveFolderOrder("dev-a", ["旧一", "旧二"])
    const remote = createMockRemote()
    remote.writeRemote(["新一", "新二"])

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("adopted-remote")
    expect(remote.calls).not.toContain("create")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.localOrder).toEqual(["新一", "新二"])
    expect(record?.pendingIntent).toBeNull()
    expect(record?.migratedFromV1Backup).toEqual(["旧一", "旧二"])
  })

  it("v1 旧排序 + 云端不存在：迁移候选条件创建，仅首次写入时建目录", async () => {
    saveFolderOrder("dev-a", ["Beta", "Alpha"])
    const remote = createMockRemote()

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("uploaded")
    expect(remote.readOrder()).toEqual(["Beta", "Alpha"])
    expect(remote.calls.filter((call) => call === "mkcol")).toHaveLength(1)
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.pendingIntent).toBeNull()
    expect(record?.base?.exists).toBe(true)

    // 迁移后再次同步不重复导入、不重复写入。
    remote.calls.length = 0
    const again = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(again.outcome).toBe("noop")
    expect(remote.calls).not.toContain("create")
  })

  it("A 上传后 B 拉取采用新顺序；B 改动后 A 再同步，反向也成立", async () => {
    const remote = createMockRemote()
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await getOrCreateFolderOrderSyncRecord("dev-b", null)

    // A 排序并上传。
    await recordFolderOrderLocalEdit("dev-a", ["工作", "学习"])
    const uploadA = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(uploadA.outcome).toBe("uploaded")

    // B 纯拉取：采用 A 的顺序。
    const pullB = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-b" })
    expect(pullB.outcome).toBe("adopted-remote")
    expect((await loadFolderOrderSyncRecord("dev-b"))?.localOrder).toEqual(["工作", "学习"])

    // B 改动并上传，A 再同步采用 B 的顺序。
    await recordFolderOrderLocalEdit("dev-b", ["学习", "工作"])
    const uploadB = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-b" })
    expect(uploadB.outcome).toBe("uploaded")
    const pullA = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(pullA.outcome).toBe("adopted-remote")
    expect((await loadFolderOrderSyncRecord("dev-a"))?.localOrder).toEqual(["学习", "工作"])
  })

  it("只读拉取不写云端：本地意图保留待同步", async () => {
    const remote = createMockRemote()
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await recordFolderOrderLocalEdit("dev-a", ["A", "B"])

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })

    expect(result.outcome).toBe("pending")
    expect(remote.calls).not.toContain("create")
    expect((await loadFolderOrderSyncRecord("dev-a"))?.pendingIntent?.order).toEqual(["A", "B"])
  })

  it("目录结构操作未完成时暂停排序上传", async () => {
    const remote = createMockRemote()
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await recordFolderOrderLocalEdit("dev-a", ["A"])

    const result = await syncFolderOrder({
      adapter: adapterOf(remote.store),
      allowUpload: true,
      cacheId: "dev-a",
      structureUploadBlocked: true,
    })

    expect(result).toMatchObject({ outcome: "pending" })
    expect(remote.calls).not.toContain("create")
  })

  it("两台设备同一 ETag 同时写入：第二个 412，读回重判定进入冲突且双方意图保留", async () => {
    const remote = createMockRemote()
    remote.writeRemote(["A", "B"], "base-change")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await getOrCreateFolderOrderSyncRecord("dev-b", null)
    // 双方都先拉取建立共同基线。
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-b" })

    // A 先上传成功。
    await recordFolderOrderLocalEdit("dev-a", ["B", "A"])
    expect((await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })).outcome)
      .toBe("uploaded")

    // B 基于过期 ETag 上传：先 412，读回发现远端已变 → 冲突，B 的本机意图保留。
    await recordFolderOrderLocalEdit("dev-b", ["A", "C", "B"])
    const resultB = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-b" })
    expect(resultB.outcome).toBe("conflict")
    const recordB = await loadFolderOrderSyncRecord("dev-b")
    expect(recordB?.conflict).toMatchObject({ localOrder: ["A", "C", "B"], remoteOrder: ["B", "A"] })
    expect(recordB?.pendingIntent?.order).toEqual(["A", "C", "B"])
    expect(remote.readOrder()).toEqual(["B", "A"])
  })

  it("两端同时条件创建：后创建者 412，重判定后收敛或冲突", async () => {
    const remote = createMockRemote()
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await getOrCreateFolderOrderSyncRecord("dev-b", null)
    await recordFolderOrderLocalEdit("dev-a", ["同一"])
    await recordFolderOrderLocalEdit("dev-b", ["同一"])

    const [resultA, resultB] = await Promise.all([
      syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" }),
      syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-b" }),
    ])

    // 相同语义：一个创建成功，另一个 412 后读回发现内容一致 → 收敛，不反复写。
    expect([resultA.outcome, resultB.outcome].sort()).toEqual(["noop", "uploaded"])
    expect(remote.readOrder()).toEqual(["同一"])
    expect(remote.calls.filter((call) => call === "create")).toHaveLength(2)
  })

  it("PUT 成功但响应丢失：保存 attempted，下次先 GET 对 changeId 确认，不盲目重复覆盖", async () => {
    const remote = createMockRemote()
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await recordFolderOrderLocalEdit("dev-a", ["A", "B"])
    // 第一次创建在服务端成功，但响应丢失（网络错误）。
    const originalCreate = remote.store.createDocument.bind(remote.store)
    let failedOnce = false
    remote.store.createDocument = async (body: string) => {
      const result = await originalCreate(body)
      if (!failedOnce) {
        failedOnce = true
        throw new WebDavNetworkError()
      }
      return result
    }

    const first = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(first.outcome).toBe("error")
    expect(remote.readOrder()).toEqual(["A", "B"])
    expect((await loadFolderOrderSyncRecord("dev-a"))?.attemptedUpload).not.toBeNull()

    // 再次同步：GET 对 changeId/order 确认已成功，直接记账，不再 PUT。
    remote.calls.length = 0
    const second = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(second.outcome).toBe("noop")
    expect(remote.calls).not.toContain("create")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.attemptedUpload).toBeNull()
    expect(record?.pendingIntent).toBeNull()
    expect(record?.base?.exists).toBe(true)
  })

  it("PUT 无新 ETag：GET 读回核对 changeId/order 后才确认", async () => {
    const remote = createMockRemote()
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await recordFolderOrderLocalEdit("dev-a", ["A"])
    const originalCreate = remote.store.createDocument.bind(remote.store)
    remote.store.createDocument = async (body: string) => {
      await originalCreate(body)
      return { etag: null, etagWeak: false }
    }

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("uploaded")
    expect(remote.calls.filter((call) => call === "get").length).toBeGreaterThanOrEqual(2)
    expect((await loadFolderOrderSyncRecord("dev-a"))?.base?.exists).toBe(true)
  })

  it("上传代次 g 期间用户拖到 g+1：g 确认只更新 base，g+1 保留待同步并继续上传", async () => {
    const remote = createMockRemote()
    remote.writeRemote(["A", "B"], "base-change")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    await recordFolderOrderLocalEdit("dev-a", ["B", "A"])

    // PUT 在服务端生效但响应丢失；等待期间用户又拖动成 g+1。
    const originalUpdate = remote.store.updateDocument.bind(remote.store)
    remote.store.updateDocument = async (body: string, etag: string) => {
      await originalUpdate(body, etag)
      await recordFolderOrderLocalEdit("dev-a", ["A", "B", "C"])
      throw new WebDavNetworkError()
    }
    const first = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(first.outcome).toBe("error")
    remote.store.updateDocument = originalUpdate

    // 下一轮：attempted 确认 g 已成功（只更新 base），g+1 继续上传，不把当前顺序改回 g。
    const second = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(second.outcome).toBe("uploaded")
    expect(remote.readOrder()).toEqual(["A", "B", "C"])
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.localOrder).toEqual(["A", "B", "C"])
    expect(record?.pendingIntent).toBeNull()
  })

  it("远端配置非法 JSON：只读报错，保留本机，绝不覆盖远端", async () => {
    const remote = createMockRemote()
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await recordFolderOrderLocalEdit("dev-a", ["A"])
    remote.writeRemote(["X"])
    // 模拟远端内容被其他客户端写坏。
    remote.store.readDocument = async () => ({ bytes: new TextEncoder().encode("not-json"), etag: '"e9"', etagWeak: false })

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("error")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.error?.kind).toBe("unreadable-remote")
    expect(record?.pendingIntent?.order).toEqual(["A"])
    expect(remote.calls).not.toContain("update")
  })

  it("弱 ETag 服务端：可以读取采用，但不做条件更新，标记不支持", async () => {
    const remote = createMockRemote()
    remote.writeRemote(["A", "B"], "base-change")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    // 读取都返回弱 ETag。
    const originalRead = remote.store.readDocument.bind(remote.store)
    remote.store.readDocument = async () => {
      const document = await originalRead()
      return document ? { ...document, etag: `W/${document.etag}`, etagWeak: true } : null
    }
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    expect((await loadFolderOrderSyncRecord("dev-a"))?.localOrder).toEqual(["A", "B"])

    await recordFolderOrderLocalEdit("dev-a", ["B", "A"])
    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(result.outcome).toBe("error")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.error?.kind).toBe("unsupported-remote")
    expect(record?.pendingIntent?.order).toEqual(["B", "A"])
    expect(remote.readOrder()).toEqual(["A", "B"])
  })

  it("读取 429/网络失败：记录 read 错误，本机意图保留", async () => {
    const remote = createMockRemote()
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await recordFolderOrderLocalEdit("dev-a", ["A"])
    remote.store.readDocument = async () => { throw new WebDavNetworkError() }

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("error")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.error?.kind).toBe("read")
    expect(record?.pendingIntent?.order).toEqual(["A"])
  })

  it("远端配置仍缺失但根目录恢复可确认：noop 清理上一轮 read 错误", async () => {
    const remote = createMockRemote()
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    const originalRead = remote.store.readDocument.bind(remote.store)
    remote.store.readDocument = async () => { throw new WebDavNetworkError() }
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    expect((await loadFolderOrderSyncRecord("dev-a"))?.error?.kind).toBe("read")

    remote.store.readDocument = originalRead
    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("noop")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.base).toEqual({ changeId: null, etag: null, exists: false, order: [] })
    expect(record?.error).toBeNull()
  })

  it("远端损坏错误恢复为 404 且根目录可确认：noop 清理上一轮 unreadable 错误", async () => {
    const remote = createMockRemote()
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    const originalRead = remote.store.readDocument.bind(remote.store)
    remote.store.readDocument = async () => ({
      bytes: new TextEncoder().encode("not-json"),
      etag: '"bad"',
      etagWeak: false,
    })
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    expect((await loadFolderOrderSyncRecord("dev-a"))?.error?.kind).toBe("unreadable-remote")

    remote.store.readDocument = originalRead
    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("noop")
    expect((await loadFolderOrderSyncRecord("dev-a"))?.error).toBeNull()
  })

  it("noop 恢复确认期间出现新本机意图：不清并发新状态", async () => {
    const remote = createMockRemote()
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    await updateFolderOrderSyncRecord("dev-a", (draft) => {
      draft.error = { kind: "read", message: "previous read failed" }
    })
    const originalRead = remote.store.readDocument.bind(remote.store)
    remote.store.readDocument = async () => {
      const document = await originalRead()
      await recordFolderOrderLocalEdit("dev-a", ["本机"])
      return document
    }

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("noop")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.pendingIntent?.order).toEqual(["本机"])
    expect(record?.error).toBeNull()
  })

  it("配置 404 但根目录无法确认：当作读取错误而不是配置重置", async () => {
    const remote = createMockRemote()
    remote.writeRemote(["A"], "c1")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a", rootVerified: true })
    expect((await loadFolderOrderSyncRecord("dev-a"))?.localOrder).toEqual(["A"])

    remote.deleteRemote()
    remote.store.verifyRoot = async () => false
    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })

    expect(result.outcome).toBe("error")
    expect((await loadFolderOrderSyncRecord("dev-a"))?.localOrder).toEqual(["A"])
  })

  it("远端配置被删除：本地 clean 恢复自然顺序并记录缺失基线", async () => {
    const remote = createMockRemote()
    remote.writeRemote(["A"], "c1")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a", rootVerified: true })

    remote.deleteRemote()
    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })

    expect(result.outcome).toBe("adopted-remote")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.localOrder).toEqual([])
    expect(record?.base).toEqual({ changeId: null, etag: null, exists: false, order: [] })
  })

  it("同步中途用户又拖动：adopt 落盘守卫放弃应用，不覆盖新编辑", async () => {
    const remote = createMockRemote()
    remote.writeRemote(["远端"], "c1")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    const originalRead = remote.store.readDocument.bind(remote.store)
    remote.store.readDocument = async () => {
      const document = await originalRead()
      // GET 返回后、adopt 落盘前，用户拖动了。
      await recordFolderOrderLocalEdit("dev-a", ["本机"])
      return document
    }

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("pending")
    expect((await loadFolderOrderSyncRecord("dev-a"))?.localOrder).toEqual(["本机"])
  })

  // 回归（审查 #7）：取消必须在 verifyRoot、ensureMetadataDirectory、412 重判定等
  // 后续异步边界与写入前生效；已发出的 PUT 仍按 attemptedUpload 机制确认，不假装回滚。
  describe("运行取消（审查 #7）", () => {
    it("verifyRoot 期间取消：skipped，不落任何基线", async () => {
      const remote = createMockRemote()
      await getOrCreateFolderOrderSyncRecord("dev-a", null)
      let cancelled = false
      remote.store.verifyRoot = async () => {
        cancelled = true
        return true
      }

      const result = await syncFolderOrder({
        adapter: adapterOf(remote.store),
        allowUpload: true,
        cacheId: "dev-a",
        isCancelled: () => cancelled,
      })

      expect(result.outcome).toBe("skipped")
      expect((await loadFolderOrderSyncRecord("dev-a"))?.base).toBeNull()
    })

    it("写入前取消：skipped，不发出 MKCOL/PUT，本机意图保留", async () => {
      const remote = createMockRemote()
      await getOrCreateFolderOrderSyncRecord("dev-a", null)
      await recordFolderOrderLocalEdit("dev-a", ["A"])
      let cancelled = false
      const originalRead = remote.store.readDocument.bind(remote.store)
      remote.store.readDocument = async () => {
        const document = await originalRead()
        cancelled = true
        return document
      }

      const result = await syncFolderOrder({
        adapter: adapterOf(remote.store),
        allowUpload: true,
        cacheId: "dev-a",
        isCancelled: () => cancelled,
      })

      expect(result.outcome).toBe("skipped")
      expect(remote.calls).not.toContain("mkcol")
      expect(remote.calls).not.toContain("create")
      expect((await loadFolderOrderSyncRecord("dev-a"))?.pendingIntent?.order).toEqual(["A"])
    })

    it("ensureMetadataDirectory 期间取消：目录可建但 PUT 不发出", async () => {
      const remote = createMockRemote()
      await getOrCreateFolderOrderSyncRecord("dev-a", null)
      await recordFolderOrderLocalEdit("dev-a", ["A"])
      let cancelled = false
      remote.store.ensureMetadataDirectory = async () => {
        cancelled = true
      }

      const result = await syncFolderOrder({
        adapter: adapterOf(remote.store),
        allowUpload: true,
        cacheId: "dev-a",
        isCancelled: () => cancelled,
      })

      expect(result.outcome).toBe("skipped")
      expect(remote.calls).not.toContain("create")
      expect(remote.readOrder()).toEqual([])
      expect((await loadFolderOrderSyncRecord("dev-a"))?.pendingIntent?.order).toEqual(["A"])
    })

    it("412 重判定期间取消：skipped，不再二次 PUT", async () => {
      const remote = createMockRemote()
      remote.writeRemote(["A", "B"], "base-change")
      await getOrCreateFolderOrderSyncRecord("dev-a", null)
      await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
      await recordFolderOrderLocalEdit("dev-a", ["B", "A"])

      let updateCalls = 0
      remote.store.updateDocument = async () => {
        updateCalls += 1
        throw new WebDavRevisionConflictError(DOCUMENT_PATH)
      }
      let cancelled = false
      let reads = 0
      const originalRead = remote.store.readDocument.bind(remote.store)
      remote.store.readDocument = async () => {
        reads += 1
        const document = await originalRead()
        // 第一次是主读取，第二次是 412 后的重判定读回。
        if (reads >= 2) cancelled = true
        return document
      }

      const result = await syncFolderOrder({
        adapter: adapterOf(remote.store),
        allowUpload: true,
        cacheId: "dev-a",
        isCancelled: () => cancelled,
      })

      expect(result.outcome).toBe("skipped")
      expect(updateCalls).toBe(1)
      expect((await loadFolderOrderSyncRecord("dev-a"))?.pendingIntent?.order).toEqual(["B", "A"])
    })
  })

  // 回归（审查 #8）：序列化与上传前统一校验协议上限，超限保留本机意图并报错。
  describe("协议上限（审查 #8）", () => {
    it("本机意图超出条目上限：报错保留意图，不发出 PUT", async () => {
      const remote = createMockRemote()
      await getOrCreateFolderOrderSyncRecord("dev-a", null)
      const tooMany = Array.from({ length: 5_001 }, (_, index) => `目录${index}`)
      await recordFolderOrderLocalEdit("dev-a", tooMany)

      const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

      expect(result.outcome).toBe("error")
      expect(remote.calls).not.toContain("create")
      const record = await loadFolderOrderSyncRecord("dev-a")
      expect(record?.pendingIntent?.order).toHaveLength(5_001)
      expect(record?.error?.kind).toBe("upload")
    })

    it("本机意图含非法目录名：报错保留意图，不发出 PUT", async () => {
      const remote = createMockRemote()
      await getOrCreateFolderOrderSyncRecord("dev-a", null)
      await updateFolderOrderSyncRecord("dev-a", (draft) => {
        draft.localOrder = ["a/b"]
        draft.localGeneration = 1
        draft.pendingIntent = { generation: 1, order: ["a/b"], origin: "edit" }
      })

      const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

      expect(result.outcome).toBe("error")
      expect(remote.calls).not.toContain("create")
      expect((await loadFolderOrderSyncRecord("dev-a"))?.pendingIntent?.order).toEqual(["a/b"])
    })
  })
})

// 回归（审查 #6）：两端内容收敛时，在代次守卫下清理旧 conflict 和过期候选；
// 不能清掉同步期间产生的新编辑或新冲突。
describe("内容收敛时的冲突清理（审查 #6）", () => {
  async function setupConvergedConflict(remote: ReturnType<typeof createMockRemote>) {
    remote.writeRemote(["A", "B"], "base-change")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    await recordFolderOrderLocalEdit("dev-a", ["B", "A"])
    remote.writeRemote(["A", "C", "B"], "other-device")
    const conflicted = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(conflicted.outcome).toBe("conflict")
    // 另一设备采纳了我们的顺序并上传：远端内容与本机意图收敛。
    remote.writeRemote(["B", "A"], "other-adopted-ours")
  }

  it("远端收敛到本机内容：旧冲突与已确认代次一并清理", async () => {
    const remote = createMockRemote()
    await setupConvergedConflict(remote)

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("noop")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict).toBeNull()
    expect(record?.pendingIntent).toBeNull()
    expect(record?.base?.order).toEqual(["B", "A"])
  })

  it("收敛确认期间用户又编辑：新意图与被刷新的冲突保留", async () => {
    const remote = createMockRemote()
    await setupConvergedConflict(remote)
    // GET 之后、synced 落盘前用户又拖动：编辑会把冲突本机候选刷到新代次。
    const originalRead = remote.store.readDocument.bind(remote.store)
    remote.store.readDocument = async () => {
      const document = await originalRead()
      await recordFolderOrderLocalEdit("dev-a", ["新编辑"])
      return document
    }

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("noop")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.localOrder).toEqual(["新编辑"])
    expect(record?.pendingIntent?.order).toEqual(["新编辑"])
    expect(record?.conflict?.localOrder).toEqual(["新编辑"])
  })

  it("attempted 上传确认成功：同代次的旧冲突一并清理", async () => {
    const remote = createMockRemote()
    // PUT 实际已在服务端成功（changeId 与 attempted 快照一致），但本地还留着同代次冲突。
    remote.writeRemote(["B", "A"], "c-attempt")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await updateFolderOrderSyncRecord("dev-a", (draft) => {
      draft.base = { changeId: "c0", etag: '"e0"', exists: true, order: ["A", "B"] }
      draft.localOrder = ["B", "A"]
      draft.localGeneration = 2
      draft.pendingIntent = { generation: 2, order: ["B", "A"], origin: "edit" }
      draft.attemptedUpload = { changeId: "c-attempt", generation: 2, order: ["B", "A"] }
      draft.conflict = {
        localGeneration: 2,
        localOrder: ["B", "A"],
        remoteChangeId: "c0",
        remoteEtag: '"e0"',
        remoteExists: true,
        remoteOrder: ["A", "B"],
      }
    })

    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })

    expect(result.outcome).toBe("noop")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.attemptedUpload).toBeNull()
    expect(record?.pendingIntent).toBeNull()
    expect(record?.conflict).toBeNull()
    expect(record?.base?.order).toEqual(["B", "A"])
  })
})

describe("resolveFolderOrderConflict", () => {
  async function setupConflict(remote: ReturnType<typeof createMockRemote>) {
    remote.writeRemote(["A", "B"], "base-change")
    await getOrCreateFolderOrderSyncRecord("dev-a", null)
    await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: false, cacheId: "dev-a" })
    await recordFolderOrderLocalEdit("dev-a", ["B", "A"])
    remote.writeRemote(["A", "C", "B"], "other-device")
    const result = await syncFolderOrder({ adapter: adapterOf(remote.store), allowUpload: true, cacheId: "dev-a" })
    expect(result.outcome).toBe("conflict")
  }

  function forceLocalResolutionPreconditionFailure(
    remote: ReturnType<typeof createMockRemote>,
    freshRead: () => ReturnType<VaultFolderOrderStore["readDocument"]>,
  ) {
    const originalRead = remote.store.readDocument.bind(remote.store)
    let readCount = 0
    remote.store.readDocument = async () => {
      readCount += 1
      return readCount === 1 ? originalRead() : freshRead()
    }
    remote.store.updateDocument = async () => {
      throw new WebDavRevisionConflictError(DOCUMENT_PATH)
    }
  }

  it("使用云端：重读校验后应用，冲突与本机意图清除", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "remote" })

    expect(result.outcome).toBe("adopted-remote")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.localOrder).toEqual(["A", "C", "B"])
    expect(record?.conflict).toBeNull()
    expect(record?.pendingIntent).toBeNull()
  })

  it("使用本机：以最新 ETag 条件写入当前本机候选", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("uploaded")
    expect(remote.readOrder()).toEqual(["B", "A"])
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict).toBeNull()
    expect(record?.pendingIntent).toBeNull()
    expect(record?.base?.order).toEqual(["B", "A"])
  })

  it("选择期间用户又拖动：不得无提示丢掉新编辑，冲突以最新候选保留", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    // 用户点了“使用云端”，在重读云端校验期间又拖了一次。
    const originalRead = remote.store.readDocument.bind(remote.store)
    remote.store.readDocument = async () => {
      const document = await originalRead()
      await recordFolderOrderLocalEdit("dev-a", ["新编辑"])
      return document
    }

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "remote" })

    expect(result.outcome).toBe("conflict")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.localOrder).toEqual(["新编辑"])
    expect(record?.localOrder).toEqual(["新编辑"])
  })

  it("使用本机再次 412：保留冲突，不无限自动覆盖后来版本", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    // 第三台设备在我们重读之后又写了一次。
    remote.hooks.beforeUpdate = () => remote.writeRemote(["第三台"], "third")

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("conflict")
    expect(remote.readOrder()).toEqual(["第三台"])
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.localOrder).toEqual(["B", "A"])
    expect(record?.conflict?.remoteOrder).toEqual(["第三台"])
  })

  it("使用本机再次 412 后读到合法新版本：刷新远端候选", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    forceLocalResolutionPreconditionFailure(remote, async () => ({
      bytes: new TextEncoder().encode(serializeFolderOrderDocument(null, ["第三台"], "third")),
      etag: '"third"',
      etagWeak: false,
    }))

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("conflict")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.localOrder).toEqual(["B", "A"])
    expect(record?.conflict?.remoteExists).toBe(true)
    expect(record?.conflict?.remoteOrder).toEqual(["第三台"])
    expect(record?.error).toBeNull()
  })

  it("使用本机再次 412 后读到损坏 JSON：保留原远端候选并记录错误", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    const before = (await loadFolderOrderSyncRecord("dev-a"))?.conflict
    forceLocalResolutionPreconditionFailure(remote, async () => ({
      bytes: new TextEncoder().encode("not-json"),
      etag: '"bad"',
      etagWeak: false,
    }))

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("error")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.remoteExists).toBe(before?.remoteExists)
    expect(record?.conflict?.remoteOrder).toEqual(before?.remoteOrder)
    expect(record?.pendingIntent?.order).toEqual(["B", "A"])
    expect(record?.attemptedUpload).toBeNull()
    expect(record?.error?.kind).toBe("unreadable-remote")
  })

  it("使用本机再次 412 后读到未知版本：保留原远端候选并记录错误", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    const before = (await loadFolderOrderSyncRecord("dev-a"))?.conflict
    forceLocalResolutionPreconditionFailure(remote, async () => ({
      bytes: new TextEncoder().encode(JSON.stringify({ changeId: "future", order: [], schemaVersion: 2 })),
      etag: '"future"',
      etagWeak: false,
    }))

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("error")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.remoteOrder).toEqual(before?.remoteOrder)
    expect(record?.pendingIntent?.order).toEqual(["B", "A"])
    expect(record?.error?.kind).toBe("unreadable-remote")
  })

  it("使用本机再次 412 后读到超限远端：保留原远端候选并记录错误", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    const before = (await loadFolderOrderSyncRecord("dev-a"))?.conflict
    forceLocalResolutionPreconditionFailure(remote, async () => {
      throw new WebDavContentTooLargeError("远端排序配置超出大小上限，已保留本机顺序")
    })

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("error")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.remoteOrder).toEqual(before?.remoteOrder)
    expect(record?.pendingIntent?.order).toEqual(["B", "A"])
    expect(record?.error?.kind).toBe("unreadable-remote")
  })

  it("使用本机再次 412 后读到 404 且根目录无法确认：保留原远端候选并记录错误", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    const before = (await loadFolderOrderSyncRecord("dev-a"))?.conflict
    forceLocalResolutionPreconditionFailure(remote, async () => null)
    remote.store.verifyRoot = async () => false

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("error")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.remoteExists).toBe(before?.remoteExists)
    expect(record?.conflict?.remoteOrder).toEqual(before?.remoteOrder)
    expect(record?.pendingIntent?.order).toEqual(["B", "A"])
    expect(record?.error?.kind).toBe("read")
  })

  it("使用本机再次 412 后读到 404 且根目录存在：刷新为云端删除候选", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    forceLocalResolutionPreconditionFailure(remote, async () => null)

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("conflict")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.localOrder).toEqual(["B", "A"])
    expect(record?.conflict?.remoteExists).toBe(false)
    expect(record?.conflict?.remoteOrder).toEqual([])
    expect(record?.pendingIntent?.order).toEqual(["B", "A"])
    expect(record?.error).toBeNull()
  })

  // 回归（审查 #1）：冲突处理严格区分合法文档、404、损坏/未知版本/超限；
  // 失败时保留 localOrder、pendingIntent 和冲突。
  describe("远端有效性检查（审查 #1）", () => {
    it("使用云端时远端配置损坏：报错，不把 unreadable 当成空顺序", async () => {
      const remote = createMockRemote()
      await setupConflict(remote)
      remote.store.readDocument = async () => ({
        bytes: new TextEncoder().encode("not-json"),
        etag: '"e9"',
        etagWeak: false,
      })

      const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "remote" })

      expect(result.outcome).toBe("error")
      const record = await loadFolderOrderSyncRecord("dev-a")
      expect(record?.error?.kind).toBe("unreadable-remote")
      expect(record?.localOrder).toEqual(["B", "A"])
      expect(record?.pendingIntent?.order).toEqual(["B", "A"])
      expect(record?.conflict?.localOrder).toEqual(["B", "A"])
    })

    it("使用云端时远端 404 且根目录无法确认：报错，不把根目录消失当成空顺序", async () => {
      const remote = createMockRemote()
      await setupConflict(remote)
      remote.deleteRemote()
      remote.store.verifyRoot = async () => false

      const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "remote" })

      expect(result.outcome).toBe("error")
      const record = await loadFolderOrderSyncRecord("dev-a")
      expect(record?.localOrder).toEqual(["B", "A"])
      expect(record?.pendingIntent?.order).toEqual(["B", "A"])
      expect(record?.conflict).not.toBeNull()
    })

    it("使用云端时远端 404 且根目录确认存在：按远端重置应用空顺序", async () => {
      const remote = createMockRemote()
      await setupConflict(remote)
      remote.deleteRemote()

      const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "remote" })

      expect(result.outcome).toBe("adopted-remote")
      const record = await loadFolderOrderSyncRecord("dev-a")
      expect(record?.localOrder).toEqual([])
      expect(record?.conflict).toBeNull()
      expect(record?.base).toEqual({ changeId: null, etag: null, exists: false, order: [] })
    })

    it("使用本机时远端配置损坏：报错，不发出任何写入", async () => {
      const remote = createMockRemote()
      await setupConflict(remote)
      remote.store.readDocument = async () => ({
        bytes: new TextEncoder().encode("not-json"),
        etag: '"e9"',
        etagWeak: false,
      })

      const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

      expect(result.outcome).toBe("error")
      expect(remote.calls).not.toContain("update")
      expect(remote.calls).not.toContain("create")
      const record = await loadFolderOrderSyncRecord("dev-a")
      expect(record?.conflict?.localOrder).toEqual(["B", "A"])
      expect(record?.pendingIntent?.order).toEqual(["B", "A"])
    })

    it("使用本机时远端 404 且根目录无法确认：报错，不条件创建", async () => {
      const remote = createMockRemote()
      await setupConflict(remote)
      remote.deleteRemote()
      remote.store.verifyRoot = async () => false

      const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

      expect(result.outcome).toBe("error")
      expect(remote.calls).not.toContain("mkcol")
      expect(remote.calls).not.toContain("create")
      const record = await loadFolderOrderSyncRecord("dev-a")
      expect(record?.conflict).not.toBeNull()
      expect(record?.pendingIntent?.order).toEqual(["B", "A"])
    })

    it("使用本机时远端 404 且根目录确认存在：按重置后的空远端条件创建", async () => {
      const remote = createMockRemote()
      await setupConflict(remote)
      remote.deleteRemote()

      const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

      expect(result.outcome).toBe("uploaded")
      expect(remote.readOrder()).toEqual(["B", "A"])
      expect((await loadFolderOrderSyncRecord("dev-a"))?.conflict).toBeNull()
    })
  })

  // 回归（审查 #2）：使用本机与普通上传走一致的结构阻断规则。
  it("使用本机但目录结构操作未完成：暂停上传并保留冲突", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)

    const result = await resolveFolderOrderConflict({
      adapter: adapterOf(remote.store),
      cacheId: "dev-a",
      choice: "local",
      structureUploadBlocked: true,
    })

    expect(result.outcome).toBe("pending")
    expect(remote.calls).not.toContain("update")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.conflict?.localOrder).toEqual(["B", "A"])
    expect(record?.pendingIntent?.order).toEqual(["B", "A"])
  })

  // 回归（审查 #8）：冲突覆盖路径同样受协议上限约束。
  it("使用本机时本机候选超限：报错保留冲突与意图，不发出 PUT", async () => {
    const remote = createMockRemote()
    await setupConflict(remote)
    const tooMany = Array.from({ length: 5_001 }, (_, index) => `目录${index}`)
    await recordFolderOrderLocalEdit("dev-a", tooMany)

    const result = await resolveFolderOrderConflict({ adapter: adapterOf(remote.store), cacheId: "dev-a", choice: "local" })

    expect(result.outcome).toBe("error")
    expect(remote.calls).not.toContain("update")
    const record = await loadFolderOrderSyncRecord("dev-a")
    expect(record?.pendingIntent?.order).toHaveLength(5_001)
    expect(record?.conflict?.localOrder).toHaveLength(5_001)
  })
})
