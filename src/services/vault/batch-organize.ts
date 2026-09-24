import type { Note } from "@/types/note"
import type { VaultAdapter } from "./vault-adapter"
import type { TrashEntry } from "@/services/trash/trash-entry"
import { buildLocalTrashPath, createTrashId } from "@/services/trash/trash-entry"
import { extractFrontmatter } from "@/services/search/note-index"
import { parseEditableTags, setNoteTags } from "@/services/markdown/note-tags"
import { rewriteMarkdownLinksForMoves } from "@/services/markdown/markdown-link-rewrite"
import { indexNoteContent } from "@/services/app/app-note-utils"
import { buildNotePreview } from "@/services/markdown/note-preview"

export type BatchOrganizeAction =
  | { kind: "move"; folder: string | null }
  | { kind: "delete" }
  | { kind: "add-tags" | "remove-tags"; tags: string[] }

export type BatchOrganizeReport = { succeededIds: string[]; issues: string[] }
export type BatchOrganizeState = { notes: Note[]; trash: TrashEntry[]; activeNoteId: string }

export function batchWebDavPath(notes: readonly Note[], displayPath: string) {
  // 离线切换缓存后，全局连接设置可能属于另一个库；移动路径必须从当前笔记库推导。
  const roots = new Set(notes.flatMap((note) => {
    if (!note.remotePath || note.pendingOperation === "delete") return []
    const folder = note.folder && note.folder !== "根目录" ? note.folder.split(/\s*\/\s*/).join("/") : ""
    const suffix = `${folder ? `${folder}/` : ""}${note.remotePath.split("/").pop()}`
    return note.remotePath.endsWith(suffix) ? [note.remotePath.slice(0, -suffix.length)] : []
  }))
  if (roots.size !== 1) throw new Error("无法确认当前离线库的根目录，请重新连接笔记库后移动")
  return `${[...roots][0]}${displayPath}`
}

export function changeBatchTags(content: string, action: Extract<BatchOrganizeAction, { tags: string[] }>) {
  const existing = extractFrontmatter(content).tags
  const requested = parseEditableTags(action.tags.join(","))
  if (!requested.length) throw new Error("请输入至少一个标签")
  const remove = new Set(requested.map((tag) => tag.toLocaleLowerCase()))
  return setNoteTags(content, parseEditableTags((action.kind === "add-tags"
    ? [...existing, ...requested]
    : existing.filter((tag) => !remove.has(tag.toLocaleLowerCase()))).join(",")))
}

// 每篇独立提交、串行执行：部分失败不回滚已完成的文件，也不把失败项显示为成功。
// WebDAV 只持久化工作副本；上传继续交给既有 ETag 同步队列。
export async function organizeNotes(input: {
  action: BatchOrganizeAction
  ids: readonly string[]
  initial: BatchOrganizeState
  adapter: VaultAdapter | null
  webdav: boolean
  resolvePath: (displayPath: string) => string
  blocked: (note: Note) => boolean
  isCurrent: () => boolean
  loadDocument: (note: Note) => Promise<{ content: string; baseContent?: string } | undefined>
  beforeWrite: (note: Note, content: string) => Promise<void>
  commit: (state: BatchOrganizeState) => Promise<void>
  progress?: (completed: number, total: number) => void
}): Promise<BatchOrganizeReport> {
  let state: BatchOrganizeState = { ...input.initial, notes: [...input.initial.notes], trash: [...input.initial.trash] }
  const report: BatchOrganizeReport = { succeededIds: [], issues: [] }
  const ids = [...new Set(input.ids)]
  const assertCurrent = () => { if (!input.isCurrent()) throw new Error("笔记库已切换，操作已停止") }
  const replace = (noteId: string, next: Note) => { state = { ...state, notes: state.notes.map((note) => note.id === noteId ? next : note) } }
  const changed = (note: Note, content: string, revision?: string): Note => ({
    ...note, ...indexNoteContent(content), content, contentLoaded: true, contentCached: true,
    preview: buildNotePreview(content, note.format), modifiedAt: Date.now(),
    revision: revision ?? note.revision, readOnly: false,
    localEditSequence: (note.localEditSequence ?? 0) + 1,
    ...(input.webdav ? { syncStatus: "modified" as const, syncError: undefined,
      writeContentAfterMove: note.pendingOperation === "move" ? true : note.writeContentAfterMove } : {}),
    updatedAt: input.webdav ? "批量整理 · 待同步" : "刚刚",
  })
  const read = async (note: Note) => {
    if (!input.webdav) {
      const document = await input.adapter!.readTextFile(note.remotePath!)
      assertCurrent()
      if (note.contentLoaded && document.content !== note.content) throw new Error("正文与磁盘不同，请重新加载后重试")
      return { ...document, baseContent: note.baseContent }
    }
    const document = note.contentLoaded ? { content: note.content, baseContent: note.baseContent } : await input.loadDocument(note)
    assertCurrent()
    if (!document) throw new Error("正文未缓存，请打开笔记后重试")
    return { ...document, revision: note.revision }
  }

  for (const [index, id] of ids.entries()) {
    const note = state.notes.find((candidate) => candidate.id === id)
    if (!input.isCurrent()) { report.issues.push("笔记库已切换，剩余项目未处理"); break }
    let didMutate = false
    try {
      if (!note?.remotePath || note.pendingOperation === "delete") throw new Error("笔记不存在或已在回收站")
      if (input.blocked(note) || note.syncStatus === "conflict" || (note.readOnly && (!input.webdav || note.contentLoaded))) {
        throw new Error("只读、未保存或存在冲突，请处理后重试")
      }
      if (!input.webdav && (!input.adapter || input.adapter.readOnly)) throw new Error("请先连接可写的本地笔记库")
      const document = await read(note)
      const loaded = { ...note, baseContent: document.baseContent, content: document.content, contentLoaded: true, contentCached: true }
      if (input.action.kind === "add-tags" || input.action.kind === "remove-tags") {
        if (note.format === "canvas") throw new Error("画布不支持 Markdown 标签")
        const content = changeBatchTags(document.content, input.action)
        if (content !== document.content) {
          await input.beforeWrite(note, document.content)
          assertCurrent()
          if (!input.webdav && !input.adapter!.writeTextFile) throw new Error("笔记库不支持修改")
          const written = input.webdav ? undefined : await input.adapter!.writeTextFile!(note.remotePath, content, document.revision)
          replace(id, changed(loaded, content, written?.revision))
          didMutate = true
        }
      } else if (input.action.kind === "delete") {
        const trashId = createTrashId()
        const trashedPath = input.webdav ? undefined : buildLocalTrashPath(trashId, note.remotePath)
        if (!input.webdav) {
          if (!input.adapter!.moveTextFile) throw new Error("笔记库不支持移入回收站")
          await input.adapter!.moveTextFile(note.remotePath, trashedPath!, document.revision)
        }
        didMutate = true
        state = { ...state, trash: [{ id: trashId, kind: "note", deletedAt: Date.now(), notes: [loaded],
          originalPath: note.remotePath, source: input.webdav ? "webdav" : "local", trashedPath }, ...state.trash] }
        if (!input.webdav || note.pendingOperation === "create") state = { ...state, notes: state.notes.filter((candidate) => candidate.id !== id) }
        else replace(id, { ...loaded, operationBeforeDelete: note.pendingOperation === "move" ? "move" : undefined,
          pendingOperation: "delete", previousRemotePath: note.previousRemotePath ?? note.remotePath,
          syncStatus: "modified", syncError: undefined, updatedAt: "已移入回收站 · 待同步" })
        if (state.activeNoteId === id) state = { ...state, activeNoteId: state.notes.find((candidate) => candidate.pendingOperation !== "delete")?.id ?? "" }
      } else if (input.action.kind === "move") {
        const filename = note.remotePath.split("/").pop()!
        const folder = input.action.folder?.split(/\s*\/\s*/).filter(Boolean).join("/") ?? ""
        if (folder.split("/").some((part) => part === "." || part === "..")) throw new Error("目标目录无效")
        const target = input.resolvePath(folder ? `${folder}/${filename}` : filename)
        if (target === note.remotePath) { report.succeededIds.push(id); continue }
        if (state.notes.some((candidate) => candidate.id !== id && [candidate.remotePath, candidate.previousRemotePath]
          .some((path) => path?.toLocaleLowerCase() === target.toLocaleLowerCase()))) throw new Error("目标目录存在同名笔记，已跳过")
        const move = { fromPath: note.remotePath, toPath: target }
        // 先收集可安全改写的链接；未保存或冲突笔记保持原状并明确报告。
        const repairs: { note: Note; content: string; original: string; baseContent?: string; revision?: string }[] = []
        for (const candidate of state.notes) {
          if (!candidate.remotePath || candidate.pendingOperation === "delete" || candidate.format === "canvas") continue
          if (input.blocked(candidate) || candidate.syncStatus === "conflict" || (!input.webdav && candidate.readOnly)) {
            report.issues.push(`${candidate.title}：未检查相对链接（只读、未保存或冲突）`); continue
          }
          try {
            const original = candidate.id === id ? document : await read(candidate)
            const result = rewriteMarkdownLinksForMoves(original.content, candidate.remotePath, [move])
            if (result.changedCount) repairs.push({ note: candidate, content: result.content, original: original.content, baseContent: original.baseContent, revision: original.revision })
          } catch (error) {
            // 自身正文已在上方读取；其他未缓存笔记不阻断移动，但结果中必须提示链接未检查。
            report.issues.push(`${candidate.title}：相对链接未检查，${error instanceof Error ? error.message : "读取失败"}`)
          }
        }
        assertCurrent()
        if (!input.webdav && !input.adapter!.moveTextFile) throw new Error("笔记库不支持移动")
        const moved = input.webdav ? { path: target, revision: note.revision }
          : await input.adapter!.moveTextFile!(note.remotePath, target, document.revision)
        didMutate = true
        const nextId = `${input.webdav ? "webdav" : input.adapter!.kind}:${moved.path}`
        replace(id, { ...loaded, id: nextId, editorSessionKey: note.editorSessionKey ?? id,
          readOnly: false, remotePath: moved.path, revision: moved.revision, folder: folder ? folder.split("/").join(" / ") : "根目录",
          ...(input.webdav ? { pendingOperation: note.pendingOperation === "create" ? "create" as const : "move" as const,
            previousRemotePath: note.pendingOperation === "create" ? undefined : note.previousRemotePath ?? note.remotePath,
            syncStatus: "modified" as const, writeContentAfterMove: true, syncError: undefined } : {}),
          updatedAt: input.webdav ? "已移动 · 待同步" : "刚刚移动" })
        if (state.activeNoteId === id) state = { ...state, activeNoteId: nextId }
        for (const repair of repairs) {
          try {
            await input.beforeWrite(repair.note, repair.original)
            assertCurrent()
            const currentId = repair.note.id === id ? nextId : repair.note.id
            const current = state.notes.find((entry) => entry.id === currentId)!
            if (!input.webdav && !input.adapter!.writeTextFile) throw new Error("笔记库不支持链接修复")
            const written = input.webdav ? undefined : await input.adapter!.writeTextFile!(current.remotePath!, repair.content,
              repair.note.id === id ? moved.revision : repair.revision)
            replace(currentId, changed({ ...current, baseContent: repair.baseContent }, repair.content, written?.revision))
          } catch (error) { report.issues.push(`${repair.note.title}：移动已完成，但链接修复失败：${error instanceof Error ? error.message : "写入失败"}`) }
        }
      }
      assertCurrent()
      // 成功计数必须晚于持久化：缓存故障时停止后续项，避免把未落盘的队列当成完成。
      await input.commit(state)
      report.succeededIds.push(id)
    } catch (error) {
      report.issues.push(`${note?.title ?? id}：${error instanceof Error ? error.message : "操作失败"}`)
      if (didMutate) { report.issues.push("部分变更已执行，后续操作已停止；请检查保存状态后重试"); break }
    } finally { input.progress?.(index + 1, ids.length) }
  }
  return report
}
