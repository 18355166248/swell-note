import { markdownLanguage } from "@codemirror/lang-markdown"
import { collectMarkdownDefinitions, markdownDestination, resolveMarkdownReference } from "@/services/markdown/markdown-reference-links"
import type { VaultAttachmentCacheEntry } from "@/services/cache/vault-cache"
import { resolveVaultAssetPath } from "@/services/vault/vault-path"
import type { Note } from "@/types/note"

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
  return extractAttachmentReferences(content).map((reference) => reference.source)
}

export function extractAttachmentReferences(content: string) {
  const references: Array<{ source: string; obsidianEmbed: boolean; embedded: boolean }> = []
  const tree = markdownLanguage.parser.parse(content)
  const definitions = collectMarkdownDefinitions(content, tree)
  // 以语法树识别标准链接，代码示例、未使用定义不会误触发下载或保住无关附件。
  tree.iterate({ enter(node) {
    if (node.name !== "Link" && node.name !== "Image") return
    const url = node.node.getChild("URL")
    const reference = !url ? resolveMarkdownReference(node.node, (from, to) => content.slice(from, to), definitions) : undefined
    const source = url ? markdownDestination(content.slice(url.from, url.to)) : reference?.source
    if (source) references.push({ source, obsidianEmbed: false, embedded: node.name === "Image" })
  } })
  for (const match of content.matchAll(OBSIDIAN_EMBED_PATTERN)) {
    const position = match.index ?? 0
    let inCode = false
    for (let node = tree.resolveInner(position, 1); node; node = node.parent!) {
      if (["InlineCode", "FencedCode", "CodeBlock", "HTMLBlock"].includes(node.name)) { inCode = true; break }
    }
    if (!inCode) references.push({ source: match[1], obsidianEmbed: true, embedded: true })
  }
  return references
}

function normalizePath(path: string) {
  return path.replace(/^\/+/, "").replace(/\\/g, "/")
}
