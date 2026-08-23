import type { Note } from "@/types/note"

export type SyncSummary = {
  conflicts: number
  failed: number
  pending: number
  synced: number
}

export function summarizeWebDavSync(notes: Note[]): SyncSummary {
  return notes.reduce<SyncSummary>((summary, note) => {
    if (note.source !== "webdav") return summary
    if (note.syncStatus === "conflict") summary.conflicts += 1
    else if (note.syncStatus === "modified" && note.syncError) summary.failed += 1
    else if (note.syncStatus === "modified") summary.pending += 1
    else if (note.syncStatus === "synced") summary.synced += 1
    return summary
  }, { conflicts: 0, failed: 0, pending: 0, synced: 0 })
}
