import type { Note } from "@/types/note"

export const DEFAULT_TRASH_RETENTION_DAYS = 30

export type TrashRetentionDays = 7 | 30 | 90 | "forever"

export type TrashEntry = {
  deletedAt: number
  folderPath?: string
  id: string
  kind: "folder" | "note"
  notes: Note[]
  originalPath: string
  source: "local" | "webdav"
  trashedPath?: string
}

export function createTrashId() {
  return `trash-${Date.now()}-${crypto.randomUUID()}`
}

export function isTrashEntryExpired(
  entry: TrashEntry,
  retentionDays: TrashRetentionDays,
  now = Date.now(),
) {
  if (retentionDays === "forever") return false
  return now - entry.deletedAt >= retentionDays * 24 * 60 * 60 * 1_000
}

export function buildLocalTrashPath(entryId: string, originalPath: string) {
  const name = originalPath.replace(/\\/g, "/").split("/").filter(Boolean).pop()
  if (!name) throw new Error("回收站源路径无效")
  return `.swell-trash/${entryId}/${name}`
}
