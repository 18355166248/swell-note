import {
  getOrCreateFolderOrderSyncRecord,
  loadFolderOrderSyncRecord,
  updateFolderOrderSyncRecord,
  type FolderOrderConflict,
  type FolderOrderSyncErrorKind,
  type FolderOrderSyncRecord,
} from "@/services/cache/folder-order-sync-store"
import {
  createFolderOrderChangeId,
  FolderOrderDocumentError,
  folderOrderContentEquals,
  parseFolderOrderDocument,
  sanitizeFolderOrderEntries,
  serializeFolderOrderDocument,
  type FolderOrderDocument,
} from "@/services/preferences/folder-order-document"
import { loadFolderOrder } from "@/services/preferences/folder-order-preferences"
import type { VaultAdapter, VaultFolderOrderStore } from "@/services/vault/vault-adapter"
import {
  WebDavAuthenticationError,
  WebDavContentTooLargeError,
  WebDavRevisionConflictError,
} from "@/services/webdav-client"

// 文件夹排序的同步协调：base/local/remote 三方判定 + 条件写入 + 结果不明确认 + 冲突选择。
// 判定是纯函数 decideFolderOrder；所有 await 后的落盘都带代次/前提守卫，
// 保证“决策之后用户又拖动”不会被覆盖。每库通过 enqueue 串行化。

export type FolderOrderSyncOutcome =
  | "noop"            // 无变化（本机与远端一致）
  | "adopted-remote"  // 应用了远端顺序（含远端被删后恢复自然顺序）
  | "uploaded"        // 条件上传成功并已确认
  | "pending"         // 有本机意图未上传（只读拉取、结构操作未完成或决策间又编辑）
  | "conflict"        // 两端相对基线都变了且不同，等待用户选择
  | "error"           // 读取/上传失败；本机意图保留
  | "skipped"         // 无元数据能力或本轮已取消

export type FolderOrderSyncRunResult = {
  outcome: FolderOrderSyncOutcome
  message?: string
}

export type FolderOrderSyncOptions = {
  adapter: VaultAdapter
  cacheId: string
  // 手动/自动同步允许上传；启动恢复与前台节流拉取只读，不写云端。
  allowUpload: boolean
  // 本库还有未完成的目录结构操作（创建/重命名/删除）时暂停排序上传。
  structureUploadBlocked?: boolean
  // 调用方刚完成整库远端读取时传 true，跳过额外的根目录存在性检查。
  rootVerified?: boolean
  isCancelled?: () => boolean
}

// 一次远端观察的结果。导出以便判定函数可独立单测。
export type RemoteObservation =
  | { kind: "missing" }
  | {
      changeId: string
      document: FolderOrderDocument
      kind: "found"
      order: string[]
      strongEtag: string | null
    }
  | { kind: "unreadable"; message: string }

export type FolderOrderDecision =
  | { type: "noop" }
  // 应用远端顺序（order 为空即恢复自然顺序）；远端缺失时记录缺失基线。
  | { type: "adopt"; order: string[] }
  // 远端内容已与本机（意图）一致：更新 base/ETag、确认相应代次，不重复 PUT。
  | { type: "synced" }
  | { type: "upload"; etag: string | null; method: "create" | "update" }
  | { type: "conflict" }
  | { type: "error"; kind: FolderOrderSyncErrorKind; message: string }

// ---- 纯判定（可独立单测）----

export function decideFolderOrder(
  record: FolderOrderSyncRecord,
  remote: RemoteObservation,
): FolderOrderDecision {
  if (remote.kind === "unreadable") {
    return { kind: "unreadable-remote", message: remote.message, type: "error" }
  }
  const intent = record.pendingIntent
  const base = record.base

  // base 未知 = 首次观察远端，按迁移规则处理，不能假装已有共同基线。
  if (!base) {
    if (!intent) {
      // 没有旧排序：云端存在则拉取应用；不存在则使用自然顺序（adopt 空顺序只记录缺失基线，不创建空文件）。
      return { order: remote.kind === "found" ? remote.order : [], type: "adopt" }
    }
    if (intent.origin === "migration") {
      // v1 历史排序：云端已存在有效配置则云端优先（旧本机值留备份），确认不存在才作为迁移候选条件创建。
      if (remote.kind === "found") return { order: remote.order, type: "adopt" }
      return { etag: null, method: "create", type: "upload" }
    }
    // 首次读取前用户已主动重排：不能套用“历史排序云端优先”，相同则确认，不同进入首次并发选择。
    if (remote.kind === "found") {
      return folderOrderContentEquals(remote.order, intent.order) ? { type: "synced" } : { type: "conflict" }
    }
    return { etag: null, method: "create", type: "upload" }
  }

  if (!intent) {
    if (remote.kind === "found") {
      return folderOrderContentEquals(remote.order, record.localOrder) ? { type: "synced" } : { order: remote.order, type: "adopt" }
    }
    // 曾经存在的远端配置被删除：视为远端重置。本地 clean 则恢复自然顺序并记录缺失基线。
    return base.exists ? { order: [], type: "adopt" } : { type: "noop" }
  }

  if (remote.kind === "found") {
    // 相同语义收敛：确认相应代次已同步，不重复 PUT。
    if (folderOrderContentEquals(remote.order, intent.order)) return { type: "synced" }
    // 远端缺失与空顺序在“排序内容”比较时等价；存在性仍决定条件创建还是条件更新。
    const remoteUnchangedFromBase = base.exists
      ? folderOrderContentEquals(remote.order, base.order)
      : remote.order.length === 0
    if (remoteUnchangedFromBase) {
      // 远端相对基线未变：用刚读取的强 ETag 条件上传本机快照。
      if (!remote.strongEtag) {
        return {
          kind: "unsupported-remote",
          message: "当前服务端不支持安全更新（缺少强 ETag），本机排序已保留，待服务端支持后再同步",
          type: "error",
        }
      }
      return { etag: remote.strongEtag, method: "update", type: "upload" }
    }
    // 两端相对基线都变了且不同：保留 local，存 remote 候选，进入冲突。
    return { type: "conflict" }
  }

  // 远端缺失：本地有不同改动则冲突（不得重新迁移旧 v1 复活配置）；基线本就缺失则条件创建。
  return base.exists ? { type: "conflict" } : { etag: null, method: "create", type: "upload" }
}

// ---- 异步协调 ----

const syncChains = new Map<string, Promise<unknown>>()

// 每库串行化：刷新、重连、自动同步、前台只读拉取与冲突选择都汇入同一条链。
function enqueue<T>(cacheId: string, task: () => Promise<T>): Promise<T> {
  const previous = syncChains.get(cacheId) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  syncChains.set(cacheId, run)
  return run
}

function errorMessageOf(error: unknown) {
  return error instanceof Error ? error.message : "同步文件夹排序失败"
}

async function readRemoteDocument(store: VaultFolderOrderStore): Promise<RemoteObservation> {
  const document = await store.readDocument()
  if (!document) return { kind: "missing" }
  let parsed: FolderOrderDocument
  try {
    parsed = parseFolderOrderDocument(document.bytes)
  } catch (error) {
    return {
      kind: "unreadable",
      message: error instanceof FolderOrderDocumentError ? error.message : "远端排序配置无法解析，已保留本机顺序",
    }
  }
  return {
    changeId: parsed.changeId,
    document: parsed,
    kind: "found",
    order: parsed.order,
    // 弱 ETag 不能用于 If-Match：按没有强 ETag 处理。
    strongEtag: document.etagWeak ? null : document.etag,
  }
}

function remoteBaseOf(remote: RemoteObservation): FolderOrderSyncRecord["base"] {
  return remote.kind === "found"
    ? { changeId: remote.changeId, etag: remote.strongEtag, exists: true, order: [...remote.order] }
    : { changeId: null, etag: null, exists: false, order: [] }
}

export function syncFolderOrder(options: FolderOrderSyncOptions): Promise<FolderOrderSyncRunResult> {
  return enqueue(options.cacheId, () => syncFolderOrderOnce(options))
}

async function syncFolderOrderOnce(options: FolderOrderSyncOptions): Promise<FolderOrderSyncRunResult> {
  const { adapter, cacheId, isCancelled } = options
  const store = adapter.folderOrderStore
  if (!store) return { outcome: "skipped" }

  // 工作副本是事实来源；v1 localStorage 只在首次建立副本时作为一次性迁移输入。
  const v1Order = sanitizeFolderOrderEntries(loadFolderOrder(cacheId))
  let record = await getOrCreateFolderOrderSyncRecord(cacheId, v1Order.length > 0 ? v1Order : null)
  if (isCancelled?.()) return { outcome: "skipped" }

  let remote: RemoteObservation
  try {
    remote = await readRemoteDocument(store)
  } catch (error) {
    // 认证失效复用统一凭据失效处理，直接上抛；其余读取失败只影响排序，不阻断笔记同步。
    if (error instanceof WebDavAuthenticationError) throw error
    const unreadable = error instanceof WebDavContentTooLargeError
    const message = errorMessageOf(error)
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.error = { kind: unreadable ? "unreadable-remote" : "read", message }
    })
    return { message, outcome: "error" }
  }
  if (isCancelled?.()) return { outcome: "skipped" }

  // 配置 404 只有配合根目录存在才能视为“配置被重置”；根目录丢失或身份错误不能当作重置。
  if (remote.kind === "missing" && !options.rootVerified) {
    let rootExists: boolean
    try {
      rootExists = await store.verifyRoot()
    } catch (error) {
      if (error instanceof WebDavAuthenticationError) throw error
      const message = errorMessageOf(error)
      await updateFolderOrderSyncRecord(cacheId, (draft) => {
        draft.error = { kind: "read", message }
      })
      return { message, outcome: "error" }
    }
    if (!rootExists) {
      const message = "无法确认远端笔记库根目录，已保留本机排序"
      await updateFolderOrderSyncRecord(cacheId, (draft) => {
        draft.error = { kind: "read", message }
      })
      return { message, outcome: "error" }
    }
    // 根目录确认期间运行可能被取消：不落任何基线，保持“尚未观察过远端”。
    if (isCancelled?.()) return { outcome: "skipped" }
  }

  // 上次 PUT 结果不明：先对 changeId/order 确认这次上传是否已成功，再进入三方判定。
  if (record.attemptedUpload) {
    const attempted = record.attemptedUpload
    const confirmed = remote.kind === "found"
      && remote.changeId === attempted.changeId
      && folderOrderContentEquals(remote.order, attempted.order)
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      if (draft.attemptedUpload?.changeId !== attempted.changeId) return
      draft.attemptedUpload = null
      if (confirmed && remote.kind === "found") {
        draft.base = remoteBaseOf(remote)
        if (draft.pendingIntent?.generation === attempted.generation) draft.pendingIntent = null
        // 同代次的旧冲突随确认一并清理；同步期间新编辑刷新的冲突（代次已推进）保留。
        if (draft.conflict?.localGeneration === attempted.generation) draft.conflict = null
        draft.error = null
      }
    })
    record = (await loadFolderOrderSyncRecord(cacheId)) ?? record
  }

  const decision = decideFolderOrder(record, remote)
  return executeDecision(decision, record, remote, store, options, true)
}

async function executeDecision(
  decision: FolderOrderDecision,
  record: FolderOrderSyncRecord,
  remote: RemoteObservation,
  store: VaultFolderOrderStore,
  options: FolderOrderSyncOptions,
  allowRejudge: boolean,
): Promise<FolderOrderSyncRunResult> {
  const { cacheId } = options

  if (decision.type === "noop") {
    const generationAtDecision = record.localGeneration
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      // 无变化但上一轮留下 read error 时，用本轮成功观察到的远端状态清理；
      // 若期间产生新编辑/冲突/新错误，前提不再成立，不能替它们做确认。
      if (draft.localGeneration !== generationAtDecision) return false
      if (draft.pendingIntent || draft.conflict) return false
      if (draft.error?.kind !== "read" && draft.error?.kind !== "unreadable-remote") return false
      draft.base = remoteBaseOf(remote)
      draft.error = null
      return true
    })
    return { outcome: "noop" }
  }

  if (decision.type === "error") {
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.error = { kind: decision.kind, message: decision.message }
    })
    return { message: decision.message, outcome: "error" }
  }

  if (decision.type === "synced") {
    const intentGeneration = record.pendingIntent?.generation
    const generationAtDecision = intentGeneration ?? record.localGeneration
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.base = remoteBaseOf(remote)
      if (intentGeneration !== undefined && draft.pendingIntent?.generation === intentGeneration) {
        draft.pendingIntent = null
      }
      // 两端内容已收敛：清掉停留在决策代次的旧冲突与过期候选；
      // 同步期间新产生的编辑/冲突（代次已推进）必须保留。
      if (draft.conflict?.localGeneration === generationAtDecision) draft.conflict = null
      draft.error = null
    })
    return { outcome: "noop" }
  }

  if (decision.type === "adopt") {
    const generationAtDecision = record.localGeneration
    const { changed } = await updateFolderOrderSyncRecord(cacheId, (draft) => {
      // 决策与落盘之间用户又拖动（代次变化）：放弃本次应用，不覆盖新编辑。
      // 决策时已存在的意图（如迁移候选“云端优先”）与代次一致，由本次应用一并确认。
      if (draft.localGeneration !== generationAtDecision) return false
      draft.localOrder = [...decision.order]
      draft.base = remoteBaseOf(remote)
      if (draft.pendingIntent?.generation === generationAtDecision) draft.pendingIntent = null
      draft.conflict = null
      draft.error = null
      return true
    })
    return changed
      ? { outcome: "adopted-remote" }
      : { message: "排序在同步期间又有修改，将在下次同步处理", outcome: "pending" }
  }

  if (decision.type === "conflict") {
    const conflict = buildConflict(record, remote)
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      // 冲突时保留本机与云端候选；若决策后又出现更新的本机意图，候选以最新意图为准。
      const latestIntent = draft.pendingIntent
      draft.conflict = latestIntent && latestIntent.generation !== conflict.localGeneration
        ? { ...conflict, localGeneration: latestIntent.generation, localOrder: [...latestIntent.order] }
        : conflict
      draft.error = null
    })
    return { outcome: "conflict" }
  }

  // decision.type === "upload"
  if (!options.allowUpload) return { outcome: "pending" }
  if (options.structureUploadBlocked) {
    return { message: "目录结构操作尚未同步完成，排序上传已暂停", outcome: "pending" }
  }
  const intent = record.pendingIntent
  if (!intent) return { outcome: "noop" }
  // 写入前的取消检查：取消不发出 MKCOL/PUT，本机意图原样保留。
  if (options.isCancelled?.()) return { outcome: "skipped" }
  const changeId = createFolderOrderChangeId()
  // 序列化在落 attempted 快照之前完成协议上限校验：超限时报错并保留本机意图，
  // 不截断、不上传非法文档，也不留下从未发出的 attempted 快照。
  let body: string
  try {
    body = serializeFolderOrderDocument(remote.kind === "found" ? remote.document : null, intent.order, changeId)
  } catch (error) {
    if (error instanceof FolderOrderDocumentError) {
      await updateFolderOrderSyncRecord(cacheId, (draft) => {
        draft.error = { kind: "upload", message: error.message }
      })
      return { message: error.message, outcome: "error" }
    }
    throw error
  }
  const { changed } = await updateFolderOrderSyncRecord(cacheId, (draft) => {
    // 上传前落 attempted 快照：PUT 超时/断网可能已成功，下次先 GET 对 changeId 确认。
    if (draft.pendingIntent?.generation !== intent.generation) return false
    draft.attemptedUpload = { changeId, generation: intent.generation, order: [...intent.order] }
    return true
  })
  if (!changed) return { message: "排序在同步期间又有修改，将在下次同步处理", outcome: "pending" }
  if (options.isCancelled?.()) return { outcome: "skipped" }

  try {
    if (decision.method === "create") {
      // 首次真正写入时才创建 .swell 目录；只读刷新不创建。
      await store.ensureMetadataDirectory()
      // MKCOL 只建空目录、不改配置内容；此处取消时 PUT 不发出，attempted 快照留待下轮确认。
      if (options.isCancelled?.()) return { outcome: "skipped" }
    }
    const result = decision.method === "create"
      ? await store.createDocument(body)
      : await store.updateDocument(body, decision.etag!)
    // PUT 已发出后不再响应取消：结果可能已在服务端生效，必须按 attempted 机制确认，不假装回滚。
    return await finalizeSuccessfulUpload(store, cacheId, { changeId, generation: intent.generation, order: intent.order }, result)
  } catch (error) {
    if (error instanceof WebDavAuthenticationError) throw error
    if (error instanceof WebDavRevisionConflictError && allowRejudge) {
      // 412：最多一次读回重判定，不把旧快照直接换新 ETag 强写。
      return rejudgeAfterPreconditionFailed(store, options)
    }
    const message = errorMessageOf(error)
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.error = {
        kind: error instanceof WebDavRevisionConflictError ? "upload" : "aborted",
        message,
      }
    })
    return { message, outcome: "error" }
  }
}

// 412 后最多一次读回与重新判定；重判定仍是上传时允许用最新 ETag 再试一次，再次 412 则保留待同步。
async function rejudgeAfterPreconditionFailed(
  store: VaultFolderOrderStore,
  options: FolderOrderSyncOptions,
): Promise<FolderOrderSyncRunResult> {
  const { cacheId } = options
  let remote: RemoteObservation
  try {
    remote = await readRemoteDocument(store)
  } catch (error) {
    if (error instanceof WebDavAuthenticationError) throw error
    const message = errorMessageOf(error)
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.error = { kind: "upload", message }
    })
    return { message, outcome: "error" }
  }
  const record = await loadFolderOrderSyncRecord(cacheId)
  if (!record) return { outcome: "skipped" }
  // 重判定读回期间取消：不再二次 PUT，意图与 attempted 快照留待下轮处理。
  if (options.isCancelled?.()) return { outcome: "skipped" }
  const decision = decideFolderOrder(record, remote)
  return executeDecision(decision, record, remote, store, options, false)
}

type ConfirmedSnapshot = {
  changeId: string
  generation: number
  order: readonly string[]
}

// 上传成功后的确认：有新强 ETag 直接记账；没有则 GET 读回核对 changeId/order，
// 绝不能沿用旧 ETag 表示新的远端版本。g 上传期间用户拖到 g+1 时只更新 base，保留 g+1 待同步。
async function finalizeSuccessfulUpload(
  store: VaultFolderOrderStore,
  cacheId: string,
  snapshot: ConfirmedSnapshot,
  result: { etag: string | null; etagWeak: boolean },
): Promise<FolderOrderSyncRunResult> {
  if (result.etag && !result.etagWeak) {
    await confirmUploadedSnapshot(cacheId, snapshot, result.etag)
    return { outcome: "uploaded" }
  }
  let remote: RemoteObservation
  try {
    remote = await readRemoteDocument(store)
  } catch (error) {
    if (error instanceof WebDavAuthenticationError) throw error
    // 读回失败：上传可能已成功，attempted 快照保留，下次先 GET 对 changeId/order 确认。
    const message = errorMessageOf(error)
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.error = { kind: "aborted", message }
    })
    return { message, outcome: "error" }
  }
  if (remote.kind === "found" && remote.changeId === snapshot.changeId
    && folderOrderContentEquals(remote.order, snapshot.order)) {
    await confirmUploadedSnapshot(cacheId, snapshot, remote.strongEtag)
    return { outcome: "uploaded" }
  }
  // 读回内容与本机快照不符：PUT 未生效或已被其他设备覆盖；清掉 attempted，
  // 保留实际读回版本与未确认意图，由下一轮三方判定处理，不把“PUT 曾成功”误当作当前远端。
  await updateFolderOrderSyncRecord(cacheId, (draft) => {
    if (draft.attemptedUpload?.changeId === snapshot.changeId) draft.attemptedUpload = null
    draft.error = { kind: "upload", message: "排序上传结果未能确认，本机修改已保留，将在下次同步重新处理" }
  })
  return { message: "排序上传结果未能确认，已保留本机修改", outcome: "error" }
}

async function confirmUploadedSnapshot(cacheId: string, snapshot: ConfirmedSnapshot, etag: string | null) {
  await updateFolderOrderSyncRecord(cacheId, (draft) => {
    if (draft.attemptedUpload?.changeId === snapshot.changeId) draft.attemptedUpload = null
    draft.base = {
      changeId: snapshot.changeId,
      etag,
      exists: true,
      order: [...snapshot.order],
    }
    // 只确认本次代次：上传期间产生的新意图（g+1）继续保留待同步。
    if (draft.pendingIntent?.generation === snapshot.generation) draft.pendingIntent = null
    if (draft.conflict?.localGeneration === snapshot.generation) draft.conflict = null
    draft.error = null
  })
}

function buildConflict(record: FolderOrderSyncRecord, remote: RemoteObservation): FolderOrderConflict {
  const intent = record.pendingIntent
  return {
    localGeneration: intent?.generation ?? record.localGeneration,
    localOrder: [...(intent?.order ?? record.localOrder)],
    remoteChangeId: remote.kind === "found" ? remote.changeId : null,
    remoteEtag: remote.kind === "found" ? remote.strongEtag : null,
    remoteExists: remote.kind === "found",
    remoteOrder: remote.kind === "found" ? [...remote.order] : [],
  }
}

// 冲突选择：使用云端/使用本机都先重读云端校验；关闭提示由 UI 层处理（保留冲突不循环弹窗）。
export function resolveFolderOrderConflict(options: {
  adapter: VaultAdapter
  cacheId: string
  choice: "local" | "remote"
  // 本库还有未完成的目录结构操作时，与普通上传走一致规则：暂停“使用本机”的覆盖写入。
  structureUploadBlocked?: boolean
}): Promise<FolderOrderSyncRunResult> {
  return enqueue(options.cacheId, () => resolveFolderOrderConflictOnce(options))
}

async function resolveFolderOrderConflictOnce(options: {
  adapter: VaultAdapter
  cacheId: string
  choice: "local" | "remote"
  structureUploadBlocked?: boolean
}): Promise<FolderOrderSyncRunResult> {
  const { adapter, cacheId, choice } = options
  const store = adapter.folderOrderStore
  if (!store) return { outcome: "skipped" }
  const record = await loadFolderOrderSyncRecord(cacheId)
  const conflict = record?.conflict
  if (!record || !conflict) return { outcome: "noop" }

  let remote: RemoteObservation
  try {
    remote = await readRemoteDocument(store)
  } catch (error) {
    if (error instanceof WebDavAuthenticationError) throw error
    const message = errorMessageOf(error)
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.error = { kind: "read", message }
    })
    return { message, outcome: "error" }
  }

  // 损坏/未知版本/超限的远端不是“空顺序”：两种选择都只读报错，保留 localOrder、
  // pendingIntent 和冲突，绝不把 unreadable 当成可应用或可覆盖的对象。
  if (remote.kind === "unreadable") {
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.error = { kind: "unreadable-remote", message: remote.message }
    })
    return { message: remote.message, outcome: "error" }
  }

  // 配置 404 只有配合根目录存在才能视为“配置被重置”；根目录消失或身份错误时
  // 保留全部本机状态，既不应用空顺序，也不在错误的远端位置条件创建。
  if (remote.kind === "missing") {
    let rootExists: boolean
    try {
      rootExists = await store.verifyRoot()
    } catch (error) {
      if (error instanceof WebDavAuthenticationError) throw error
      const message = errorMessageOf(error)
      await updateFolderOrderSyncRecord(cacheId, (draft) => {
        draft.error = { kind: "read", message }
      })
      return { message, outcome: "error" }
    }
    if (!rootExists) {
      const message = "无法确认远端笔记库根目录，已保留本机排序与冲突"
      await updateFolderOrderSyncRecord(cacheId, (draft) => {
        draft.error = { kind: "read", message }
      })
      return { message, outcome: "error" }
    }
  }

  if (choice === "remote") {
    const order = remote.kind === "found" ? remote.order : []
    // 用户选择期间若又拖动：不得把新本地编辑无提示丢掉，用最新候选刷新冲突并继续保留。
    let appliedRemote = false
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      if (!draft.conflict) return false
      if (draft.localGeneration !== conflict.localGeneration) {
        const latestIntent = draft.pendingIntent
        draft.conflict = {
          localGeneration: latestIntent?.generation ?? draft.localGeneration,
          localOrder: [...(latestIntent?.order ?? draft.localOrder)],
          remoteChangeId: remote.kind === "found" ? remote.changeId : null,
          remoteEtag: remote.kind === "found" ? remote.strongEtag : null,
          remoteExists: remote.kind === "found",
          remoteOrder: remote.kind === "found" ? [...remote.order] : [],
        }
        return true
      }
      appliedRemote = true
      draft.localOrder = [...order]
      draft.base = remoteBaseOf(remote)
      draft.pendingIntent = null
      draft.conflict = null
      draft.error = null
      return true
    })
    return appliedRemote ? { outcome: "adopted-remote" } : { outcome: "conflict" }
  }

  // 使用本机：把用户明确选择的当前本机候选以最新远端状态条件写入。
  // 结构阻断与普通上传一致：目录结构操作未完成时暂停覆盖，冲突保留。
  if (options.structureUploadBlocked) {
    return { message: "目录结构操作尚未同步完成，排序上传已暂停", outcome: "pending" }
  }
  const localOrder = record.pendingIntent?.order ?? record.localOrder
  const generation = record.pendingIntent?.generation ?? record.localGeneration
  const changeId = createFolderOrderChangeId()
  // 序列化在落 attempted 快照之前完成协议上限校验：超限时报错并保留冲突与意图，
  // 不截断、不上传非法文档，也不留下从未发出的 attempted 快照。
  let body: string
  try {
    body = remote.kind === "found"
      ? serializeFolderOrderDocument(remote.document, localOrder, changeId)
      : serializeFolderOrderDocument(null, localOrder, changeId)
  } catch (error) {
    if (error instanceof FolderOrderDocumentError) {
      await updateFolderOrderSyncRecord(cacheId, (draft) => {
        draft.error = { kind: "upload", message: error.message }
      })
      return { message: error.message, outcome: "error" }
    }
    throw error
  }
  await updateFolderOrderSyncRecord(cacheId, (draft) => {
    draft.attemptedUpload = { changeId, generation, order: [...localOrder] }
  })
  try {
    const result = remote.kind === "found"
      ? await (async () => {
          if (!remote.strongEtag) {
            throw new FolderOrderResolutionUnsupportedError()
          }
          return store.updateDocument(body, remote.strongEtag)
        })()
      : await (async () => {
          await store.ensureMetadataDirectory()
          return store.createDocument(body)
        })()
    return finalizeSuccessfulUpload(store, cacheId, { changeId, generation, order: localOrder }, result)
  } catch (error) {
    if (error instanceof WebDavAuthenticationError) throw error
    if (error instanceof FolderOrderResolutionUnsupportedError) {
      const message = "当前服务端不支持安全更新（缺少强 ETag），冲突已保留，待服务端支持后再处理"
      await updateFolderOrderSyncRecord(cacheId, (draft) => {
        if (draft.attemptedUpload?.changeId === changeId) draft.attemptedUpload = null
        draft.error = { kind: "unsupported-remote", message }
      })
      return { message, outcome: "error" }
    }
    if (error instanceof WebDavRevisionConflictError) {
      // 再次 412：保留冲突，用最新读回刷新云端候选，不无限自动覆盖后来版本。
      return refreshConflictAfterPreconditionFailed(store, cacheId, changeId)
    }
    const message = errorMessageOf(error)
    await updateFolderOrderSyncRecord(cacheId, (draft) => {
      draft.error = { kind: "aborted", message }
    })
    return { message, outcome: "error" }
  }
}

async function refreshConflictAfterPreconditionFailed(
  store: VaultFolderOrderStore,
  cacheId: string,
  changeId: string,
): Promise<FolderOrderSyncRunResult> {
  let freshRemote: RemoteObservation
  try {
    freshRemote = await readRemoteDocument(store)
  } catch (error) {
    if (error instanceof WebDavAuthenticationError) throw error
    const unreadable = error instanceof WebDavContentTooLargeError
    const message = errorMessageOf(error)
    await keepConflictAfterFailedRefresh(cacheId, changeId, unreadable ? "unreadable-remote" : "read", message)
    return { message, outcome: "error" }
  }

  if (freshRemote.kind === "unreadable") {
    await keepConflictAfterFailedRefresh(cacheId, changeId, "unreadable-remote", freshRemote.message)
    return { message: freshRemote.message, outcome: "error" }
  }

  if (freshRemote.kind === "missing") {
    let rootExists: boolean
    try {
      rootExists = await store.verifyRoot()
    } catch (error) {
      if (error instanceof WebDavAuthenticationError) throw error
      const message = errorMessageOf(error)
      await keepConflictAfterFailedRefresh(cacheId, changeId, "read", message)
      return { message, outcome: "error" }
    }
    if (!rootExists) {
      const message = "无法确认远端笔记库根目录，已保留本机排序与冲突"
      await keepConflictAfterFailedRefresh(cacheId, changeId, "read", message)
      return { message, outcome: "error" }
    }
  }

  await updateFolderOrderSyncRecord(cacheId, (draft) => {
    if (draft.attemptedUpload?.changeId === changeId) draft.attemptedUpload = null
    if (!draft.conflict) return
    draft.conflict = {
      ...draft.conflict,
      remoteChangeId: freshRemote.kind === "found" ? freshRemote.changeId : null,
      remoteEtag: freshRemote.kind === "found" ? freshRemote.strongEtag : null,
      remoteExists: freshRemote.kind === "found",
      remoteOrder: freshRemote.kind === "found" ? [...freshRemote.order] : [],
    }
    draft.error = null
  })
  return { outcome: "conflict" }
}

async function keepConflictAfterFailedRefresh(
  cacheId: string,
  changeId: string,
  kind: FolderOrderSyncErrorKind,
  message: string,
) {
  await updateFolderOrderSyncRecord(cacheId, (draft) => {
    if (draft.attemptedUpload?.changeId === changeId) draft.attemptedUpload = null
    // 412 后读回不能证明远端候选合法时，保留原冲突候选，避免把损坏或根目录异常误报成云端删除。
    draft.error = { kind, message }
  })
}

class FolderOrderResolutionUnsupportedError extends Error {
  constructor() {
    super("缺少强 ETag")
    this.name = "FolderOrderResolutionUnsupportedError"
  }
}
