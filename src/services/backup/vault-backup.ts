import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"

const MANIFEST_PATH = "swell-note-backup.json"
const ARCHIVE_ROOT = "vault/"
const MAX_ARCHIVE_FILES = 10_000
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024

export type VaultBackupFile = {
  data: Uint8Array
  mimeType?: string
  path: string
}

export type VaultBackupManifest = {
  attachmentCount: number
  createdAt: string
  format: "swell-note-vault"
  label: string
  noteCount: number
  version: 1
}

export type ParsedVaultBackup = {
  attachments: VaultBackupFile[]
  manifest: VaultBackupManifest
  notes: Array<{ content: string; path: string }>
}

export function createVaultBackup({
  attachments,
  label,
  notes,
}: {
  attachments: readonly VaultBackupFile[]
  label: string
  notes: ReadonlyArray<{ content: string; path: string }>
}) {
  const archive: Record<string, Uint8Array> = {}
  const usedPaths = new Set<string>()
  for (const note of notes) {
    const path = safeRelativePath(note.path)
    if (!path || usedPaths.has(path)) continue
    usedPaths.add(path)
    archive[`${ARCHIVE_ROOT}${path}`] = strToU8(note.content)
  }
  for (const attachment of attachments) {
    const path = safeRelativePath(attachment.path)
    if (!path || usedPaths.has(path)) continue
    usedPaths.add(path)
    archive[`${ARCHIVE_ROOT}${path}`] = attachment.data
  }
  const manifest: VaultBackupManifest = {
    attachmentCount: attachments.length,
    createdAt: new Date().toISOString(),
    format: "swell-note-vault",
    label,
    noteCount: notes.length,
    version: 1,
  }
  archive[MANIFEST_PATH] = strToU8(JSON.stringify(manifest, null, 2))
  return zipSync(archive, { level: 6 })
}

export function parseVaultBackup(data: Uint8Array): ParsedVaultBackup {
  let declaredFiles = 0
  let declaredBytes = 0
  const archive = unzipSync(data, {
    filter: (file) => {
      declaredFiles += 1
      declaredBytes += file.originalSize
      if (declaredFiles > MAX_ARCHIVE_FILES) throw new Error(`备份包含超过 ${MAX_ARCHIVE_FILES} 个文件，已拒绝导入`)
      if (declaredBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("备份解压后超过 512 MB，已拒绝导入")
      if (file.name !== MANIFEST_PATH && !file.name.startsWith(ARCHIVE_ROOT)) {
        throw new Error(`备份包含非法路径：${file.name}`)
      }
      const relative = file.name.slice(ARCHIVE_ROOT.length).replace(/\/$/, "")
      if (file.name !== MANIFEST_PATH && (!safeRelativePath(relative) || `${ARCHIVE_ROOT}${safeRelativePath(relative)}${file.name.endsWith("/") ? "/" : ""}` !== file.name)) {
        throw new Error(`备份包含非法路径：${file.name}`)
      }
      return true
    },
  })
  const entries = Object.entries(archive)
  if (entries.length > MAX_ARCHIVE_FILES) throw new Error(`备份包含超过 ${MAX_ARCHIVE_FILES} 个文件，已拒绝导入`)
  const totalBytes = entries.reduce((total, [, value]) => total + value.byteLength, 0)
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("备份解压后超过 512 MB，已拒绝导入")

  const manifestData = archive[MANIFEST_PATH]
  if (!manifestData) throw new Error("不是有效的 Swell Note 整库备份：缺少 manifest")
  let manifest: VaultBackupManifest
  try {
    manifest = JSON.parse(strFromU8(manifestData)) as VaultBackupManifest
  } catch {
    throw new Error("备份 manifest 无法解析")
  }
  if (manifest.format !== "swell-note-vault" || manifest.version !== 1) {
    throw new Error("备份格式或版本暂不受支持")
  }

  const notes: ParsedVaultBackup["notes"] = []
  const attachments: VaultBackupFile[] = []
  for (const [archivePath, value] of entries) {
    if (archivePath === MANIFEST_PATH || archivePath.endsWith("/")) continue
    if (!archivePath.startsWith(ARCHIVE_ROOT)) throw new Error(`备份包含非法路径：${archivePath}`)
    const path = safeRelativePath(archivePath.slice(ARCHIVE_ROOT.length))
    if (!path || `${ARCHIVE_ROOT}${path}` !== archivePath) throw new Error(`备份包含非法路径：${archivePath}`)
    if (/\.(?:canvas|md)$/i.test(path)) notes.push({ content: strFromU8(value), path })
    else attachments.push({ data: value, mimeType: mimeTypeFromPath(path), path })
  }
  return { attachments, manifest, notes }
}

export function backupFilename(label: string, date = new Date()) {
  const safeLabel = label.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/[-\s]+/g, "-").replace(/^-+|-+$/g, "") || "vault"
  return `${safeLabel}-${date.toISOString().slice(0, 10)}.swell.zip`
}

function safeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "")
  const segments = normalized.split("/")
  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) return ""
  return segments.join("/")
}

function mimeTypeFromPath(path: string) {
  const extension = path.split(".").pop()?.toLocaleLowerCase()
  return extension === "png" ? "image/png"
    : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
      : extension === "gif" ? "image/gif"
        : extension === "webp" ? "image/webp"
          : extension === "svg" ? "image/svg+xml"
            : extension === "pdf" ? "application/pdf"
              : undefined
}
