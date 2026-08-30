import { extractFrontmatter, extractWikiLinks } from "@/services/search/note-index"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import type { Note, NoteSaveState } from "@/types/note"

export function formatRemoteDate(lastModified?: string) {
  if (!lastModified) return "文件时间未知"
  const date = new Date(lastModified)
  if (Number.isNaN(date.getTime())) return "文件时间未知"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function parseRemoteTimestamp(lastModified?: string) {
  if (!lastModified) return undefined
  const timestamp = Date.parse(lastModified)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

export function deriveRemoteFolder(path: string) {
  const segments = path.split("/").filter(Boolean)
  return segments.slice(0, -1).join(" / ") || "根目录"
}

export function deriveDirectoryPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).join(" / ")
}

export function toStorageDirectoryPath(path: string) {
  return path.split(/\s*\/\s*/).filter(Boolean).join("/")
}

export function sanitizeFolderName(name: string) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/^-+|-+$/g, "")
}

export function isEmptyDraftContent(note: Pick<Note, "content" | "title">) {
  return note.title.trim().length === 0 && note.content.trim().length === 0
}

export function isDiscardableEmptyDraft(note: Note) {
  // 兼容升级前已经生成但尚未同步的 WebDAV 空白稿；只有默认空正文才允许无痕撤销。
  const isUnsyncedWebDavDraft = note.source === "webdav" && note.pendingOperation === "create"
  return (note.draft === true || isUnsyncedWebDavDraft) && isEmptyDraftContent(note)
}

export function replaceFolderPrefix(path: string, sourceFolder: string, targetFolder: string) {
  if (path === sourceFolder) return targetFolder
  return path.startsWith(`${sourceFolder} / `)
    ? `${targetFolder}${path.slice(sourceFolder.length)}`
    : path
}

export function formatFileTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export async function readVaultDocuments(adapter: VaultAdapter, paths: string[]) {
  const documents = new Map<string, Awaited<ReturnType<VaultAdapter["readTextFile"]>>>()
  const batchSize = adapter.kind === "webdav" ? 4 : 12

  // 坚果云有请求频率限制：批次内并行避免串行瀑布，批次之间收敛并发避免大量正文同时触发 429。
  for (let index = 0; index < paths.length; index += batchSize) {
    const batch = await Promise.all(paths.slice(index, index + batchSize).map(async (path) => [
      path,
      await adapter.readTextFile(path),
    ] as const))
    for (const [path, document] of batch) documents.set(path, document)
  }

  return documents
}

export function getNoteSaveState(note: Note): NoteSaveState {
  if (note.syncStatus === "conflict") return { status: "conflict" }
  if (note.syncStatus === "modified" && note.syncError) return { message: note.syncError, status: "error" }
  if (note.syncStatus === "modified") return { status: "pending" }
  if (note.readOnly) return { status: "readonly" }
  return { status: "saved" }
}

export function indexNoteContent(content: string) {
  const frontmatter = extractFrontmatter(content)
  return {
    frontmatter: frontmatter.properties,
    outgoingLinks: extractWikiLinks(content),
    searchText: `${content} ${frontmatter.tags.join(" ")}`.toLocaleLowerCase(),
    tags: frontmatter.tags,
  }
}

export function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}
