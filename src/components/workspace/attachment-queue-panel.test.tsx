// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

import { AttachmentQueuePanel } from "./attachment-queue-panel"
import type { AttachmentQueueBatch } from "@/services/vault/attachment-queue"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * 面板只做两件事：如实描述这一批收尾到了哪一步，以及给出「文件写了但引用没进正文」的
 * 恢复入口。这里锁住的是**按钮的出现条件**——多给一个按钮，用户就会插出第二份引用。
 */

function batch(overrides: Partial<AttachmentQueueBatch> = {}): AttachmentQueueBatch {
  return {
    createdAt: 0,
    id: "batch-1",
    insertion: "inserted",
    items: [{ id: "item-1", name: "图.png", size: 1, status: "done" }],
    referenceCount: 1,
    insertedCount: overrides.insertion === "failed" ? 0 : 1,
    pendingReferenceCount: overrides.insertion === "failed" ? 1 : 0,
    status: "done",
    target: { cacheId: "cache-a", editorSessionKey: "session-a", noteId: "note-a", noteTitle: "甲笔记" },
    ...overrides,
  }
}

function render(batches: AttachmentQueueBatch[], handlers: Partial<Parameters<typeof AttachmentQueuePanel>[0]> = {}) {
  const container = document.createElement("div")
  const root = createRoot(container)
  const props = {
    batches,
    onCancel: vi.fn(),
    onDismiss: vi.fn(),
    onReinsert: vi.fn(),
    onRetry: vi.fn(),
    references: () => "![图](attachments/图.png)\n",
    ...handlers,
  }
  act(() => root.render(<AttachmentQueuePanel {...props} />))
  return { container, root, props }
}

function buttonByText(container: HTMLElement, text: string) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text)) ?? null
}

describe("AttachmentQueuePanel", () => {
  it("引用没进正文时给出「重新插入引用」，点了就交给队列受理", () => {
    const onReinsert = vi.fn()
    const { container } = render([batch({ insertion: "failed", notice: "附件已写入，但正文引用未插入" })], { onReinsert })

    expect(container.textContent).toContain("附件已写入，但正文引用未插入")
    act(() => buttonByText(container, "重新插入引用")!.click())
    expect(onReinsert).toHaveBeenCalledWith("batch-1")
  })

  it("引用已经插进正文时不给补插按钮，避免用户插出第二份", () => {
    const { container } = render([batch({ insertion: "inserted" })])

    expect(buttonByText(container, "重新插入引用")).toBeNull()
    // 复制入口仍在：文件已经在磁盘上了，用户想放到别处用时不必重新上传。
    expect(buttonByText(container, "复制引用")).not.toBeNull()
  })

  it("一个文件都没写成功时没有任何引用可恢复", () => {
    const { container } = render([batch({ insertion: "none", referenceCount: 0, status: "failed" })])

    expect(buttonByText(container, "重新插入引用")).toBeNull()
    expect(buttonByText(container, "复制引用")).toBeNull()
  })

  it("批量重试进行中时锁住补插，两次落笔会把同一批引用插进去两次", () => {
    const { container } = render([batch({ insertion: "failed", retrying: true })])

    expect(buttonByText(container, "重新插入引用")!.hasAttribute("disabled")).toBe(true)
  })

  it("补插进行中时按钮改成进度文案，重复点击不再受理", () => {
    const onReinsert = vi.fn()
    const { container } = render([batch({ insertion: "failed", reinserting: true })], { onReinsert })

    const button = buttonByText(container, "正在插入引用")!
    expect(button.hasAttribute("disabled")).toBe(true)
    act(() => button.click())
    expect(onReinsert).not.toHaveBeenCalled()
  })

  it("复制引用复制的是队列给的 Markdown 引用，复制成功后如实改文案", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })
    const { container } = render([batch()])

    await act(async () => { buttonByText(container, "复制引用")!.click() })
    expect(writeText).toHaveBeenCalledWith("![图](attachments/图.png)\n")
    expect(buttonByText(container, "已复制引用")).not.toBeNull()
  })
})
