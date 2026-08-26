import type { VaultAttachmentCacheEntry } from "@/services/cache/vault-cache"
import { resolveVaultAssetPath } from "@/services/vault/vault-path"
import type { Note } from "@/types/note"

const MARKDOWN_LINK_PATTERN = /!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
const HYBRID_IMAGE_PATTERN = /!\[\[[^\]]+\]\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
const OBSIDIAN_EMBED_PATTERN = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\](?!\()/g

export type AttachmentMaintenanceReport = {
  bytes: number
  entries: VaultAttachmentCacheEntry[]
  orphaned: VaultAttachmentCacheEntry[]
  referenced: VaultAttachmentCacheEntry[]
  scanComplete: boolean
}

export function inspectCachedAttachments(
  notes: readonly Note[],
  entries: readonly VaultAttachmentCacheEntry[],
): AttachmentMaintenanceReport {
  const referencedPaths = new Set<string>()
  const scanComplete = notes.every((note) => note.contentLoaded)
  for (const note of notes) {
    if (!note.contentLoaded) continue
    const notePath = note.remotePath ?? note.id.replace(/^webdav:/, "")
    for (const source of extractAttachmentSources(note.content)) {
      const resolved = resolveVaultAssetPath(notePath, source)
      if (resolved) referencedPaths.add(normalizePath(resolved))
    }
  }

  const referenced: VaultAttachmentCacheEntry[] = []
  const orphaned: VaultAttachmentCacheEntry[] = []
  for (const entry of entries) {
    // 尚未上传的队列项即使正文暂未落盘也不能自动清理，否则会破坏离线编辑。
    if (!scanComplete || entry.status !== "synced" || referencedPaths.has(normalizePath(entry.path))) referenced.push(entry)
    else orphaned.push(entry)
  }
  return {
    bytes: entries.reduce((total, entry) => total + entry.data.byteLength, 0),
    entries: [...entries],
    orphaned,
    referenced,
    scanComplete,
  }
}

export function extractAttachmentSources(content: string) {
  const sources: string[] = []
  for (const pattern of [HYBRID_IMAGE_PATTERN, MARKDOWN_LINK_PATTERN, OBSIDIAN_EMBED_PATTERN]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content))) sources.push(match[1])
  }
  return sources
}

function normalizePath(path: string) {
  return path.replace(/^\/+/, "").replace(/\\/g, "/")
}
