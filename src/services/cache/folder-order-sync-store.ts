import { moveFolderOrderPath } from "@/services/preferences/folder-order-preferences"
import { mergeVisibleFolderOrder } from "@/services/preferences/folder-order-document"

import { openVaultCacheDatabase } from "./vault-cache"

// 文件夹排序的每库同步工作副本：这是同步状态的唯一事实来源。
// 存进既有 IndexedDB 的 settings store（键 folder-order-sync:v1:<cacheId>），
// 不为每次排序重写整库笔记快照，也不与 v1 localStorage 各自维护可写主状态。

export const FOLDER_ORDER_SYNC_KEY_PREFIX = "folder-order-sync:v1:"

const SETTINGS_STORE = "settings"

export type FolderOrderRemoteBase = {
  // 上次确认过的远端版本标识；服务端不给强 ETag 时只能为 null（可读不可安全更新）。
  etag: string | null
  changeId: string | null
  // exists=false 表示“确认过文件不存在”，与 base=null（尚未观察过远端）不同。
  exists: boolean
  order: string[]
}

export type FolderOrderPendingIntent = {
  generation: number
  order: string[]
  // migration = v1 历史排序的一次性迁移候选；edit = 用户主动编辑。
  origin: "edit" | "migration"
}

export type FolderOrderAttemptedUpload = {
  // PUT 结果不明（超时/断网可能已在服务端成功）时保存的快照；
  // 下一次先 GET 核对 changeId/order，确认成功或重新三方判定，不盲目重复覆盖。
  changeId: string
  generation: number
  order: string[]
}

export type FolderOrderConflict = {
  // 冲突双方候选都保留，不能清空本机意图；远端缺失时 remoteExists=false（云端候选即自然顺序）。
  localGeneration: number
  localOrder: string[]
  remoteChangeId: string | null
  remoteEtag: string | null
  remoteExists: boolean
  remoteOrder: string[]
}

export type FolderOrderSyncErrorKind =
  | "read"                // 读取远端配置失败（网络/限流/权限等）
  | "unreadable-remote"   // 远端配置非法/未知版本/超限：只读报错，不覆盖远端
  | "unsupported-remote"  // 服务端不提供强 ETag：可读但本期不做条件更新
  | "upload"              // 条件上传失败（含 412 重判定后仍失败）
  | "aborted"             // 上传结果不明，已按 attempted 快照留待下次确认

export type FolderOrderSyncRecord = {
  key: string
  cacheId: string
  // 当前本机完整顺序（含未扫描目录槽位）；每次本机意图变化 generation +1。
  localGeneration: number
  localOrder: string[]
  base: FolderOrderRemoteBase | null
  pendingIntent: FolderOrderPendingIntent | null
  attemptedUpload: FolderOrderAttemptedUpload | null
  conflict: FolderOrderConflict | null
  error: { kind: FolderOrderSyncErrorKind; message: string } | null
  // v1 localStorage 一次性迁移标记；旧值备份保留，避免每次启动重新标成待上传。
  migrationDone: boolean
  migratedFromV1Backup: string[] | null
  updatedAt: number
}

export type FolderOrderSyncStatus = "clean" | "pending" | "conflict" | "error"

export function folderOrderSyncKey(cacheId: string) {
  return `${FOLDER_ORDER_SYNC_KEY_PREFIX}${cacheId}`
}

export function getFolderOrderSyncStatus(record: FolderOrderSyncRecord): FolderOrderSyncStatus {
  if (record.conflict) return "conflict"
  if (record.error) return "error"
  if (record.pendingIntent || record.attemptedUpload) return "pending"
  return "clean"
}

// 自动同步队列签名：只含内容与代次。错误文本不能进入签名——
// 失败后只更新 error 若形成新签名，会触发无限自动重试。
export function buildFolderOrderQueueSignature(record: FolderOrderSyncRecord | null): string {
  if (!record) return ""
  if (record.pendingIntent) return `intent:${record.pendingIntent.generation}:${record.pendingIntent.order.join("")}`
  if (record.attemptedUpload) return `attempt:${record.attemptedUpload.changeId}`
  return ""
}

function createEmptyRecord(cacheId: string): FolderOrderSyncRecord {
  return {
    attemptedUpload: null,
    base: null,
    cacheId,
    conflict: null,
    error: null,
    key: folderOrderSyncKey(cacheId),
    localGeneration: 0,
    localOrder: [],
    migratedFromV1Backup: null,
    migrationDone: false,
    pendingIntent: null,
    updatedAt: Date.now(),
  }
}

type FolderOrderSyncListener = (record: FolderOrderSyncRecord | null) => void

const listenersByCacheId = new Map<string, Set<FolderOrderSyncListener>>()
const localMutationChains = new Map<string, Promise<unknown>>()

// 订阅某库工作副本的变化（本标签页内的写入都会广播；不做跨标签页同步）。
export function subscribeFolderOrderSyncRecord(cacheId: string, listener: FolderOrderSyncListener) {
  let listeners = listenersByCacheId.get(cacheId)
  if (!listeners) {
    listeners = new Set()
    listenersByCacheId.set(cacheId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByCacheId.delete(cacheId)
  }
}

function notifyFolderOrderSyncRecord(cacheId: string, record: FolderOrderSyncRecord | null) {
  const listeners = listenersByCacheId.get(cacheId)
  if (!listeners) return
  for (const listener of [...listeners]) listener(record)
}

function enqueueFolderOrderLocalMutation<T>(cacheId: string, task: () => Promise<T>): Promise<T> {
  const previous = localMutationChains.get(cacheId) ?? Promise.resolve()
  // 本机拖动/重命名按用户动作顺序串行落盘；前一笔失败只影响自身，不阻塞后续编辑。
  const run = previous.catch(() => undefined).then(task)
  localMutationChains.set(cacheId, run)
  return run.finally(() => {
    if (localMutationChains.get(cacheId) === run) localMutationChains.delete(cacheId)
  })
}

export async function loadFolderOrderSyncRecord(cacheId: string): Promise<FolderOrderSyncRecord | null> {
  const database = await openVaultCacheDatabase()
  const record = await requestResult<FolderOrderSyncRecord | undefined>(
    database.transaction(SETTINGS_STORE, "readonly").objectStore(SETTINGS_STORE).get(folderOrderSyncKey(cacheId)),
  )
  database.close()
  return record ?? null
}

// 首次访问时建立工作副本：v1 localStorage 的历史排序只作为一次性输入，
// 非空则标为待上传迁移候选并留备份；migrationDone 保证不会每次启动重复标记。
export async function getOrCreateFolderOrderSyncRecord(
  cacheId: string,
  v1Order: readonly string[] | null,
): Promise<FolderOrderSyncRecord> {
  const database = await openVaultCacheDatabase()
  const transaction = database.transaction(SETTINGS_STORE, "readwrite")
  const store = transaction.objectStore(SETTINGS_STORE)
  const existing = await requestResult<FolderOrderSyncRecord | undefined>(store.get(folderOrderSyncKey(cacheId)))
  if (existing) {
    await transactionDone(transaction)
    database.close()
    return existing
  }
  const record = createEmptyRecord(cacheId)
  const legacyOrder = v1Order && v1Order.length > 0 ? [...v1Order] : null
  if (legacyOrder) {
    record.localOrder = [...legacyOrder]
    record.localGeneration = 1
    record.pendingIntent = { generation: 1, order: [...legacyOrder], origin: "migration" }
    record.migratedFromV1Backup = [...legacyOrder]
  }
  record.migrationDone = true
  store.put(record)
  await transactionDone(transaction)
  database.close()
  notifyFolderOrderSyncRecord(cacheId, record)
  return record
}

// 单事务 read-modify-write：mutate 返回 false 表示前提已失效（放弃本次写入），
// 调用方据此用最新记录重新判定，避免决策与落盘之间的竞态覆盖用户编辑。
export async function updateFolderOrderSyncRecord(
  cacheId: string,
  mutate: (record: FolderOrderSyncRecord) => boolean | void,
): Promise<{ changed: boolean; record: FolderOrderSyncRecord | null }> {
  const database = await openVaultCacheDatabase()
  const transaction = database.transaction(SETTINGS_STORE, "readwrite")
  const store = transaction.objectStore(SETTINGS_STORE)
  const current = await requestResult<FolderOrderSyncRecord | undefined>(store.get(folderOrderSyncKey(cacheId)))
  if (!current) {
    await transactionDone(transaction)
    database.close()
    return { changed: false, record: null }
  }
  const record: FolderOrderSyncRecord = { ...current, updatedAt: Date.now() }
  let result: boolean | void
  try {
    result = mutate(record)
  } catch (error) {
    database.close()
    throw error
  }
  if (result === false) {
    // 前提失效：不写入，把读到的最新记录交还调用方重新判定。
    await transactionDone(transaction)
    database.close()
    return { changed: false, record: current }
  }
  store.put(record)
  await transactionDone(transaction)
  database.close()
  notifyFolderOrderSyncRecord(cacheId, record)
  return { changed: true, record }
}

export async function deleteFolderOrderSyncRecord(cacheId: string): Promise<void> {
  const database = await openVaultCacheDatabase()
  const transaction = database.transaction(SETTINGS_STORE, "readwrite")
  transaction.objectStore(SETTINGS_STORE).delete(folderOrderSyncKey(cacheId))
  await transactionDone(transaction)
  database.close()
  notifyFolderOrderSyncRecord(cacheId, null)
}

// 本机排序编辑（拖动提交/重命名迁移）：完整顺序整体替换，代次 +1 并标记未上传意图。
// 冲突存在时同步刷新本机候选（新编辑不被无提示丢掉）；旧错误随之清除，由下次同步重新评估。
export async function recordFolderOrderLocalEdit(
  cacheId: string,
  order: readonly string[],
  origin: "edit" | "migration" = "edit",
): Promise<FolderOrderSyncRecord | null> {
  return enqueueFolderOrderLocalMutation(cacheId, async () => {
    const { record } = await updateFolderOrderSyncRecord(cacheId, (draft) => {
      const generation = draft.localGeneration + 1
      draft.localOrder = [...order]
      draft.localGeneration = generation
      draft.pendingIntent = { generation, order: [...order], origin }
      draft.error = null
      if (draft.conflict) {
        draft.conflict = { ...draft.conflict, localGeneration: generation, localOrder: [...order] }
      }
    })
    return record
  })
}

// 可见子集的拖动提交：合并必须在单事务内以工作副本最新 localOrder 为基完成。
// 调用方持有的内存快照可能滞后（如拖动期间远端 adopt 被延期），若先在内存合并
// 再整表覆盖，会丢掉副本中尚未应用到界面的成员。合并结果与副本一致时不写盘、
// 不推进代次；冲突中的本机候选同步刷新，避免“使用本机”写回旧顺序。
export async function recordFolderOrderVisibleEdit(
  cacheId: string,
  visibleOrder: readonly string[],
): Promise<FolderOrderSyncRecord | null> {
  return enqueueFolderOrderLocalMutation(cacheId, async () => {
    const { record } = await updateFolderOrderSyncRecord(cacheId, (draft) => {
      const next = mergeVisibleFolderOrder(draft.localOrder, visibleOrder)
      if (next.length === draft.localOrder.length
        && next.every((path, index) => path === draft.localOrder[index])) return false
      const generation = draft.localGeneration + 1
      draft.localOrder = next
      draft.localGeneration = generation
      draft.pendingIntent = { generation, order: [...next], origin: "edit" }
      draft.error = null
      if (draft.conflict) {
        draft.conflict = { ...draft.conflict, localGeneration: generation, localOrder: [...next] }
      }
      return true
    })
    return record
  })
}

// 目录重命名确认后的排序路径迁移：在工作副本的单事务内读-改-写，保持原位置。
// 不依赖调用方持有的内存快照——内存可能落后于工作副本（如拖动期间远端 adopt 被延期），
// 以副本为准才不会丢掉其中尚未应用到界面的成员；与并发 adopt/拖动提交串行叠加、互不覆盖。
// 未命中任何条目时不写盘、不推进代次。
export async function recordFolderOrderPathMigration(
  cacheId: string,
  fromPath: string,
  toPath: string,
): Promise<FolderOrderSyncRecord | null> {
  return enqueueFolderOrderLocalMutation(cacheId, async () => {
    const { record } = await updateFolderOrderSyncRecord(cacheId, (draft) => {
      const next = moveFolderOrderPath(draft.localOrder, fromPath, toPath)
      // moveFolderOrderPath 未命中时返回原数组引用：不写盘（前提失效语义）。
      if (next === draft.localOrder) return false
      const generation = draft.localGeneration + 1
      draft.localOrder = next
      draft.localGeneration = generation
      draft.pendingIntent = { generation, order: [...next], origin: "edit" }
      draft.error = null
      if (draft.conflict) {
        draft.conflict = { ...draft.conflict, localGeneration: generation, localOrder: [...next] }
      }
      return true
    })
    return record
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("读取排序同步状态失败"))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error("保存排序同步状态失败"))
    transaction.onerror = () => reject(transaction.error ?? new Error("保存排序同步状态失败"))
  })
}
