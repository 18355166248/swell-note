const STORAGE_KEY = "swell-note:sync-log:v1"
const MAX_ENTRIES = 50

export type SyncLogEntry = {
  id: string
  message: string
  status: "error" | "success"
  timestamp: number
}

export function loadSyncLog(): SyncLogEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSyncLogEntry).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

export function appendSyncLog(entry: Omit<SyncLogEntry, "id" | "timestamp">) {
  const nextEntry: SyncLogEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  }
  const entries = [nextEntry, ...loadSyncLog()].slice(0, MAX_ENTRIES)
  // 日志只记录结果摘要，不写入账号、密码、笔记正文或远端完整路径。
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  return entries
}

export function clearSyncLog() {
  localStorage.removeItem(STORAGE_KEY)
}

function isSyncLogEntry(value: unknown): value is SyncLogEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Partial<SyncLogEntry>
  return typeof entry.id === "string"
    && typeof entry.message === "string"
    && typeof entry.timestamp === "number"
    && (entry.status === "error" || entry.status === "success")
}
