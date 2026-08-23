import type { Note } from "@/types/note"

export type VaultFolder = {
  count: number
  depth: number
  hasChildren: boolean
  label: string
  path: string
}

export function buildVaultFolders(notes: Note[]) {
  const counts = new Map<string, number>()

  for (const note of notes) {
    const segments = folderSegments(note.folder)
    for (let index = 1; index <= segments.length; index += 1) {
      const path = segments.slice(0, index).join(" / ")
      counts.set(path, (counts.get(path) ?? 0) + 1)
    }
  }

  return [...counts.entries()].map(([path, count]): VaultFolder => {
    const segments = folderSegments(path)
    return {
      count,
      depth: segments.length - 1,
      hasChildren: [...counts.keys()].some((candidate) => candidate.startsWith(`${path} / `)),
      label: segments[segments.length - 1],
      path,
    }
  })
}

export function noteBelongsToFolder(note: Note, folderPath: string) {
  return note.folder === folderPath || note.folder?.startsWith(`${folderPath} / `) === true
}

export function getFolderAncestorPaths(folderPath?: string | null) {
  const segments = folderSegments(folderPath ?? undefined)
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join(" / "))
}

export function getVisibleVaultFolders(
  folders: VaultFolder[],
  expandedFolderPaths: ReadonlySet<string>,
) {
  return folders.filter((folder) =>
    folder.depth === 0
    || getFolderAncestorPaths(folder.path).every((path) => expandedFolderPaths.has(path)),
  )
}

function folderSegments(path?: string) {
  return path?.split(/\s*\/\s*/).filter(Boolean) ?? []
}
