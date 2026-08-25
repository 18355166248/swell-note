import type { Note } from "@/types/note"

export type VaultFolder = {
  count: number
  depth: number
  hasChildren: boolean
  label: string
  path: string
}

export function buildVaultFolders(notes: Note[], explicitDirectories: readonly string[] = []) {
  const counts = new Map<string, number>()

  for (const directory of explicitDirectories) {
    const segments = folderSegments(directory)
    for (let index = 1; index <= segments.length; index += 1) {
      const path = segments.slice(0, index).join(" / ")
      if (!counts.has(path)) counts.set(path, 0)
    }
  }

  for (const note of notes) {
    const segments = folderSegments(note.folder)
    for (let index = 1; index <= segments.length; index += 1) {
      const path = segments.slice(0, index).join(" / ")
      counts.set(path, (counts.get(path) ?? 0) + 1)
    }
  }

  const folders = [...counts.entries()].map(([path, count]): VaultFolder => {
    const segments = folderSegments(path)
    return {
      count,
      depth: segments.length - 1,
      hasChildren: false,
      label: segments[segments.length - 1],
      path,
    }
  })
  const foldersByPath = new Map(folders.map((folder) => [folder.path, folder]))
  const childrenByParent = new Map<string, VaultFolder[]>()
  const roots: VaultFolder[] = []

  for (const folder of folders) {
    const parentPath = getParentFolderPath(folder.path)
    if (!parentPath) {
      roots.push(folder)
      continue
    }

    const parent = foldersByPath.get(parentPath)
    if (!parent) {
      roots.push(folder)
      continue
    }

    parent.hasChildren = true
    const siblings = childrenByParent.get(parentPath) ?? []
    siblings.push(folder)
    childrenByParent.set(parentPath, siblings)
  }

  const orderedFolders: VaultFolder[] = []
  const appendFolderTree = (folder: VaultFolder) => {
    orderedFolders.push(folder)
    for (const child of childrenByParent.get(folder.path) ?? []) appendFolderTree(child)
  }
  // Map 仍负责保留同级首次出现顺序，前序遍历保证每个子树紧跟父目录，不被其他根目录打断。
  for (const root of roots) appendFolderTree(root)
  return orderedFolders
}

export function noteBelongsToFolder(note: Note, folderPath: string) {
  return note.folder === folderPath || note.folder?.startsWith(`${folderPath} / `) === true
}

export function noteBelongsDirectlyToFolder(note: Note, folderPath: string) {
  return note.folder === folderPath
}

export function getDirectChildVaultFolders(
  folders: VaultFolder[],
  parentPath: string | null,
) {
  const parentDepth = parentPath ? folderSegments(parentPath).length : 0
  return folders.filter((folder) => {
    const segments = folderSegments(folder.path)
    if (segments.length !== parentDepth + 1) return false
    return parentPath === null || getParentFolderPath(folder.path) === parentPath
  })
}

export function getParentFolderPath(folderPath: string) {
  const segments = folderSegments(folderPath)
  return segments.slice(0, -1).join(" / ") || null
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
