// .swell/folder-order.json 远端配置协议：schema、校验、语义比较、可见子集重排。
// 设计依据 docs/folder-order-webdav-plan-2026-09-14.md，关键约束：
// - 只保存相对笔记库根目录的顶层目录名，不写绝对路径/库名/凭据；
// - 大小与条数有限，读取按实际字节数执行，不能只信 Content-Length；
// - 同一 schemaVersion 的未知字段保留写回；未知新版本/非法内容只读报错，不覆盖远端。

export const FOLDER_ORDER_SCHEMA_VERSION = 1
export const FOLDER_ORDER_MAX_BYTES = 256 * 1024
export const FOLDER_ORDER_MAX_ITEMS = 5_000
export const FOLDER_ORDER_MAX_ITEM_CHARS = 1_024

export type FolderOrderDocument = {
  schemaVersion: number
  changeId: string
  order: string[]
  // 同一 schemaVersion 的未知字段原样保留，写回时继续携带。
  [extra: string]: unknown
}

export type FolderOrderDocumentErrorReason =
  | "invalid-json"
  | "unknown-version"
  | "invalid-shape"
  | "too-large"

export class FolderOrderDocumentError extends Error {
  readonly reason: FolderOrderDocumentErrorReason

  constructor(reason: FolderOrderDocumentErrorReason, message: string) {
    super(message)
    this.name = "FolderOrderDocumentError"
    this.reason = reason
  }
}

// changeId 只用于确认“结果不明的上传是否已成功”，不是版本排序依据。
export function createFolderOrderChangeId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  // 非安全上下文（如无 randomUUID 的旧 WebView）用 getRandomValues 兜底，仍保证碰撞概率可忽略。
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`
  }
  throw new Error("当前环境不支持安全随机数，无法生成排序变更标识")
}

// 顶层目录名的协议约束：拒绝绝对路径、路径分隔符、“.”/“..”和 NUL；
// 收到的 order 绝不能直接拿去执行文件读写。
export function isValidFolderOrderEntry(name: unknown): name is string {
  if (typeof name !== "string") return false
  if (name.length === 0 || name.length > FOLDER_ORDER_MAX_ITEM_CHARS) return false
  if (name === "." || name === "..") return false
  if (name.includes("\u0000")) return false
  if (name.includes("/") || name.includes("\\")) return false
  if (/^[a-zA-Z]:/.test(name)) return false
  return true
}

// 本地输入（v1 历史值、拖动结果）的宽松清洗：丢弃非法项并稳定去重，不抛错。
export function sanitizeFolderOrderEntries(paths: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!isValidFolderOrderEntry(path) || seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

// 解析远端配置字节。严格校验：任何结构/路径/大小违规都抛 FolderOrderDocumentError，
// 调用方据此进入“配置只读报错、保留本机状态”的分支，而不是猜测着修复远端内容。
export function parseFolderOrderDocument(bytes: Uint8Array): FolderOrderDocument {
  if (bytes.length > FOLDER_ORDER_MAX_BYTES) {
    throw new FolderOrderDocumentError("too-large", "远端排序配置超出大小上限，已保留本机顺序")
  }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new FolderOrderDocumentError("invalid-json", "远端排序配置不是有效的 UTF-8 文本")
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new FolderOrderDocumentError("invalid-json", "远端排序配置不是有效的 JSON")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FolderOrderDocumentError("invalid-shape", "远端排序配置结构无效")
  }
  const document = value as Record<string, unknown>
  if (document.schemaVersion !== FOLDER_ORDER_SCHEMA_VERSION) {
    if (typeof document.schemaVersion === "number" && document.schemaVersion > FOLDER_ORDER_SCHEMA_VERSION) {
      // 未知新版本：保留本机状态，只读报错，绝不自动覆盖远端。
      throw new FolderOrderDocumentError("unknown-version", "远端排序配置由更新版本的应用写入，请升级后再同步")
    }
    throw new FolderOrderDocumentError("invalid-shape", "远端排序配置缺少有效的版本号")
  }
  if (typeof document.changeId !== "string" || document.changeId.length === 0) {
    throw new FolderOrderDocumentError("invalid-shape", "远端排序配置缺少有效的变更标识")
  }
  if (!Array.isArray(document.order)) {
    throw new FolderOrderDocumentError("invalid-shape", "远端排序配置缺少有效的顺序列表")
  }
  if (document.order.length > FOLDER_ORDER_MAX_ITEMS) {
    throw new FolderOrderDocumentError("too-large", "远端排序配置超出条目上限，已保留本机顺序")
  }
  const seen = new Set<string>()
  const order: string[] = []
  for (const entry of document.order) {
    if (!isValidFolderOrderEntry(entry)) {
      throw new FolderOrderDocumentError("invalid-shape", "远端排序配置包含非法的目录名")
    }
    // 去重必须稳定：保留首次出现的位置。
    if (seen.has(entry)) continue
    seen.add(entry)
    order.push(entry)
  }
  return { ...document, changeId: document.changeId, order, schemaVersion: FOLDER_ORDER_SCHEMA_VERSION }
}

// 序列化待上传配置：同版未知字段随原文保留，已知的三个字段以本次快照为准。
// 上传前统一校验协议上限（与读取侧 parseFolderOrderDocument 同一套约束）：
// 超限抛 FolderOrderDocumentError，调用方保留本机意图并报错，不截断、不上传非法文档。
export function serializeFolderOrderDocument(
  base: FolderOrderDocument | null,
  order: readonly string[],
  changeId: string,
): string {
  if (order.length > FOLDER_ORDER_MAX_ITEMS) {
    throw new FolderOrderDocumentError("too-large", "本机排序超出条目上限（5000 项），已保留本机修改，请减少顶层目录后再同步")
  }
  for (const entry of order) {
    if (!isValidFolderOrderEntry(entry)) {
      throw new FolderOrderDocumentError("invalid-shape", "本机排序包含非法或过长的目录名，已保留本机修改，请调整后再同步")
    }
  }
  const extras: Record<string, unknown> = { ...(base ?? {}) }
  delete extras.schemaVersion
  delete extras.changeId
  delete extras.order
  const text = JSON.stringify({
    ...extras,
    changeId,
    order: [...order],
    schemaVersion: FOLDER_ORDER_SCHEMA_VERSION,
  })
  // 上限按最终 UTF-8 字节计算，同版未知字段也计入，不能只看 order 的条目数。
  if (new TextEncoder().encode(text).length > FOLDER_ORDER_MAX_BYTES) {
    throw new FolderOrderDocumentError("too-large", "排序配置超出大小上限（256 KiB），已保留本机修改")
  }
  return text
}

// 顺序内容相等：语义比较只按顺序内容，不因 changeId/ETag 不同制造内容冲突。
export function folderOrderContentEquals(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

// 远端缺失与空顺序在“排序内容”比较时等价（存在性仍决定条件创建还是条件更新）。
export function folderOrderSlotEquals(left: readonly string[] | null, right: readonly string[] | null) {
  return folderOrderContentEquals(left ?? [], right ?? [])
}

// 可见子集槽位重排：本机拖动只替换完整配置中这些可见成员所在的槽位，
// 保留不可见成员（未扫描到的目录）的相对位置与槽位。
// 输出过滤到可见成员后必须与用户提交的 visibleOrderAfter 完全一致：
// 可见集合里的新成员按用户放置的位置插入（其可见顺序中下一个已有成员的槽位前，
// 后面没有已有成员时追加到末尾），不能一律追加到最后而丢掉用户给定的相对位置。
// 例：完整配置 [A, X, B]，本机只见 [A, B]，拖成 [B, A] 后完整配置为 [B, X, A]。
export function mergeVisibleFolderOrder(
  fullOrder: readonly string[],
  visibleOrderAfter: readonly string[],
): string[] {
  const visibleAfter = [...new Set(visibleOrderAfter)]
  const visibleSet = new Set(visibleAfter)
  const fullSet = new Set(fullOrder)
  // 第一步：已有可见成员按新顺序回填各自槽位，不可见成员原地不动。
  const fillQueue = visibleAfter.filter((path) => fullSet.has(path))
  let fillIndex = 0
  const merged = fullOrder.map((path) => (visibleSet.has(path) ? fillQueue[fillIndex++] : path))
  // 第二步：新成员插入到“可见顺序中下一个已有成员”的槽位前；没有后继已有成员则追加。
  // 逐个处理时锚点在 merged 中的当前位置查询，前一个新成员的插入不影响后续相对顺序。
  for (let index = 0; index < visibleAfter.length; index += 1) {
    const path = visibleAfter[index]
    if (fullSet.has(path)) continue
    const anchor = visibleAfter.slice(index + 1).find((candidate) => fullSet.has(candidate))
    const anchorIndex = anchor ? merged.indexOf(anchor) : -1
    if (anchorIndex >= 0) merged.splice(anchorIndex, 0, path)
    else merged.push(path)
  }
  return merged
}
