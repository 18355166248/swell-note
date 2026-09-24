import type { ParsedVaultBackup } from "./vault-backup"

export type VaultRestorePreview = {
  backup: ParsedVaultBackup
  cacheId: string
  existingNotePaths: string[]
  fileName: string
  sourceKind: "local" | "webdav"
}

export type VaultRestoreResult = {
  interrupted: boolean
  issues: string[]
  restoredAttachments: number
  restoredNotes: number
}

export function inspectVaultRestore({
  backup,
  cacheId,
  existingPaths,
  fileName,
  resolveStoragePath,
  sourceKind,
}: {
  backup: ParsedVaultBackup
  cacheId: string
  existingPaths: readonly string[]
  fileName: string
  resolveStoragePath: (displayPath: string) => string
  sourceKind: VaultRestorePreview["sourceKind"]
}): VaultRestorePreview {
  const reserved = new Set(existingPaths.map((path) => path.replace(/\\/g, "/").toLocaleLowerCase()))
  return {
    backup,
    cacheId,
    existingNotePaths: backup.notes
      .filter((note) => reserved.has(resolveStoragePath(note.path).replace(/\\/g, "/").toLocaleLowerCase()))
      .map((note) => note.path),
    fileName,
    sourceKind,
  }
}
