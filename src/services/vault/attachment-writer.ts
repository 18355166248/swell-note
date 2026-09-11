import {
  buildAttachmentHref,
  buildAttachmentMarkdown,
  buildAttachmentFileName,
  buildAttachmentVaultPath,
  isImageAttachment,
  MAX_ATTACHMENT_BYTES,
} from "@/services/vault/attachment-path"
import type { VaultAdapter, VaultCreateResult } from "@/services/vault/vault-adapter"

const MAX_NAME_ATTEMPTS = 5

export type AttachmentSource = {
  arrayBuffer(): Promise<ArrayBuffer>
  name: string
  size: number
  type: string
}

export type AttachmentWriteResult = {
  errors: string[]
  markdown: string
}

export type AttachmentWriter = {
  createBinaryFile?(path: string, data: Uint8Array, mimeType?: string): Promise<VaultCreateResult>
  getDisplayPath?(path: string): string
  getStoragePath?(displayPath: string): string
}

export function canWriteVaultAttachments(adapter: VaultAdapter | null | undefined) {
  return Boolean(adapter?.createBinaryFile && !adapter.readOnly)
}

// 迟到的附件插入（切笔记/切阅读模式后）回退为追加到笔记末尾：块级 Markdown 与既有正文
// 之间必须有空行。末行是普通段落时直接拼接会粘进同一段；末行是表格行时少一个空行
// 会被 GFM 并进表格，图片看似丢失。
export function appendBlockMarkdown(content: string, markdown: string) {
  if (!content) return markdown
  if (content.endsWith("\n\n")) return content + markdown
  if (content.endsWith("\n")) return `${content}\n${markdown}`
  return `${content}\n\n${markdown}`
}

export async function writeVaultAttachments(
  adapter: AttachmentWriter,
  notePath: string,
  sources: readonly AttachmentSource[],
): Promise<AttachmentWriteResult> {
  const errors: string[] = []
  const snippets: string[] = []

  // 附件逐个写入：坚果云等远端对并发敏感，本地写盘也需要按顺序确认重名，避免同一秒互相覆盖。
  for (const source of sources) {
    if (source.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`${source.name} 超过 ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB，未插入`)
      continue
    }

    try {
      const data = new Uint8Array(await source.arrayBuffer())
      const written = await createAttachmentFile(adapter, source, data)
      const image = isImageAttachment(source.type, source.name)
      const href = buildAttachmentHref(
        adapter.getDisplayPath?.(notePath) ?? notePath,
        adapter.getDisplayPath?.(written.path) ?? written.path,
      )
      snippets.push(buildAttachmentMarkdown(source.name || "附件", href, image))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `写入附件失败：${source.name}`)
    }
  }

  return { errors, markdown: snippets.length > 0 ? `${snippets.join("\n\n")}\n` : "" }
}

async function createAttachmentFile(
  adapter: AttachmentWriter,
  source: AttachmentSource,
  data: Uint8Array,
) {
  if (!adapter.createBinaryFile) throw new Error("当前笔记库不支持写入附件")
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const fileName = buildAttachmentFileName({
      duplicateIndex: attempt,
      fileName: source.name,
      mimeType: source.type,
    })
    const displayPath = buildAttachmentVaultPath(fileName)
    const storagePath = adapter.getStoragePath?.(displayPath) ?? displayPath
    try {
      return await adapter.createBinaryFile!(storagePath, data, source.type || undefined)
    } catch (error) {
      // 同名文件只在同一秒重复上传时出现，换序号重试；其他失败立即上报。
      if (!isDuplicateNameError(error)) throw error
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`附件重名，未能写入：${source.name}`)
}

function isDuplicateNameError(error: unknown) {
  return error instanceof Error && error.message.includes("已存在")
}
