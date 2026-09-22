import type { Note } from "@/types/note"
import { hasPendingNotePin } from "./note-pin-sync"

export type SyncSummary = {
  conflicts: number
  failed: number
  pending: number
  synced: number
}

export type SyncQueueMetrics = {
  failed: number
  pending: number
  work: number
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

export function summarizeSyncQueue(
  notes: Note[],
  queuedAttachmentCount: number,
  failedAttachmentCount: number,
): SyncQueueMetrics {
  const summary = summarizeWebDavSync(notes)
  // 附件队列总数已包含失败项；展示时拆开口径，但同步按钮的工作量只能累计一次。
  const pendingAttachments = Math.max(0, queuedAttachmentCount - failedAttachmentCount)
  // 置顶配置是一个独立同步项目，不与正文待上传状态互相覆盖。
  const pendingPins = notes.some(hasPendingNotePin) ? 1 : 0
  return {
    failed: summary.failed + failedAttachmentCount,
    pending: summary.pending + pendingAttachments + pendingPins,
    work: summary.pending + summary.failed + queuedAttachmentCount + pendingPins,
  }
}
