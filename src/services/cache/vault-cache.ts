import type { Note } from "@/types/note"
import type { VaultSourceKind } from "@/services/vault/vault-adapter"
import type { TrashEntry } from "@/services/trash/trash-entry"

const DATABASE_NAME = "swell-note-vault-cache"
const DATABASE_VERSION = 3
const VAULT_STORE = "vaults"
const SETTINGS_STORE = "settings"
const ATTACHMENT_STORE = "attachments"
const DOCUMENT_STORE = "documents"
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

export type VaultNoteDocument = {
  baseContent?: string
  cacheId: string
  content: string
  frontmatter?: Record<string, string | string[]>
  key: string
  noteId: string
  outgoingLinks?: string[]
  path?: string
  tags?: string[]
  title: string
}

type LoadVaultCacheOptions = {
  hydrate?: "active" | "all"
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
  const transaction = database.transaction([VAULT_STORE, SETTINGS_STORE, DOCUMENT_STORE], "readwrite")
  const documentStore = transaction.objectStore(DOCUMENT_STORE)
  const validDocumentKeys = new Set(snapshot.notes.map((note) => documentKey(snapshot.id, note.id)))
  const existingDocumentKeys = documentStore.index("cacheId").getAllKeys(snapshot.id)
  existingDocumentKeys.onsuccess = () => {
    for (const key of existingDocumentKeys.result) {
      if (typeof key === "string" && !validDocumentKeys.has(key)) documentStore.delete(key)
    }
  }
  const metadataNotes = snapshot.notes.map((note) => {
    const key = documentKey(snapshot.id, note.id)
    if (note.contentLoaded) {
      documentStore.put(toVaultNoteDocument(snapshot.id, note))
    } else if (!note.contentCached) {
      // “仅目录”隐私模式会显式清除此标记，此时同步删除旧正文，不能只改元数据。
      documentStore.delete(key)
    }
    return toMetadataNote(note, Boolean(note.contentLoaded || note.contentCached))
  })
  transaction.objectStore(VAULT_STORE).put({ ...snapshot, notes: metadataNotes })
  transaction.objectStore(SETTINGS_STORE).put({ key: LAST_CACHE_KEY, value: snapshot.id })
  await transactionDone(transaction)
  database.close()
}

export async function loadVaultCache(id: string, options: LoadVaultCacheOptions = {}) {
  const database = await openDatabase()
  const transaction = database.transaction([VAULT_STORE, DOCUMENT_STORE], "readonly")
  const [snapshot, documents] = await Promise.all([
    requestResult<VaultCacheSnapshot | undefined>(transaction.objectStore(VAULT_STORE).get(id)),
    requestResult<VaultNoteDocument[]>(transaction.objectStore(DOCUMENT_STORE).index("cacheId").getAll(id)),
  ])
  database.close()
  if (!snapshot) return null

  // v2 快照把正文直接放在 notes 中；首次读取后原样交给 v3 保存逻辑完成无损迁移。
  if (snapshot.notes.some((note) => note.contentLoaded && note.content)) {
    await saveVaultCache(snapshot)
    return loadVaultCache(id, options)
  }

  const documentsByNoteId = new Map(documents.map((document) => [document.noteId, document]))
  const hydrateAll = options.hydrate !== "active"
  return {
    ...snapshot,
    notes: snapshot.notes.map((note) => {
      const document = documentsByNoteId.get(note.id)
      const unsynced = note.source === "webdav"
        && (note.syncStatus === "modified" || note.syncStatus === "conflict" || Boolean(note.pendingOperation))
      return document && (hydrateAll || note.id === snapshot.activeNoteId || unsynced)
        ? hydrateNoteFromCachedDocument(note, document)
        : { ...note, contentCached: Boolean(document), contentLoaded: false }
    }),
  }
}

export async function loadLastVaultCache(options: LoadVaultCacheOptions = {}) {
  const database = await openDatabase()
  const setting = await requestResult<{ key: string; value: string } | undefined>(
    database.transaction(SETTINGS_STORE, "readonly").objectStore(SETTINGS_STORE).get(LAST_CACHE_KEY),
  )
  database.close()
  return setting ? loadVaultCache(setting.value, options) : null
}

export async function loadCachedNoteDocument(cacheId: string, noteId: string) {
  const database = await openDatabase()
  const document = await requestResult<VaultNoteDocument | undefined>(
    database.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE).get(documentKey(cacheId, noteId)),
  )
  database.close()
  return document ?? null
}

export async function listCachedNoteDocuments(cacheId: string) {
  const database = await openDatabase()
  const documents = await requestResult<VaultNoteDocument[]>(
    database.transaction(DOCUMENT_STORE, "readonly").objectStore(DOCUMENT_STORE).index("cacheId").getAll(cacheId),
  )
  database.close()
  return documents
}

export async function cacheVaultNoteDocuments(
  cacheId: string,
  notes: Array<Pick<Note, "baseContent" | "content" | "frontmatter" | "id" | "outgoingLinks" | "remotePath" | "tags" | "title">>,
) {
  if (notes.length === 0) return
  const database = await openDatabase()
  const transaction = database.transaction(DOCUMENT_STORE, "readwrite")
  const store = transaction.objectStore(DOCUMENT_STORE)
  for (const note of notes) store.put(toVaultNoteDocument(cacheId, note))
  await transactionDone(transaction)
  database.close()
}

export async function searchCachedNoteDocuments(cacheId: string, query: string, limit = 5_000) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []
  const documents = await listCachedNoteDocuments(cacheId)
  const paths: string[] = []
  for (const document of documents) {
    const haystack = `${document.title} ${document.content} ${(document.tags ?? []).join(" ")}`.toLocaleLowerCase()
    if (haystack.includes(normalizedQuery) && document.path) paths.push(document.path)
    if (paths.length >= limit) break
  }
  return paths
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
  const transaction = database.transaction([VAULT_STORE, ATTACHMENT_STORE, DOCUMENT_STORE, SETTINGS_STORE], "readwrite")
  const done = transactionDone(transaction)
  transaction.objectStore(VAULT_STORE).delete(id)
  const attachmentStore = transaction.objectStore(ATTACHMENT_STORE)
  const documentStore = transaction.objectStore(DOCUMENT_STORE)
  const settingsStore = transaction.objectStore(SETTINGS_STORE)
  // 两个读取同时发起，避免串行 await 之间事务自动提交。
  const [lastCache, attachmentKeys, documentKeys] = await Promise.all([
    requestResult<{ key: string; value: string } | undefined>(settingsStore.get(LAST_CACHE_KEY)),
    requestResult<IDBValidKey[]>(attachmentStore.index("cacheId").getAllKeys(id)),
    requestResult<IDBValidKey[]>(documentStore.index("cacheId").getAllKeys(id)),
  ])
  // 指针若仍指向被删缓存，下次启动会读到空快照并跳过其余现存缓存，因此要一并清理。
  if (lastCache?.value === id) settingsStore.delete(LAST_CACHE_KEY)
  for (const key of attachmentKeys) attachmentStore.delete(key)
  for (const key of documentKeys) documentStore.delete(key)
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
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        const store = database.createObjectStore(DOCUMENT_STORE, { keyPath: "key" })
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

function documentKey(cacheId: string, noteId: string) {
  return `${cacheId}\u0000${noteId}`
}

function toVaultNoteDocument(
  cacheId: string,
  note: Pick<Note, "baseContent" | "content" | "frontmatter" | "id" | "outgoingLinks" | "remotePath" | "tags" | "title">,
): VaultNoteDocument {
  return {
    baseContent: note.baseContent,
    cacheId,
    content: note.content,
    frontmatter: note.frontmatter,
    key: documentKey(cacheId, note.id),
    noteId: note.id,
    outgoingLinks: note.outgoingLinks,
    path: note.remotePath,
    tags: note.tags,
    title: note.title,
  }
}

function toMetadataNote(note: Note, contentCached: boolean): Note {
  return {
    ...note,
    baseContent: undefined,
    content: "",
    contentCached,
    contentLoaded: false,
    searchText: undefined,
  }
}

export function hydrateNoteFromCachedDocument(note: Note, document: VaultNoteDocument): Note {
  return {
    ...note,
    baseContent: document.baseContent,
    content: document.content,
    contentCached: true,
    contentLoaded: true,
    frontmatter: document.frontmatter ?? note.frontmatter,
    outgoingLinks: document.outgoingLinks ?? note.outgoingLinks,
    searchText: `${document.content} ${(document.tags ?? []).join(" ")}`.toLocaleLowerCase(),
    tags: document.tags ?? note.tags,
  }
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
