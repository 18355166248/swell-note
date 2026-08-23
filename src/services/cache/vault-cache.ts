import type { Note } from "@/types/note"
import type { VaultSourceKind } from "@/services/vault/vault-adapter"

const DATABASE_NAME = "swell-note-vault-cache"
const DATABASE_VERSION = 1
const VAULT_STORE = "vaults"
const SETTINGS_STORE = "settings"
const LAST_CACHE_KEY = "last-cache"

export type VaultCacheSnapshot = {
  activeNoteId: string
  id: string
  label: string
  lastSyncedAt?: number
  notes: Note[]
  savedAt: number
  sourceKind: VaultSourceKind
}

export type VaultCacheSummary = Pick<
  VaultCacheSnapshot,
  "activeNoteId" | "id" | "label" | "lastSyncedAt" | "savedAt" | "sourceKind"
> & { noteCount: number }

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
  const transaction = database.transaction(VAULT_STORE, "readwrite")
  transaction.objectStore(VAULT_STORE).delete(id)
  await transactionDone(transaction)
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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("打开笔记缓存失败"))
  })
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
