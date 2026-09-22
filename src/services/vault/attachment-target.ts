import type { AttachmentQueueFallbackResult, AttachmentQueueTarget } from "./attachment-queue"

/**
 * 附件写入的落点身份判定。
 *
 * 这两件事都发生在异步窗口的另一端（用户已经切过笔记、切过库、甚至删了原笔记），
 * 因此从组件里抽出来单独可测：写错笔记的代价是别人的正文被塞进一段附件引用，
 * 而且往往要等到用户打开那篇笔记才发现。
 */

/** 笔记在编辑器里的会话标识。库与笔记合起来才唯一——noteId 含类型与路径，跨库并不保证唯一。 */
export function attachmentEditorKey(cacheId: string | null, editorSessionKey: string) {
  return `${cacheId ?? "session"}:${editorSessionKey}`
}

/** 降级落点只需要这几个字段，避免把整个 Note 类型拖进这个模块。 */
export type AttachmentFallbackNote = {
  editorSessionKey?: string
  id: string
  pendingOperation?: string
  title: string
}

/**
 * 书签取不到时的降级落点：把引用追加到**发起时那篇笔记**的末尾。
 *
 * 三条拒绝理由都必须如实汇报成 `placed: false`——附件已经写进磁盘/远端了，
 * 引用却没进正文，用户必须知道这一点，而不是看到一句「已插入」。
 */
export function resolveAttachmentFallback({
  activeCacheId,
  markdown,
  notes,
  target,
  writeMarkdown,
}: {
  activeCacheId: string | null
  markdown: string
  notes: readonly AttachmentFallbackNote[]
  target: AttachmentQueueTarget
  writeMarkdown: (noteId: string, markdown: string) => void
}): AttachmentQueueFallbackResult {
  // 库身份必须再校验一次。写入开始时校验过，但写入是异步的，落笔时可能已经切到了另一个库；
  // 而笔记 ID 里含类型与路径，跨库同名路径并不罕见——只按 editorSessionKey 查找会把旧库附件的
  // 引用追加进新库里另一篇笔记的正文。
  if (activeCacheId !== target.cacheId) {
    return { placed: false, notice: "已切换到其他笔记库，附件已写入但正文引用未插入" }
  }
  const note = notes.find((candidate) =>
    (candidate.editorSessionKey ?? candidate.id) === target.editorSessionKey
    && candidate.pendingOperation !== "delete")
  // 原笔记被删就什么都不做：复活一篇已删除的笔记比「引用没插进去」更糟。
  if (!note) {
    return { placed: false, notice: `「${target.noteTitle}」已被删除，附件已写入但正文引用未插入` }
  }
  writeMarkdown(note.id, markdown)
  return { placed: true, notice: `「${note.title}」编辑器已切换，附件追加到了笔记末尾` }
}
