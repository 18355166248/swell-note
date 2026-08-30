const DATABASE_NAME = "swell-note-history"
const DATABASE_VERSION = 1
const VERSION_STORE = "versions"
const MAX_VERSIONS_PER_NOTE = 30
const AUTO_VERSION_INTERVAL_MS = 5 * 60 * 1_000

export type NoteVersion = {
  cacheId: string
  content: string
  createdAt: number
  id: string
  key: string
  noteId: string
  noteKey: string
  reason: "编辑前" | "恢复前" | "同步前"
  title: string
}

type SaveNoteVersionInput = Pick<NoteVersion, "cacheId" | "content" | "noteId" | "reason" | "title">

export async function saveNoteVersion(input: SaveNoteVersionInput, now = Date.now()) {
  if (!input.cacheId || !input.noteId) return null
  const existing = await listNoteVersions(input.cacheId, input.noteId)
  const latest = existing[0]
  if (latest?.content === input.content) return latest
  // 连续输入只保留一个编辑起点；超过间隔后再落一个阶段快照，避免每次按键都膨胀 IndexedDB。
  if (input.reason === "编辑前" && latest && now - latest.createdAt < AUTO_VERSION_INTERVAL_MS) return latest

  const noteKey = buildNoteKey(input.cacheId, input.noteId)
  const version: NoteVersion = {
    ...input,
    createdAt: now,
    id: crypto.randomUUID(),
    key: `${noteKey}\u0000${String(now).padStart(16, "0")}\u0000${crypto.randomUUID()}`,
    noteKey,
  }
  const database = await openDatabase()
  const transaction = database.transaction(VERSION_STORE, "readwrite")
  const store = transaction.objectStore(VERSION_STORE)
  store.put(version)
  for (const stale of existing.slice(MAX_VERSIONS_PER_NOTE - 1)) store.delete(stale.key)
  await transactionDone(transaction)
  database.close()
  return version
}

export async function listNoteVersions(cacheId: string, noteId: string) {
  const database = await openDatabase()
  const versions = await requestResult<NoteVersion[]>(
    database.transaction(VERSION_STORE, "readonly").objectStore(VERSION_STORE).index("noteKey").getAll(buildNoteKey(cacheId, noteId)),
  )
  database.close()
  return versions.sort((left, right) => right.createdAt - left.createdAt)
}

export async function deleteNoteVersions(cacheId: string, noteId: string) {
  const versions = await listNoteVersions(cacheId, noteId)
  if (versions.length === 0) return
  const database = await openDatabase()
  const transaction = database.transaction(VERSION_STORE, "readwrite")
  const store = transaction.objectStore(VERSION_STORE)
  for (const version of versions) store.delete(version.key)
  await transactionDone(transaction)
  database.close()
}

export async function remapNoteVersions(cacheId: string, previousNoteId: string, nextNoteId: string) {
  if (previousNoteId === nextNoteId) return
  const versions = await listNoteVersions(cacheId, previousNoteId)
  if (versions.length === 0) return
  const database = await openDatabase()
  const transaction = database.transaction(VERSION_STORE, "readwrite")
  const store = transaction.objectStore(VERSION_STORE)
  const nextNoteKey = buildNoteKey(cacheId, nextNoteId)
  for (const version of versions) {
    store.delete(version.key)
    store.put({
      ...version,
      key: `${nextNoteKey}\u0000${String(version.createdAt).padStart(16, "0")}\u0000${version.id}`,
      noteId: nextNoteId,
      noteKey: nextNoteKey,
    })
  }
  await transactionDone(transaction)
  database.close()
}

export function summarizeLineChanges(previous: string, current: string) {
  const before = previous.split("\n")
  const after = current.split("\n")
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1
  return {
    added: Math.max(0, after.length - prefix - suffix),
    removed: Math.max(0, before.length - prefix - suffix),
  }
}

function buildNoteKey(cacheId: string, noteId: string) {
  return `${cacheId}\u0000${noteId}`
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(VERSION_STORE)) {
        const store = database.createObjectStore(VERSION_STORE, { keyPath: "key" })
        store.createIndex("noteKey", "noteKey")
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("打开本地版本历史失败"))
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("读取本地版本历史失败"))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("保存本地版本历史失败"))
    transaction.onabort = () => reject(transaction.error ?? new Error("保存本地版本历史已中止"))
  })
}
