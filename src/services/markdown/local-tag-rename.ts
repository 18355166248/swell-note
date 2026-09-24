import type { Note } from "@/types/note"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { renameNoteTag } from "./note-tags"

export type TagRenameReport = {
  issues: string[]
  renamed: number
}

export async function renameTagInLocalVault({
  adapter,
  hasPendingSave,
  notes,
  onBeforeWrite,
  onRenamed,
  shouldContinue,
  source,
  target,
}: {
  adapter: VaultAdapter
  hasPendingSave: (noteId: string) => boolean
  notes: readonly Note[]
  onBeforeWrite?: (note: Note, content: string) => Promise<void>
  onRenamed: (note: Note, content: string, revision: string | undefined) => void
  shouldContinue?: () => boolean
  source: string
  target: string
}): Promise<TagRenameReport> {
  if (adapter.kind === "webdav" || adapter.readOnly || !adapter.writeTextFile) {
    throw new Error("当前笔记库不支持本地批量标签重命名")
  }
  const issues: string[] = []
  let renamed = 0
  for (const note of notes) {
    if (shouldContinue && !shouldContinue()) {
      issues.push("笔记库已切换，后续笔记未处理")
      break
    }
    if (!note.tags?.some((tag) => tag.toLocaleLowerCase() === source.toLocaleLowerCase())) continue
    if (!note.remotePath || note.readOnly || note.format === "canvas" || hasPendingSave(note.id)) {
      issues.push(`${note.title}：只读、缺少路径或仍在保存，已跳过`)
      continue
    }
    try {
      const document = await adapter.readTextFile(note.remotePath)
      if (shouldContinue && !shouldContinue()) {
        issues.push("笔记库已切换，后续笔记未处理")
        break
      }
      // 批量操作以磁盘最新版为准；编辑器里若有尚未落盘的修改，不能用旧正文覆盖它。
      if (note.contentLoaded && note.content !== document.content) {
        issues.push(`${note.title}：编辑器正文与磁盘不同，已跳过`)
        continue
      }
      const content = renameNoteTag(document.content, source, target)
      if (content === document.content) {
        issues.push(`${note.title}：磁盘文件已无此标签，已跳过`)
        continue
      }
      await onBeforeWrite?.(note, document.content)
      if (shouldContinue && !shouldContinue()) {
        issues.push("笔记库已切换，后续笔记未处理")
        break
      }
      const result = await adapter.writeTextFile(note.remotePath, content, document.revision)
      renamed += 1
      onRenamed(note, content, result.revision)
    } catch (error) {
      issues.push(`${note.title}：${error instanceof Error ? error.message : "重命名失败"}`)
    }
  }
  return { issues, renamed }
}
