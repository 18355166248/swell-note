// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

import type { AttachmentQueueTarget } from "./attachment-queue"
import { attachmentEditorKey, resolveAttachmentFallback } from "./attachment-target"

/**
 * 这里的每一条都对应「异步窗口另一端用户已经改了环境」：
 * 切库、删笔记、切走编辑器。写错笔记的代价是别人的正文里凭空多出一段附件引用。
 */

const target: AttachmentQueueTarget = {
  cacheId: "cache-a",
  editorSessionKey: "session-a",
  noteId: "webdav:/甲.md",
  noteTitle: "甲笔记",
}

const noteA = { editorSessionKey: "session-a", id: "webdav:/甲.md", title: "甲笔记" }

describe("附件落点身份", () => {
  it("库与笔记合起来才构成编辑器会话身份", () => {
    // 同一个 editorSessionKey 在不同库里是两篇不同的笔记，拼在一起才不会撞。
    expect(attachmentEditorKey("cache-a", "session-a")).not.toBe(attachmentEditorKey("cache-b", "session-a"))
    expect(attachmentEditorKey(null, "session-a")).toBe("session:session-a")
  })

  it("笔记库换了以后不追加，也不改写到新库里同路径的笔记", () => {
    const write = vi.fn()
    // 新库里恰好有一篇 editorSessionKey 相同的笔记：只按它查找就会写进别人的正文。
    const result = resolveAttachmentFallback({
      activeCacheId: "cache-b",
      markdown: "![图](attachments/图.png)\n",
      notes: [noteA],
      target,
      writeMarkdown: write,
    })

    expect(write).not.toHaveBeenCalled()
    expect(result).toEqual({ placed: false, notice: "已切换到其他笔记库，附件已写入但正文引用未插入" })
  })

  it("原笔记被删除时不复活它，并如实说明引用没进正文", () => {
    const write = vi.fn()
    const result = resolveAttachmentFallback({
      activeCacheId: "cache-a",
      markdown: "![图](attachments/图.png)\n",
      notes: [{ ...noteA, pendingOperation: "delete" }],
      target,
      writeMarkdown: write,
    })

    expect(write).not.toHaveBeenCalled()
    expect(result).toEqual({ placed: false, notice: "「甲笔记」已被删除，附件已写入但正文引用未插入" })
  })

  it("同一库内重命名后按 editorSessionKey 跟上，追加到新标题的笔记末尾", () => {
    const write = vi.fn()
    const result = resolveAttachmentFallback({
      activeCacheId: "cache-a",
      markdown: "![图](attachments/图.png)\n",
      // 重命名换掉了 id 与标题，editorSessionKey 不变：这是同一篇笔记。
      notes: [{ editorSessionKey: "session-a", id: "webdav:/乙.md", title: "乙笔记" }],
      target,
      writeMarkdown: write,
    })

    expect(write).toHaveBeenCalledWith("webdav:/乙.md", "![图](attachments/图.png)\n")
    expect(result).toEqual({ placed: true, notice: "「乙笔记」编辑器已切换，附件追加到了笔记末尾" })
  })

  it("没有库（本地会话）时与 cacheId 为 null 的发起相匹配", () => {
    const write = vi.fn()
    const result = resolveAttachmentFallback({
      activeCacheId: null,
      markdown: "![图](attachments/图.png)\n",
      notes: [noteA],
      target: { ...target, cacheId: null },
      writeMarkdown: write,
    })

    expect(result.placed).toBe(true)
    expect(write).toHaveBeenCalledWith("webdav:/甲.md", "![图](attachments/图.png)\n")
  })
})
