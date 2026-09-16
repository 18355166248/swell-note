export type FolderRenameTarget = {
  folder: string
  relativePath: string
}

export type FolderRenamePlan = {
  sourceFolder: string
  targetFolder: string
  directories: string[]
  pendingDirectories: string[]
}

export function replaceFolderPrefix(path: string, sourceFolder: string, targetFolder: string) {
  if (path === sourceFolder) return targetFolder
  return path.startsWith(`${sourceFolder} / `)
    ? `${targetFolder}${path.slice(sourceFolder.length)}`
    : path
}

export function replaceStoragePathPrefix(path: string, sourceDirectory: string, targetDirectory: string) {
  if (path === sourceDirectory) return targetDirectory
  return path.startsWith(`${sourceDirectory}/`)
    ? `${targetDirectory}${path.slice(sourceDirectory.length)}`
    : path
}

export function isPendingDirectoryTree(sourceFolder: string, pendingDirectories: readonly string[]) {
  return pendingDirectories.some((pending) => sourceFolder === pending || sourceFolder.startsWith(`${pending} / `))
}

export function remapWebDavNoteForDirectory(
  note: Note,
  {
    moveRemoteDirectory,
    sourceDirectory,
    sourceFolder,
    targetDirectory,
    targetFolder,
  }: {
    moveRemoteDirectory: boolean
    sourceDirectory: string
    sourceFolder: string
    targetDirectory: string
    targetFolder: string
  },
) {
  if (!note.remotePath) return note
  const logicalPathAffected = note.folder === sourceFolder || note.folder?.startsWith(`${sourceFolder} / `)
  const physicalSourceAffected = Boolean(note.previousRemotePath
    && (note.previousRemotePath === sourceDirectory || note.previousRemotePath.startsWith(`${sourceDirectory}/`)))
  if (!logicalPathAffected && !physicalSourceAffected) return note
  const remotePath = logicalPathAffected
    ? replaceStoragePathPrefix(note.remotePath, sourceDirectory, targetDirectory)
    : note.remotePath
  // previousRemotePath 是下一次文件级操作真正访问的物理源；只有目录确实会远端 MOVE 时才随子树迁移。
  const previousRemotePath = moveRemoteDirectory && physicalSourceAffected && note.previousRemotePath
    ? replaceStoragePathPrefix(note.previousRemotePath, sourceDirectory, targetDirectory)
    : note.previousRemotePath
  return {
    ...note,
    editorSessionKey: note.editorSessionKey ?? note.id,
    folder: logicalPathAffected ? replaceFolderPrefix(note.folder!, sourceFolder, targetFolder) : note.folder,
    id: logicalPathAffected ? `webdav:${remotePath}` : note.id,
    previousRemotePath,
    remotePath,
  }
}

export function remapWebDavTrashForDirectory(
  entries: readonly TrashEntry[],
  options: Parameters<typeof remapWebDavNoteForDirectory>[1],
) {
  return entries.map((entry) => {
    if (entry.source !== "webdav") return entry
    const notes = entry.notes.map((note) => remapWebDavNoteForDirectory(note, options))
    const originalPath = entry.originalPath.startsWith("/")
      ? replaceStoragePathPrefix(entry.originalPath, options.sourceDirectory, options.targetDirectory)
      : replaceFolderPrefix(entry.originalPath, options.sourceFolder, options.targetFolder)
    return {
      ...entry,
      folderPath: entry.folderPath
        ? replaceFolderPrefix(entry.folderPath, options.sourceFolder, options.targetFolder)
        : entry.folderPath,
      notes,
      originalPath,
    }
  })
}

export function resolvePendingFolderMoveSourcePath(
  path: string,
  moves: readonly { sourceFolder: string; targetFolder: string }[],
  toStorageDirectory: (folder: string) => string,
) {
  let resolved = path
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    const move = moves[index]
    const source = toStorageDirectory(move.sourceFolder)
    const target = toStorageDirectory(move.targetFolder)
    if (resolved === target || resolved.startsWith(`${target}/`)) resolved = `${source}${resolved.slice(target.length)}`
  }
  return resolved
}

export function createFolderRenamePlan({
  directories,
  pendingDirectories,
  requestedName,
  sourceFolder,
}: {
  directories: readonly string[]
  pendingDirectories: readonly string[]
  requestedName: string
  sourceFolder: string
}): FolderRenamePlan | null {
  const sourceSegments = splitFolderPath(sourceFolder)
  const safeName = sanitizeFolderSegment(requestedName)
  if (sourceSegments.length === 0 || !safeName) return null
  const targetFolder = [...sourceSegments.slice(0, -1), safeName].join(" / ")
  if (targetFolder === sourceFolder) {
    return { sourceFolder, targetFolder, directories: [...directories], pendingDirectories: [...pendingDirectories] }
  }

  const sourcePaths = new Set(directories.filter((path) => path === sourceFolder || path.startsWith(`${sourceFolder} / `)))
  // 目标路径只要与源子树之外的目录相撞就拒绝，避免远端 MOVE 合并两个目录。
  const occupied = new Set(directories.filter((path) => !sourcePaths.has(path)))
  const renamedDirectories = directories.map((path) => replaceFolderPrefix(path, sourceFolder, targetFolder))
  if (directories.some((path, index) => sourcePaths.has(path) && occupied.has(renamedDirectories[index]))) return null

  return {
    sourceFolder,
    targetFolder,
    directories: [...new Set(renamedDirectories)],
    pendingDirectories: [...new Set(pendingDirectories.map((path) => replaceFolderPrefix(path, sourceFolder, targetFolder)))],
  }
}

export function getFolderRenameTarget(
  noteFolder: string | undefined,
  sourceFolder: string,
  requestedName: string,
  filename: string,
): FolderRenameTarget | null {
  if (!noteFolder || (noteFolder !== sourceFolder && !noteFolder.startsWith(`${sourceFolder} / `))) return null
  const safeName = sanitizeFolderSegment(requestedName)
  if (!safeName) return null
  const sourceSegments = splitFolderPath(sourceFolder)
  const suffix = splitFolderPath(noteFolder).slice(sourceSegments.length)
  const targetSegments = [...sourceSegments.slice(0, -1), safeName, ...suffix]
  return {
    folder: targetSegments.join(" / "),
    relativePath: [...targetSegments, filename].join("/"),
  }
}

function splitFolderPath(path: string) {
  return path.split(/\s*\/\s*/).filter(Boolean)
}

function sanitizeFolderSegment(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "-")
}
import type { TrashEntry } from "@/services/trash/trash-entry"
import type { Note } from "@/types/note"
