import { extractAttachmentSources } from "@/services/vault/attachment-maintenance"
import { resolveVaultAssetPath } from "@/services/vault/vault-path"
import type { VaultBackupFile } from "./vault-backup"

export type BackupSourceNote = {
  content?: string
  id: string
  path: string
  requiresLocalContent?: boolean
  storagePath: string
}

export type BackupSourceAttachment = VaultBackupFile & { storagePath: string }

export type BackupIssue = {
  kind: "note" | "attachment"
  path: string
  reason: string
}

export async function collectBackupInventory({
  cachedAttachments,
  loadAttachment,
  loadNote,
  notes,
  toBackupPath,
}: {
  cachedAttachments: readonly BackupSourceAttachment[]
  loadAttachment?: (storagePath: string) => Promise<Pick<VaultBackupFile, "data" | "mimeType">>
  loadNote?: (note: BackupSourceNote) => Promise<string>
  notes: readonly BackupSourceNote[]
  toBackupPath: (storagePath: string) => string
}) {
  const issues: BackupIssue[] = []
  const includedNotes: Array<{ content: string; path: string; storagePath: string }> = []
  for (const note of notes) {
    if (!note.storagePath) {
      issues.push({ kind: "note", path: note.path || note.id, reason: "缺少 Vault 路径" })
      continue
    }
    let content = note.content
    if (content === undefined) {
      try {
        // 未同步修改只能从工作副本备份；回源读取会得到旧正文，却误报为完整备份。
        if (note.requiresLocalContent) throw new Error("未同步正文不在当前缓存中，不能用远端旧版本代替")
        if (!loadNote) throw new Error("当前离线缓存没有正文，且无法读取来源")
        content = await loadNote(note)
      } catch (error) {
        issues.push({ kind: "note", path: note.path, reason: error instanceof Error ? error.message : "正文读取失败" })
        continue
      }
    }
    includedNotes.push({ content, path: note.path, storagePath: note.storagePath })
  }

  const attachmentsByPath = new Map(cachedAttachments.map((entry) => [entry.storagePath, entry]))
  const attemptedPaths = new Set<string>()
  for (const note of includedNotes) {
    for (const source of extractAttachmentSources(note.content)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith("//") || source.startsWith("#")) continue
      const storagePath = resolveVaultAssetPath(note.storagePath, source)
      if (!storagePath) {
        issues.push({ kind: "attachment", path: `${note.path} → ${source}`, reason: "附件路径无法解析" })
        continue
      }
      if (/\.(?:canvas|md)$/i.test(storagePath) || attachmentsByPath.has(storagePath) || attemptedPaths.has(storagePath)) continue
      attemptedPaths.add(storagePath)
      try {
        if (!loadAttachment) throw new Error("当前离线缓存没有附件，且无法读取来源")
        const asset = await loadAttachment(storagePath)
        attachmentsByPath.set(storagePath, { ...asset, path: toBackupPath(storagePath), storagePath })
      } catch (error) {
        issues.push({ kind: "attachment", path: toBackupPath(storagePath), reason: error instanceof Error ? error.message : "附件读取失败" })
      }
    }
  }

  return {
    attachments: [...attachmentsByPath.values()].map(({ data, mimeType, path }) => ({ data, mimeType, path })),
    issues,
    notes: includedNotes.map(({ content, path }) => ({ content, path })),
  }
}
