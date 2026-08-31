import type { Note } from "@/types/note"

function hashContent(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function buildAutoSyncQueueKey(
  cacheId: string | undefined,
  notes: Note[],
  pendingDirectories: string[],
  pendingAttachments: number,
) {
  // 错误文案不属于队列内容，失败后只更新 syncError 不能生成新签名，否则会触发无限自动重试。
  const pendingNotes = notes
    .filter((note) => note.source === "webdav" && note.syncStatus === "modified")
    .map((note) => `${note.id}:${note.pendingOperation ?? "update"}:${hashContent(`${note.title}\u0000${note.content}`)}`)
    .sort()
  return `${cacheId ?? "no-cache"}|${pendingDirectories.slice().sort().join("\u0001")}|${pendingAttachments}|${pendingNotes.join("\u0001")}`
}
