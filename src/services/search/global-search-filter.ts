import type { Note } from "@/types/note"

export type GlobalSearchScope = "all" | "title" | "body"

export type GlobalSearchFilters = {
  folder: string
  query: string
  scope: GlobalSearchScope
  tag: string
}

export const ROOT_FOLDER_FILTER = "__root__"

export function matchesGlobalSearchFilters(
  note: Note,
  filters: GlobalSearchFilters,
  indexedPaths: ReadonlySet<string> | null,
) {
  const { folder, query, scope, tag } = filters
  if (tag && !note.tags?.some((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase())) return false
  if (folder) {
    const noteFolder = note.folder && note.folder !== "根目录" ? note.folder : ""
    if (folder === ROOT_FOLDER_FILTER ? Boolean(noteFolder) : noteFolder !== folder && !noteFolder.startsWith(`${folder} / `)) return false
  }
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  const titleMatch = note.title.toLocaleLowerCase().includes(needle)
  if (scope === "title") return titleMatch

  // 已加载的正文是编辑现场的事实来源；索引可能还保留编辑前的内容，不能据此产生误命中。
  const bodyMatch = note.contentLoaded
    ? note.content.toLocaleLowerCase().includes(needle)
    : note.syncStatus === "modified" || note.syncStatus === "conflict"
      ? false
      : Boolean(note.remotePath && indexedPaths?.has(note.remotePath))
  if (scope === "body") return bodyMatch
  return titleMatch
    || note.preview.toLocaleLowerCase().includes(needle)
    || Boolean(note.tags?.some((candidate) => candidate.toLocaleLowerCase().includes(needle)))
    || bodyMatch
    || Boolean(!note.contentLoaded && note.syncStatus !== "modified" && note.syncStatus !== "conflict"
      && note.searchText?.includes(needle))
}
