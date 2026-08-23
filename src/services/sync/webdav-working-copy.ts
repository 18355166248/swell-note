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

type ShouldReadVaultDocumentOptions = {
  filePath: string
  preferredPath: string
  preserveContext: boolean
  previousNote?: Note
  remoteRevision?: string
}

export function shouldReadVaultDocument({
  filePath,
  preferredPath,
  preserveContext,
  previousNote,
  remoteRevision,
}: ShouldReadVaultDocumentOptions) {
  const hasLocalChanges = previousNote?.syncStatus === "modified"
    || previousNote?.syncStatus === "conflict"
  if (hasLocalChanges) return false
  if (!preserveContext) return filePath === preferredPath

  // 重连时当前详情即使只有元数据，也要优先补齐正文，避免宽屏编辑区一直停留在缓存占位文案。
  if (filePath === preferredPath && !previousNote?.contentLoaded) return true

  return Boolean(previousNote?.contentLoaded && (
    !previousNote.revision
    || !remoteRevision
    || previousNote.revision !== remoteRevision
  ))
}
