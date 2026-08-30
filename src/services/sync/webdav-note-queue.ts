import type { Note } from "@/types/note"
import { VaultConflictError, type VaultAdapter } from "@/services/vault/vault-adapter"

export type WebDavNoteQueueEvent =
  | { note: Note; type: "start" }
  | { note: Note; type: "deleted" }
  | { note: Note; revision?: string; type: "moved" }
  | { note: Note; revision?: string; type: "synced" }
  | { conflict: boolean; message: string; note: Note; type: "failed" }
  | { note: Note; type: "complete" }

type SyncWebDavNoteQueueOptions = {
  adapter: VaultAdapter
  isCancelled?: () => boolean
  isFatalError?: (error: unknown) => boolean
  noteIds?: ReadonlySet<string>
  notes: Note[]
  onDeleteCommitted?: (note: Note) => Promise<void>
  onEvent?: (event: WebDavNoteQueueEvent) => void
}

export async function syncWebDavNoteQueue({
  adapter,
  isCancelled = () => false,
  isFatalError = () => false,
  noteIds,
  notes,
  onDeleteCommitted,
  onEvent,
}: SyncWebDavNoteQueueOptions) {
  if (adapter.kind !== "webdav" || !adapter.writeTextFile) {
    return { cancelled: false, errorMessage: null, fatalError: null, notes }
  }

  let nextNotes = notes
  let errorMessage: string | null = null
  let fatalError: unknown = null
  const ensuredDirectories = new Set<string>()
  const pendingNotes = notes.filter((note) =>
    note.source === "webdav"
    && note.syncStatus === "modified"
    && note.remotePath
    && (!noteIds || noteIds.has(note.id)),
  )

  // 队列严格串行：坚果云有频率限制，并且移动后写正文依赖 MOVE 返回的新版本号。
  for (const pendingNote of pendingNotes) {
    if (isCancelled()) break
    const path = pendingNote.remotePath!
    onEvent?.({ note: pendingNote, type: "start" })
    try {
      if (pendingNote.pendingOperation === "delete") {
        if (!adapter.deleteTextFile) throw new Error("当前 WebDAV 会话不支持删除")
        await adapter.deleteTextFile(pendingNote.previousRemotePath ?? path, pendingNote.revision)
        nextNotes = nextNotes.filter((note) => note.id !== pendingNote.id)
        onEvent?.({ note: pendingNote, type: "deleted" })
        // 远端删除成功后才能清理附件队列，失败或取消时仍保留本地可恢复数据。
        // 清理本机附件失败不能把已经提交的远端 DELETE 重新放回队列，否则重试会变成 404。
        try { await onDeleteCommitted?.(pendingNote) } catch { /* 后续存储巡检仍可清理孤立缓存 */ }
        continue
      }

      let result
      if (pendingNote.pendingOperation === "create") {
        result = await adapter.createTextFile?.(path, pendingNote.content)
      } else if (pendingNote.pendingOperation === "move") {
        if (!adapter.moveTextFile) throw new Error("当前 WebDAV 会话不支持移动")
        const targetDirectory = path.split("/").slice(0, -1).join("/")
        if (targetDirectory && !ensuredDirectories.has(targetDirectory)) {
          await adapter.ensureDirectory?.(targetDirectory)
          ensuredDirectories.add(targetDirectory)
        }
        const moved = await adapter.moveTextFile(
          pendingNote.previousRemotePath ?? path,
          path,
          pendingNote.revision,
        )
        if (pendingNote.writeContentAfterMove === false) {
          result = moved
        } else {
          // MOVE 已在远端生效后立刻推进本地检查点；即使后续 PUT 中断，重试也只写新路径，不会再次移动旧路径。
          const movedCheckpoint: Note = {
            ...pendingNote,
            pendingOperation: undefined,
            previousRemotePath: undefined,
            revision: moved.revision,
            writeContentAfterMove: undefined,
          }
          nextNotes = nextNotes.map((note) => note.id === pendingNote.id ? movedCheckpoint : note)
          onEvent?.({ note: movedCheckpoint, revision: moved.revision, type: "moved" })
          result = await adapter.writeTextFile(path, pendingNote.content, moved.revision)
        }
      } else {
        result = await adapter.writeTextFile(path, pendingNote.content, pendingNote.revision)
      }
      if (!result) throw new Error("当前 WebDAV 会话不支持此同步操作")

      nextNotes = nextNotes.map((note) => note.id === pendingNote.id
        ? {
            ...note,
            baseContent: pendingNote.content,
            mergeConflictCount: undefined,
            pendingOperation: undefined,
            previousRemotePath: undefined,
            revision: result.revision,
            syncError: undefined,
            syncStatus: "synced",
            updatedAt: "刚刚同步",
            writeContentAfterMove: undefined,
          }
        : note)
      onEvent?.({ note: pendingNote, revision: result.revision, type: "synced" })
    } catch (error) {
      if (isFatalError(error)) {
        fatalError = error
        break
      }
      const conflict = error instanceof VaultConflictError
      const message = error instanceof Error ? error.message : "同步笔记失败"
      errorMessage = message
      nextNotes = nextNotes.map((note) => note.id === pendingNote.id
        ? { ...note, syncError: conflict ? undefined : message, syncStatus: conflict ? "conflict" : "modified" }
        : note)
      onEvent?.({ conflict, message, note: pendingNote, type: "failed" })
    } finally {
      onEvent?.({ note: pendingNote, type: "complete" })
    }
  }

  return { cancelled: isCancelled(), errorMessage, fatalError, notes: nextNotes }
}
