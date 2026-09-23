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
  pendingDirectoryMoves?: PendingWebDavDirectoryMove[]
  id: string
  label: string
  lastSyncedAt?: number
  notes: Note[]
  savedAt: number
  sourceKind: VaultSourceKind
  trash?: TrashEntry[]
}

export type PendingWebDavDirectoryMove = {
  id: string
  // MOVE 已远端成功但子文件版本尚未核对时保留该阶段；重启后只做核对，不重复移动目录。
  moved?: boolean
  sourceFolder: string
  targetFolder: string
}

type SaveVaultCacheOptions = {
  updateLastCache?: boolean
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

export type VaultDirectoryNoteCheckpoint = Pick<Note, "id"> & Partial<Pick<Note, "revision" | "syncError" | "syncStatus">>

export type VaultNoteQueueCheckpoint = {
  note: Note
  type: "deleted" | "failed" | "moved" | "synced"
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

export async function remapVaultAttachmentsForDirectory({
  cacheId,
  noteIds,
  sourceDirectory,
  targetDirectory,
}: {
  cacheId: string
  noteIds: ReadonlyMap<string, string>
  sourceDirectory: string
  targetDirectory: string
}) {
  const database = await openDatabase()
  const transaction = database.transaction(ATTACHMENT_STORE, "readwrite")
  const done = transactionDone(transaction)
  const store = transaction.objectStore(ATTACHMENT_STORE)
  const entries = await requestResult<VaultAttachmentCacheEntry[]>(store.index("cacheId").getAll(cacheId))
  for (const entry of entries) {
    const path = entry.path === sourceDirectory || entry.path.startsWith(`${sourceDirectory}/`)
      ? `${targetDirectory}${entry.path.slice(sourceDirectory.length)}`
      : entry.path
    const noteId = noteIds.get(entry.noteId) ?? entry.noteId
    const key = attachmentKey(cacheId, path)
    if (key === entry.key && noteId === entry.noteId) continue
    // key 由路径组成，先删旧记录再写新记录，目录 MOVE 后缓存和待上传附件都只指向新路径。
    store.delete(entry.key)
    store.put({ ...entry, key, noteId, path })
  }
  await done
  database.close()
}

export async function remapCachedVaultDocumentsForDirectory({
  cacheId,
  noteIds,
  sourceDirectory,
  targetDirectory,
}: {
  cacheId: string
  noteIds: ReadonlyMap<string, string>
  sourceDirectory: string
  targetDirectory: string
}) {
  if (noteIds.size === 0) return
  const database = await openDatabase()
  const transaction = database.transaction(DOCUMENT_STORE, "readwrite")
  const done = transactionDone(transaction)
  const store = transaction.objectStore(DOCUMENT_STORE)
  const documents = await requestResult<VaultNoteDocument[]>(store.index("cacheId").getAll(cacheId))
  for (const document of documents) {
    const noteId = noteIds.get(document.noteId)
    if (!noteId) continue
    const path = document.path === sourceDirectory || document.path?.startsWith(`${sourceDirectory}/`)
      ? `${targetDirectory}${document.path.slice(sourceDirectory.length)}`
      : document.path
    store.delete(document.key)
    store.put({ ...document, key: documentKey(cacheId, noteId), noteId, path })
  }
  await done
  database.close()
}

export async function createVaultCacheId(identity: string) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    const insecureWebOrigin = typeof window !== "undefined"
      && window.location.protocol === "http:"
      && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
    // WebDAV 会携带应用密码；非安全来源不能用弱哈希兜底继续连接，否则会让用户误以为 HTTP 部署是安全的。
    throw new Error(insecureWebOrigin
      ? "Web 端坚果云同步需要通过 HTTPS 访问；请为当前站点配置 HTTPS 后重试"
      : "当前浏览器不支持 Web Crypto，无法安全连接坚果云；请升级浏览器后重试")
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(identity))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function saveVaultCache(snapshot: VaultCacheSnapshot, options: SaveVaultCacheOptions = {}) {
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
  // 后台旧库检查点可以继续落盘，但绝不能把当前库指针切回旧库。
  if (options.updateLastCache !== false) {
    transaction.objectStore(SETTINGS_STORE).put({ key: LAST_CACHE_KEY, value: snapshot.id })
  }
  await transactionDone(transaction)
  database.close()
}

export async function saveVaultDirectoryQueueCheckpoint(
  checkpoint: VaultCacheSnapshot,
  noteUpdates: readonly VaultDirectoryNoteCheckpoint[] = [],
) {
  const database = await openDatabase()
  const transaction = database.transaction([VAULT_STORE, DOCUMENT_STORE], "readwrite")
  const vaultStore = transaction.objectStore(VAULT_STORE)
  const documentStore = transaction.objectStore(DOCUMENT_STORE)
  try {
    const [stored, documents] = await Promise.all([
      requestResult<VaultCacheSnapshot | undefined>(vaultStore.get(checkpoint.id)),
      requestResult<VaultNoteDocument[]>(documentStore.index("cacheId").getAll(checkpoint.id)),
    ])
    const current = stored
      ? hydrateSnapshot(stored, documents)
      : checkpoint
    const updates = new Map(noteUpdates.map((update) => [update.id, update]))
    const notes = current.notes.map((note) => {
      const update = updates.get(note.id)
      if (!update) return note
      return {
        ...note,
        revision: update.revision,
        syncError: update.syncError,
        syncStatus: update.syncStatus ?? note.syncStatus,
      }
    })
    const merged: VaultCacheSnapshot = {
      ...current,
      pendingDirectories: checkpoint.pendingDirectories,
      pendingDirectoryMoves: checkpoint.pendingDirectoryMoves,
      notes,
      savedAt: checkpoint.savedAt,
    }
    if (!stored) {
      for (const note of notes) {
        if (note.contentLoaded) documentStore.put(toVaultNoteDocument(checkpoint.id, note))
      }
    }
    // 结构检查点只改自己拥有的字段；正文与无关笔记元数据以事务开始时的最新缓存为准。
    vaultStore.put({ ...merged, notes: notes.map((note) => toMetadataNote(note, Boolean(note.contentLoaded || note.contentCached))) })
    await transactionDone(transaction)
    return merged
  } finally {
    database.close()
  }
}

export async function saveVaultNoteQueueCheckpoint(cacheId: string, checkpoint: VaultNoteQueueCheckpoint) {
  const database = await openDatabase()
  const transaction = database.transaction([VAULT_STORE, DOCUMENT_STORE], "readwrite")
  const vaultStore = transaction.objectStore(VAULT_STORE)
  const documentStore = transaction.objectStore(DOCUMENT_STORE)
  try {
    const [stored, documents] = await Promise.all([
      requestResult<VaultCacheSnapshot | undefined>(vaultStore.get(cacheId)),
      requestResult<VaultNoteDocument[]>(documentStore.index("cacheId").getAll(cacheId)),
    ])
    if (!stored) throw new Error("文件同步检查点所属缓存不存在")
    const current = hydrateSnapshot(stored, documents)
    const currentNote = current.notes.find((note) => note.id === checkpoint.note.id)
    let notes = current.notes
    if (checkpoint.type === "deleted") {
      // 只清理仍处于同一删除意图的墓碑；若用户已恢复则保留最新工作副本。
      if (currentNote?.pendingOperation === "delete") {
        notes = notes.filter((note) => note.id !== checkpoint.note.id)
        documentStore.delete(documentKey(cacheId, checkpoint.note.id))
      }
    } else if (currentNote) {
      const contentChangedAfterStart = currentNote.content !== checkpoint.note.content
        || (currentNote.localEditSequence ?? 0) > (checkpoint.note.localEditSequence ?? 0)
      const mergedNote: Note = checkpoint.type === "failed"
        ? {
            ...currentNote,
            syncError: checkpoint.note.syncError,
            syncStatus: checkpoint.note.syncStatus,
          }
        : checkpoint.type === "moved"
        ? {
            ...currentNote,
            pendingOperation: undefined,
            previousRemotePath: undefined,
            revision: checkpoint.note.revision,
            syncError: undefined,
            syncStatus: "modified",
            writeContentAfterMove: undefined,
          }
        : {
            ...currentNote,
            baseContent: checkpoint.note.content,
            pendingOperation: undefined,
            previousRemotePath: undefined,
            revision: checkpoint.note.revision,
            syncError: undefined,
            syncStatus: contentChangedAfterStart ? "modified" : "synced",
            updatedAt: contentChangedAfterStart ? currentNote.updatedAt : "刚刚同步",
            writeContentAfterMove: undefined,
          }
      notes = notes.map((note) => note.id === mergedNote.id ? mergedNote : note)
      if (mergedNote.contentLoaded) documentStore.put(toVaultNoteDocument(cacheId, mergedNote))
    }
    const merged = { ...current, notes, savedAt: Date.now() }
    vaultStore.put({ ...merged, notes: notes.map((note) => toMetadataNote(note, Boolean(note.contentLoaded || note.contentCached))) })
    await transactionDone(transaction)
    return merged
  } finally {
    database.close()
  }
}

export async function saveVaultWorkingCopyEdit(cacheId: string, editedNote: Note) {
  const database = await openDatabase()
  const transaction = database.transaction([VAULT_STORE, DOCUMENT_STORE], "readwrite")
  const vaultStore = transaction.objectStore(VAULT_STORE)
  const documentStore = transaction.objectStore(DOCUMENT_STORE)
  try {
    const [stored, document] = await Promise.all([
      requestResult<VaultCacheSnapshot | undefined>(vaultStore.get(cacheId)),
      requestResult<VaultNoteDocument | undefined>(documentStore.get(documentKey(cacheId, editedNote.id))),
    ])
    if (!stored) throw new Error("正在编辑的笔记库缓存不存在")
    const currentNote = stored.notes.find((note) => note.id === editedNote.id)
    if (!currentNote) throw new Error("正在编辑的笔记已不在缓存中")
    if ((currentNote.localEditSequence ?? 0) >= (editedNote.localEditSequence ?? 0)) {
      await transactionDone(transaction)
      return
    }
    // 只更新正文所属字段，保留同步检查点刚写入的 ETag、基线和冲突状态。
    const mergedNote: Note = {
      ...currentNote,
      baseContent: document?.baseContent,
      content: editedNote.content,
      preview: editedNote.preview,
      frontmatter: editedNote.frontmatter,
      outgoingLinks: editedNote.outgoingLinks,
      searchText: editedNote.searchText,
      tags: editedNote.tags,
      modifiedAt: editedNote.modifiedAt,
      updatedAt: editedNote.updatedAt,
      localEditSequence: editedNote.localEditSequence,
      syncStatus: currentNote.syncStatus === "conflict" ? "conflict" : "modified",
      syncError: currentNote.syncStatus === "conflict" ? currentNote.syncError : undefined,
    }
    documentStore.put(toVaultNoteDocument(cacheId, mergedNote))
    vaultStore.put({
      ...stored,
      notes: stored.notes.map((note) => note.id === mergedNote.id
        ? toMetadataNote(mergedNote, true)
        : note),
      savedAt: Date.now(),
    })
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export async function commitVaultDirectoryRename({
  expectedDocuments,
  noteIds,
  snapshot,
  sourceDirectory,
  targetDirectory,
}: {
  expectedDocuments?: ReadonlyMap<string, string>
  noteIds: ReadonlyMap<string, string>
  snapshot: VaultCacheSnapshot
  sourceDirectory: string
  targetDirectory: string
}) {
  const database = await openDatabase()
  const transaction = database.transaction([VAULT_STORE, ATTACHMENT_STORE, DOCUMENT_STORE], "readwrite")
  const vaultStore = transaction.objectStore(VAULT_STORE)
  const attachmentStore = transaction.objectStore(ATTACHMENT_STORE)
  const documentStore = transaction.objectStore(DOCUMENT_STORE)
  try {
    // 两个 getAll 先并发挂到同一事务；后续改键和快照写入要么全部提交，要么全部回滚。
    const [attachments, documents] = await Promise.all([
      requestResult<VaultAttachmentCacheEntry[]>(attachmentStore.index("cacheId").getAll(snapshot.id)),
      requestResult<VaultNoteDocument[]>(documentStore.index("cacheId").getAll(snapshot.id)),
    ])
    if (expectedDocuments) {
      const documentsByNoteId = new Map(documents.map((document) => [document.noteId, document]))
      for (const [noteId, expectedContent] of expectedDocuments) {
        const current = documentsByNoteId.get(noteId)
        if (current && current.content !== expectedContent) {
          throw new Error("笔记正文已在重命名期间变化，请重试")
        }
      }
    }
    const validDocumentKeys = new Set(snapshot.notes.map((note) => documentKey(snapshot.id, note.id)))

    for (const document of documents) {
      const noteId = noteIds.get(document.noteId) ?? document.noteId
      const path = replaceStorageDirectoryPrefix(document.path, sourceDirectory, targetDirectory)
      const key = documentKey(snapshot.id, noteId)
      if (key !== document.key) documentStore.delete(document.key)
      if (validDocumentKeys.has(key)) documentStore.put({ ...document, key, noteId, path })
      else documentStore.delete(key)
    }

    for (const note of snapshot.notes) {
      const key = documentKey(snapshot.id, note.id)
      if (note.contentLoaded) documentStore.put(toVaultNoteDocument(snapshot.id, note))
      else if (!note.contentCached) documentStore.delete(key)
    }

    for (const attachment of attachments) {
      const path = replaceStorageDirectoryPrefix(attachment.path, sourceDirectory, targetDirectory) ?? attachment.path
      const noteId = noteIds.get(attachment.noteId) ?? attachment.noteId
      const key = attachmentKey(snapshot.id, path)
      if (key === attachment.key && noteId === attachment.noteId) continue
      attachmentStore.delete(attachment.key)
      attachmentStore.put({ ...attachment, key, noteId, path })
    }

    const metadataNotes = snapshot.notes.map((note) => toMetadataNote(
      note,
      Boolean(note.contentLoaded || note.contentCached),
    ))
    vaultStore.put({ ...snapshot, notes: metadataNotes })
    await transactionDone(transaction)
  } finally {
    database.close()
  }
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

export async function searchCachedNoteDocuments(cacheId: string, query: string, limit = 5_000, scope: "all" | "body" = "all") {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []
  const documents = await listCachedNoteDocuments(cacheId)
  const paths: string[] = []
  for (const document of documents) {
    const haystack = scope === "body"
      ? document.content.toLocaleLowerCase()
      : `${document.title} ${document.content} ${(document.tags ?? []).join(" ")}`.toLocaleLowerCase()
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
  // 文件夹排序的同步工作副本与缓存同生命周期，删除缓存时一并清理。
  settingsStore.delete(`folder-order-sync:v1:${id}`)
  for (const key of attachmentKeys) attachmentStore.delete(key)
  for (const key of documentKeys) documentStore.delete(key)
  await done
  database.close()
}

// WKWebView（iOS）退到后台后系统可能回收网络进程，IndexedDB 连接随之断开；
// 此后所有请求都抛出带此信息的异常且不会自愈，只有重新加载页面才能重建连接。
export function isIndexedDbConnectionLostError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return message.includes("Indexed Database server lost")
}

// 排序同步工作副本等独立元数据模块复用同一数据库连接，避免各自维护升级逻辑。
export function openVaultCacheDatabase() {
  return openDatabase()
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

function replaceStorageDirectoryPrefix(path: string | undefined, sourceDirectory: string, targetDirectory: string) {
  if (!path) return path
  if (path === sourceDirectory) return targetDirectory
  return path.startsWith(`${sourceDirectory}/`)
    ? `${targetDirectory}${path.slice(sourceDirectory.length)}`
    : path
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

function hydrateSnapshot(snapshot: VaultCacheSnapshot, documents: readonly VaultNoteDocument[]): VaultCacheSnapshot {
  const byNoteId = new Map(documents.map((document) => [document.noteId, document]))
  return {
    ...snapshot,
    notes: snapshot.notes.map((note) => {
      const document = byNoteId.get(note.id)
      return document ? hydrateNoteFromCachedDocument(note, document) : note
    }),
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
