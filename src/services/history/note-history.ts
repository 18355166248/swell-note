import { loadHistoryPolicy } from "./history-policy"
const DATABASE_NAME = "swell-note-history"
const DATABASE_VERSION = 1
const VERSION_STORE = "versions"

export type NoteVersion = {
  cacheId: string
  content: string
  createdAt: number
  id: string
  key: string
  noteId: string
  noteKey: string
  reason: "编辑前" | "恢复前" | "同步前" | "手动快照"
  title: string
}

type SaveNoteVersionInput = Pick<NoteVersion, "cacheId" | "content" | "noteId" | "reason" | "title">

const historyWrites = new Map<string, Promise<unknown>>()
// 手动快照与自动编辑起点共用串行链，避免并发读旧列表后重复存档或超出保留上限。
function queueHistoryWrite<T>(key: string, action: () => Promise<T>): Promise<T> {
  const operation = (historyWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(action)
  historyWrites.set(key, operation)
  const clear = () => { if (historyWrites.get(key) === operation) historyWrites.delete(key) }
  void operation.then(clear, clear)
  return operation
}
export function saveNoteVersion(input: SaveNoteVersionInput, now = Date.now()) {
  return queueHistoryWrite(buildNoteKey(input.cacheId, input.noteId), () => saveNoteVersionNow(input, now))
}
async function saveNoteVersionNow(input: SaveNoteVersionInput, now: number) {
  if (!input.cacheId || !input.noteId) return null
  const policy = loadHistoryPolicy()
  const existing = await listNoteVersions(input.cacheId, input.noteId)
  const latest = existing[0]
  if (latest?.content === input.content) return latest
  // 连续输入只保留一个编辑起点；超过间隔后再落一个阶段快照，避免每次按键都膨胀 IndexedDB。
  if (input.reason === "编辑前" && latest && now - latest.createdAt < policy.intervalMinutes * 60_000) return latest

  const noteKey = buildNoteKey(input.cacheId, input.noteId)
  const version: NoteVersion = {
    ...input,
    createdAt: now,
    id: crypto.randomUUID(),
    key: `${noteKey}\u0000${String(now).padStart(16, "0")}\u0000${crypto.randomUUID()}`,
    noteKey,
  }
  const database = await openDatabase()
  try {
    const transaction = database.transaction(VERSION_STORE, "readwrite")
    const store = transaction.objectStore(VERSION_STORE)
    store.put(version)
    for (const stale of existing.slice(policy.limit - 1)) store.delete(stale.key)
    await transactionDone(transaction)
  } finally {
    // QuotaExceededError 也可能在 put 时同步抛出，仍须关闭连接供用户重试。
    database.close()
  }
  return version
}

export async function listNoteVersions(cacheId: string, noteId: string) {
  const database = await openDatabase()
  try {
    const versions = await requestResult<NoteVersion[]>(
      database.transaction(VERSION_STORE, "readonly").objectStore(VERSION_STORE).index("noteKey").getAll(buildNoteKey(cacheId, noteId)),
    )
    return versions.sort((left, right) => right.createdAt - left.createdAt)
  } finally {
    database.close()
  }
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

export function exportHistoryArchive(versions: readonly NoteVersion[], title: string) {
  return JSON.stringify({ format: "swell-note-history", version: 1, title, exportedAt: Date.now(), versions: versions.map(({ content, createdAt, reason, title }) => ({ content, createdAt, reason, title })) }, null, 2)
}

export function importHistoryArchive(cacheId: string, noteId: string, raw: string) {
  return queueHistoryWrite(buildNoteKey(cacheId, noteId), () => importHistoryArchiveNow(cacheId, noteId, raw))
}
async function importHistoryArchiveNow(cacheId: string, noteId: string, raw: string) {
  if (!cacheId || !noteId || raw.length > 20 * 1024 * 1024) throw new Error("历史归档过大或目标笔记不可用")
  const archive = JSON.parse(raw) as Record<string, unknown>
  if (archive?.format !== "swell-note-history" || archive.version !== 1 || !Array.isArray(archive.versions) || archive.versions.length > 300) throw new Error("不支持的历史归档")
  // 全部验证后才开写事务；导入只追加到当前笔记历史，不采用归档中的库路径，也不恢复正文。
  const input = archive.versions.map((value): Pick<NoteVersion, "content" | "createdAt" | "reason" | "title"> => {
    if (!value || typeof value.content !== "string" || typeof value.title !== "string" || value.title.length > 1000 || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || !["编辑前", "恢复前", "同步前", "手动快照"].includes(value.reason)) throw new Error("历史归档包含无效版本")
    return { content: value.content, createdAt: value.createdAt, reason: value.reason, title: value.title }
  })
  const existing = await listNoteVersions(cacheId, noteId), noteKey = buildNoteKey(cacheId, noteId)
  const fingerprints = new Set(existing.map((version) => JSON.stringify([version.createdAt, version.content])))
  const imported: NoteVersion[] = []
  for (const value of input) {
    const fingerprint = JSON.stringify([value.createdAt, value.content])
    if (fingerprints.has(fingerprint)) continue
    fingerprints.add(fingerprint)
    const id = crypto.randomUUID()
    imported.push({ ...value, cacheId, noteId, noteKey, id, key: `${noteKey}\u0000${String(value.createdAt).padStart(16, "0")}\u0000${id}` })
  }
  const merged = [...existing, ...imported].sort((a, b) => b.createdAt - a.createdAt)
  const retained = merged.slice(0, loadHistoryPolicy().limit), database = await openDatabase()
  try {
    const transaction = database.transaction(VERSION_STORE, "readwrite"), store = transaction.objectStore(VERSION_STORE)
    retained.forEach((version) => store.put(version))
    merged.slice(retained.length).forEach((version) => store.delete(version.key))
    await transactionDone(transaction)
  } finally { database.close() }
  return imported.filter((version) => retained.includes(version)).length
}
