import type { Note } from "@/types/note"
import type { VaultSourceKind } from "@/services/vault/vault-adapter"
import type { TrashEntry } from "@/services/trash/trash-entry"

const DATABASE_NAME = "swell-note-vault-cache"
const DATABASE_VERSION = 2
const VAULT_STORE = "vaults"
const SETTINGS_STORE = "settings"
const ATTACHMENT_STORE = "attachments"
const LAST_CACHE_KEY = "last-cache"

export type VaultCacheSnapshot = {
  activeNoteId: string
  directories?: string[]
  pendingDirectories?: string[]
  id: string
  label: string
  lastSyncedAt?: number
  notes: Note[]
  savedAt: number
  sourceKind: VaultSourceKind
  trash?: TrashEntry[]
}

export type VaultCacheSummary = Pick<
  VaultCacheSnapshot,
  "activeNoteId" | "id" | "label" | "lastSyncedAt" | "savedAt" | "sourceKind"
> & { noteCount: number }

export type VaultAttachmentCacheEntry = {
  cacheId: string
  createdAt: number
  data: ArrayBuffer
  error?: string
  key: string
  mimeType?: string
  noteId: string
  path: string
  status: "failed" | "pending" | "synced"
}

export async function queueVaultAttachment(
  entry: Omit<VaultAttachmentCacheEntry, "createdAt" | "key" | "status">,
) {
  const database = await openDatabase()
  const value: VaultAttachmentCacheEntry = {
    ...entry,
    createdAt: Date.now(),
    key: attachmentKey(entry.cacheId, entry.path),
    status: "pending",
  }
  const transaction = database.transaction(ATTACHMENT_STORE, "readwrite")
  try {
    transaction.objectStore(ATTACHMENT_STORE).add(value)
    await transactionDone(transaction)
    return value
  } catch (error) {
    if (transaction.error?.name === "ConstraintError" || (error instanceof DOMException && error.name === "ConstraintError")) {
      throw new Error(`文件已存在：${entry.path}`)
    }
    throw error
  } finally {
    database.close()
  }
}

export async function cacheSyncedVaultAttachment(
  entry: Omit<VaultAttachmentCacheEntry, "createdAt" | "key" | "status">,
) {
  const database = await openDatabase()
  const value: VaultAttachmentCacheEntry = {
    ...entry,
    createdAt: Date.now(),
    key: attachmentKey(entry.cacheId, entry.path),
    status: "synced",
  }
  const transaction = database.transaction(ATTACHMENT_STORE, "readwrite")
  // 远程附件按 cacheId + path 唯一；再次在线读取时覆盖旧副本，保证离线缓存与云端一致。
  transaction.objectStore(ATTACHMENT_STORE).put(value)
  await transactionDone(transaction)
  database.close()
  return value
}

export async function loadVaultAttachment(cacheId: string, path: string) {
  const database = await openDatabase()
  const entry = await requestResult<VaultAttachmentCacheEntry | undefined>(
    database.transaction(ATTACHMENT_STORE, "readonly").objectStore(ATTACHMENT_STORE).get(attachmentKey(cacheId, path)),
  )
  database.close()
  return entry ?? null
}

export async function listPendingVaultAttachments(cacheId: string) {
  const database = await openDatabase()
  const entries = await requestResult<VaultAttachmentCacheEntry[]>(
    database.transaction(ATTACHMENT_STORE, "readonly").objectStore(ATTACHMENT_STORE).index("cacheId").getAll(cacheId),
  )
  database.close()
  return entries.filter((entry) => entry.status !== "synced").sort((left, right) => left.createdAt - right.createdAt)
}

export async function listVaultAttachments(cacheId: string) {
  const database = await openDatabase()
  const entries = await requestResult<VaultAttachmentCacheEntry[]>(
    database.transaction(ATTACHMENT_STORE, "readonly").objectStore(ATTACHMENT_STORE).index("cacheId").getAll(cacheId),
  )
  database.close()
  return entries.sort((left, right) => left.createdAt - right.createdAt)
}

export async function deleteVaultAttachments(keys: readonly string[]) {
  if (keys.length === 0) return
  const database = await openDatabase()
  const transaction = database.transaction(ATTACHMENT_STORE, "readwrite")
  for (const key of keys) transaction.objectStore(ATTACHMENT_STORE).delete(key)
  await transactionDone(transaction)
  database.close()
}

export async function deleteSyncedVaultAttachments(cacheId: string) {
  const database = await openDatabase()
  const transaction = database.transaction(ATTACHMENT_STORE, "readwrite")
  const store = transaction.objectStore(ATTACHMENT_STORE)
  const entries = await requestResult<VaultAttachmentCacheEntry[]>(store.index("cacheId").getAll(cacheId))
  for (const entry of entries) {
    // 待上传附件属于未同步工作副本，隐私清理不能以数据丢失为代价。
    if (entry.status === "synced") store.delete(entry.key)
  }
  await transactionDone(transaction)
  database.close()
}

export async function updateVaultAttachmentStatus(
  entry: VaultAttachmentCacheEntry,
  status: VaultAttachmentCacheEntry["status"],
  error?: string,
) {
  const database = await openDatabase()
  const transaction = database.transaction(ATTACHMENT_STORE, "readwrite")
  transaction.objectStore(ATTACHMENT_STORE).put({ ...entry, error, status })
  await transactionDone(transaction)
  database.close()
}

export async function discardPendingVaultAttachments(cacheId: string, noteIds: ReadonlySet<string>) {
  const database = await openDatabase()
  const transaction = database.transaction(ATTACHMENT_STORE, "readwrite")
  const done = transactionDone(transaction)
  const store = transaction.objectStore(ATTACHMENT_STORE)
  const entries = await requestResult<VaultAttachmentCacheEntry[]>(store.index("cacheId").getAll(cacheId))
  for (const entry of entries) {
    if (entry.status !== "synced" && noteIds.has(entry.noteId)) store.delete(entry.key)
  }
  await done
  database.close()
}

export async function remapVaultAttachmentNoteId(cacheId: string, previousNoteId: string, nextNoteId: string) {
  if (previousNoteId === nextNoteId) return
  const database = await openDatabase()
  const transaction = database.transaction(ATTACHMENT_STORE, "readwrite")
  const done = transactionDone(transaction)
  const store = transaction.objectStore(ATTACHMENT_STORE)
  const entries = await requestResult<VaultAttachmentCacheEntry[]>(store.index("cacheId").getAll(cacheId))
  for (const entry of entries) {
    if (entry.noteId === previousNoteId && entry.status !== "synced") store.put({ ...entry, noteId: nextNoteId })
  }
  await done
  database.close()
}

export async function createVaultCacheId(identity: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function saveVaultCache(snapshot: VaultCacheSnapshot) {
  const database = await openDatabase()
  const transaction = database.transaction([VAULT_STORE, SETTINGS_STORE], "readwrite")
  transaction.objectStore(VAULT_STORE).put(snapshot)
  transaction.objectStore(SETTINGS_STORE).put({ key: LAST_CACHE_KEY, value: snapshot.id })
  await transactionDone(transaction)
  database.close()
}

export async function loadVaultCache(id: string) {
  const database = await openDatabase()
  const snapshot = await requestResult<VaultCacheSnapshot | undefined>(
    database.transaction(VAULT_STORE, "readonly").objectStore(VAULT_STORE).get(id),
  )
  database.close()
  return snapshot ?? null
}

export async function loadLastVaultCache() {
  const database = await openDatabase()
  const setting = await requestResult<{ key: string; value: string } | undefined>(
    database.transaction(SETTINGS_STORE, "readonly").objectStore(SETTINGS_STORE).get(LAST_CACHE_KEY),
  )
  database.close()
  return setting ? loadVaultCache(setting.value) : null
}

export async function listVaultCaches(): Promise<VaultCacheSummary[]> {
  const database = await openDatabase()
  const snapshots = await requestResult<VaultCacheSnapshot[]>(
    database.transaction(VAULT_STORE, "readonly").objectStore(VAULT_STORE).getAll(),
  )
  database.close()
  return snapshots
    .map(({ activeNoteId, id, label, lastSyncedAt, notes, savedAt, sourceKind }) => ({
      activeNoteId,
      id,
      label,
      lastSyncedAt,
      noteCount: notes.length,
      savedAt,
      sourceKind,
    }))
    .sort((left, right) => right.savedAt - left.savedAt)
}

export async function deleteVaultCache(id: string) {
  const database = await openDatabase()
  const transaction = database.transaction([VAULT_STORE, ATTACHMENT_STORE, SETTINGS_STORE], "readwrite")
  const done = transactionDone(transaction)
  transaction.objectStore(VAULT_STORE).delete(id)
  const attachmentStore = transaction.objectStore(ATTACHMENT_STORE)
  const settingsStore = transaction.objectStore(SETTINGS_STORE)
  // 两个读取同时发起，避免串行 await 之间事务自动提交。
  const [lastCache, attachmentKeys] = await Promise.all([
    requestResult<{ key: string; value: string } | undefined>(settingsStore.get(LAST_CACHE_KEY)),
    requestResult<IDBValidKey[]>(attachmentStore.index("cacheId").getAllKeys(id)),
  ])
  // 指针若仍指向被删缓存，下次启动会读到空快照并跳过其余现存缓存，因此要一并清理。
  if (lastCache?.value === id) settingsStore.delete(LAST_CACHE_KEY)
  for (const key of attachmentKeys) attachmentStore.delete(key)
  await done
  database.close()
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(VAULT_STORE)) {
        database.createObjectStore(VAULT_STORE, { keyPath: "id" })
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: "key" })
      }
      if (!database.objectStoreNames.contains(ATTACHMENT_STORE)) {
        const store = database.createObjectStore(ATTACHMENT_STORE, { keyPath: "key" })
        store.createIndex("cacheId", "cacheId")
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("打开笔记缓存失败"))
  })
}

function attachmentKey(cacheId: string, path: string) {
  return `${cacheId}\u0000${path}`
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("读取笔记缓存失败"))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error("保存笔记缓存失败"))
    transaction.onerror = () => reject(transaction.error ?? new Error("保存笔记缓存失败"))
  })
}
