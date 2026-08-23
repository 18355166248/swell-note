import type { Note } from "@/types/note"

export function isWebDavWorkingCopy(note: Note) {
  return note.source === "webdav"
    && (note.syncStatus === "modified" || note.syncStatus === "conflict")
}

export function remoteChangedFromBase(note: Note, remoteRevision?: string) {
  if (!isWebDavWorkingCopy(note)) return false
  // 任一侧缺少 ETag 时都不能证明版本一致，默认按冲突处理，避免无条件覆盖云端。
  return !note.revision || !remoteRevision || note.revision !== remoteRevision
}

export function canReuseCachedContent(note: Note | undefined, remoteRevision?: string) {
  return Boolean(note?.contentLoaded
    && note.revision
    && remoteRevision
    && note.revision === remoteRevision)
}
