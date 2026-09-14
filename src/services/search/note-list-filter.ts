import type { Note } from "@/types/note"

export function noteMatchesLibraryQuery(
  note: Note,
  normalizedQuery: string,
  nativeSearchPaths: ReadonlySet<string> | null = null,
) {
  if (!normalizedQuery) return true
  if (`${note.title} ${note.preview}`.toLocaleLowerCase().includes(normalizedQuery)) return true
  return nativeSearchPaths
    ? Boolean(note.remotePath && nativeSearchPaths.has(note.remotePath))
    : Boolean(note.searchText?.includes(normalizedQuery))
}
