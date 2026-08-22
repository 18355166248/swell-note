import type { VaultAdapter, VaultFileEntry } from "@/services/vault/vault-adapter"

export type IndexedVaultFile = {
  outgoingLinks: string[]
  path: string
  searchText: string
}

const wikiLinkPattern = /\[\[([^\]]+)\]\]/g

export function normalizeNoteTarget(value: string) {
  const withoutAlias = value.split("|", 1)[0]
  const withoutHeading = withoutAlias.split("#", 1)[0]
  const segments = withoutHeading.replace(/\\/g, "/").split("/").filter(Boolean)
  return (segments[segments.length - 1] ?? "")
    .replace(/\.md$/i, "")
    .trim()
    .toLocaleLowerCase()
}

export function extractWikiLinks(content: string) {
  const links = new Set<string>()
  for (const match of content.matchAll(wikiLinkPattern)) {
    const target = normalizeNoteTarget(match[1])
    if (target) links.add(target)
  }
  return [...links]
}

export async function indexVaultFiles(
  adapter: VaultAdapter,
  files: VaultFileEntry[],
  onBatch: (batch: IndexedVaultFile[], indexed: number, total: number) => void,
  isCancelled: () => boolean,
  options: { batchSize?: number; delayMs?: number } = {},
) {
  const batchSize = Math.max(1, options.batchSize ?? 6)
  let indexed = 0

  // 小批量并发兼顾大目录速度与磁盘压力；每批回传一次，避免逐文件触发 React 重渲染。
  for (let offset = 0; offset < files.length; offset += batchSize) {
    if (isCancelled()) return
    const batchFiles = files.slice(offset, offset + batchSize)
    const batch = (await Promise.all(batchFiles.map(async (file) => {
      try {
        const document = await adapter.readTextFile(file.path)
        return {
          outgoingLinks: extractWikiLinks(document.content),
          path: file.path,
          searchText: document.content.toLocaleLowerCase(),
        }
      } catch {
        return null
      }
    }))).filter((item): item is IndexedVaultFile => item !== null)

    indexed += batchFiles.length
    if (!isCancelled()) onBatch(batch, indexed, files.length)
    if (options.delayMs && offset + batchSize < files.length && !isCancelled()) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    }
  }
}
