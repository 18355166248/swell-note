import type { VaultAdapter, VaultFileEntry } from "@/services/vault/vault-adapter"

export type IndexedVaultFile = {
  content: string
  frontmatter: Record<string, string | string[]>
  outgoingLinks: string[]
  path: string
  revision: string | undefined
  searchText: string
  tags: string[]
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

export function extractFrontmatter(content: string) {
  const properties: Record<string, string | string[]> = {}
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { properties, tags: [] as string[] }

  const lines = match[1].split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const property = lines[index].match(/^([\w-]+):\s*(.*)$/)
    if (!property) continue
    const [, key, rawValue] = property
    if (!rawValue) {
      const values: string[] = []
      while (lines[index + 1]?.match(/^\s+-\s+/)) {
        index += 1
        values.push(cleanFrontmatterValue(lines[index].replace(/^\s+-\s+/, "")))
      }
      properties[key] = values
      continue
    }
    properties[key] = rawValue.startsWith("[") && rawValue.endsWith("]")
      ? rawValue.slice(1, -1).split(",").map(cleanFrontmatterValue).filter(Boolean)
      : cleanFrontmatterValue(rawValue)
  }

  const rawTags = properties.tags ?? properties.tag ?? []
  const tags = (Array.isArray(rawTags) ? rawTags : rawTags.split(/[ ,]+/))
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean)
  return { properties, tags: [...new Set(tags)] }
}

function cleanFrontmatterValue(value: string) {
  return value.trim().replace(/^["']|["']$/g, "")
}

export async function indexVaultFiles(
  adapter: VaultAdapter,
  files: VaultFileEntry[],
  onBatch: (batch: IndexedVaultFile[], indexed: number, total: number) => void | Promise<void>,
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
        const frontmatter = extractFrontmatter(document.content)
        return {
          content: document.content,
          frontmatter: frontmatter.properties,
          outgoingLinks: extractWikiLinks(document.content),
          path: file.path,
          revision: document.revision,
          searchText: `${document.content} ${frontmatter.tags.join(" ")}`.toLocaleLowerCase(),
          tags: frontmatter.tags,
        }
      } catch {
        return null
      }
    }))).filter((item): item is IndexedVaultFile => item !== null)

    indexed += batchFiles.length
    if (!isCancelled()) await onBatch(batch, indexed, files.length)
    if (options.delayMs && offset + batchSize < files.length && !isCancelled()) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    }
  }
}
