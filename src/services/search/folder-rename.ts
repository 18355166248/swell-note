export type FolderRenameTarget = {
  folder: string
  relativePath: string
}

export function getFolderRenameTarget(
  noteFolder: string | undefined,
  sourceFolder: string,
  requestedName: string,
  filename: string,
): FolderRenameTarget | null {
  if (!noteFolder || (noteFolder !== sourceFolder && !noteFolder.startsWith(`${sourceFolder} / `))) return null
  const safeName = requestedName.trim().replace(/[\\/:*?"<>|]/g, "-")
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
