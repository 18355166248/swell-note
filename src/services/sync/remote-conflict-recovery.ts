import type { Note } from "@/types/note"
import type { VaultAdapter, VaultDocument, VaultFileEntry } from "@/services/vault/vault-adapter"
import { deriveRemoteFolder, indexNoteContent } from "@/services/app/app-note-utils"
import { buildNotePreview } from "@/services/markdown/note-preview"

export async function findRemoteConflictCandidates(adapter: VaultAdapter, missingPath: string) {
  const name = missingPath.split("/").pop()
  // 同名只能作为候选，不能证明是同一篇；由用户确认完整路径后才读取和采用。
  const files = await adapter.listMarkdownFiles()
  return [...new Map(files.filter((file) => file.path !== missingPath && file.path.split("/").pop() === name)
    .map((file) => [file.path, file])).values()]
}

export function adoptRemoteConflictDocument(notes: Note[], noteId: string, file: VaultFileEntry, document: VaultDocument, displayPath = file.path): Note[] {
  const source = notes.find((note) => note.id === noteId)
  if (!source) throw new Error("冲突笔记已变化，请重新打开后重试")
  const id = `webdav:${file.path}`
  const targets = notes.filter((note) => note.id !== noteId && (note.id === id || note.remotePath === file.path))
  const target = targets[0]
  // 目标路径也有未同步修改时，不能因处理另一篇旧路径冲突而顺带覆盖它。
  if (targets.some((note) => note.syncStatus === "modified" || note.syncStatus === "conflict" || note.pendingOperation)) {
    throw new Error(`目标笔记也有未同步修改，请先处理：${file.path}`)
  }
  const restored: Note = {
    ...(target ?? source),
    ...indexNoteContent(document.content),
    id,
    remotePath: file.path,
    title: file.name.replace(/\.md$/i, ""),
    folder: deriveRemoteFolder(displayPath),
    content: document.content,
    preview: buildNotePreview(document.content, source.format),
    baseContent: document.content,
    contentLoaded: true,
    contentCached: true,
    revision: document.revision,
    syncStatus: "synced",
    syncError: undefined,
    mergeConflictCount: undefined,
    pendingOperation: undefined,
    previousRemotePath: undefined,
    writeContentAfterMove: undefined,
    draft: undefined,
    readOnly: false,
    updatedAt: "刚刚采用云端版本",
  }
  // 云端路径可能已在目录列表中，替换旧冲突时同时去重，保持一条文件对应一篇笔记。
  return notes.filter((note) => note.id !== noteId && note.id !== id && note.remotePath !== file.path).concat(restored)
}
