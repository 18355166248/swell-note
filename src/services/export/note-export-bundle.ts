import { strToU8, zipSync } from "fflate"

import { resolveVaultAssetPath } from "@/services/vault/vault-path"
import type { VaultAsset } from "@/services/vault/vault-adapter"

export type NoteExportBundleResult = {
  archive: Uint8Array
  attachmentCount: number
  externalLinks: string[]
  missingAttachments: string[]
  reportPath: string
}

const bareExternalPattern = /\b(?:https?:\/\/|mailto:)[^\s<>)\]]+/gi
const wikiEmbedPattern = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\](?!\()/g

export function collectNoteExportReferences(content: string) {
  const visibleContent = withoutFencedCode(content).replace(/`[^`\n]*`/g, "")
  const destinations = extractMarkdownDestinations(visibleContent)
  const wikiEmbeds = [...visibleContent.matchAll(wikiEmbedPattern)].map((match) => match[1])
  const externalLinks = [...new Set([
    ...destinations.filter((source) => /^[a-z][a-z\d+.-]*:/i.test(source)),
    ...[...visibleContent.matchAll(bareExternalPattern)].map((match) => match[0].replace(/[.,;!?，。；！？]+$/, "")),
  ])]
  const attachmentSources = [...new Set([...wikiEmbeds, ...destinations]
    .filter((source) => !source.startsWith("#") && !source.startsWith("//")
      && !/^[a-z][a-z\d+.-]*:/i.test(source) && !/\.md(?:[?#]|$)/i.test(source)))]
  return { attachmentSources, externalLinks }
}

function withoutFencedCode(content: string) {
  let fence = ""
  return content.split("\n").map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? "" : marker
      return ""
    }
    return fence ? "" : line
  }).join("\n")
}

function extractMarkdownDestinations(content: string) {
  const sources: string[] = []
  for (let start = content.indexOf("]("); start >= 0; start = content.indexOf("](", start + 2)) {
    let depth = 0
    let end = start + 2
    for (; end < content.length; end += 1) {
      if (content[end] === "\\") { end += 1; continue }
      if (content[end] === "(") depth += 1
      if (content[end] === ")") {
        if (depth === 0) break
        depth -= 1
      }
    }
    if (end >= content.length) continue
    const body = content.slice(start + 2, end).trim()
    const source = body.startsWith("<")
      ? body.indexOf(">") > 0 ? body.slice(1, body.indexOf(">")) : ""
      : body.replace(/\s+["'][^"']*["']\s*$/, "")
    if (source) sources.push(source.replace(/\\([() ])/g, "$1"))
  }
  return sources
}

export async function createNoteExportBundle({ content, notePath, readAsset }: {
  content: string
  notePath: string
  readAsset: (displayPath: string) => Promise<VaultAsset | null>
}): Promise<NoteExportBundleResult> {
  const safeNotePath = safeArchivePath(notePath)
  if (!safeNotePath || !/\.md$/i.test(safeNotePath)) throw new Error("当前笔记路径不适合打包导出")
  const archive: Record<string, Uint8Array> = { [safeNotePath]: strToU8(content) }
  const { attachmentSources, externalLinks } = collectNoteExportReferences(content)
  const missingAttachments: string[] = []
  const added = new Set<string>()

  for (const source of attachmentSources) {
    // 先用 Vault 相对路径解析器挡住越界和外链，再校验 ZIP 条目名；不允许下载库外文件。
    const resolved = resolveVaultAssetPath(safeNotePath, source)
    const path = resolved && safeArchivePath(resolved)
    if (!path) {
      missingAttachments.push(`${source}（路径无效或越过笔记库）`)
      continue
    }
    if (added.has(path)) continue
    added.add(path)
    try {
      const asset = await readAsset(path)
      if (asset) archive[path] = asset.data
      else missingAttachments.push(`${source}（未找到附件）`)
    } catch (error) {
      missingAttachments.push(`${source}（读取失败：${error instanceof Error ? error.message : "未知错误"}）`)
    }
  }

  let reportPath = "导出清单.txt"
  for (let index = 2; archive[reportPath]; index += 1) reportPath = `导出清单-${index}.txt`
  archive[reportPath] = strToU8([
    `笔记：${safeNotePath}`,
    `已包含附件：${Object.keys(archive).length - 1} 个`,
    "",
    "外部链接（保持原样，离线时可能无法访问）：",
    ...(externalLinks.length ? externalLinks : ["无"]),
    "",
    "未包含的附件：",
    ...(missingAttachments.length ? missingAttachments : ["无"]),
  ].join("\n"))

  return {
    archive: zipSync(archive, { level: 6 }),
    attachmentCount: Object.keys(archive).length - 2,
    externalLinks,
    missingAttachments,
    reportPath,
  }
}

function safeArchivePath(value: string) {
  const normalized = value.replace(/\\/g, "/")
  const segments = normalized.split("/")
  if (!normalized || normalized.startsWith("/") || segments.some((segment) =>
    !segment || segment === "." || segment === ".." || /[\u0000-\u001f]/.test(segment))) return null
  return normalized
}
