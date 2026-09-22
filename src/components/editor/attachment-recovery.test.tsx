// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { EditorView } from "@codemirror/view"
import { afterEach, expect, it, vi } from "vitest"

import MarkdownEditor, { type MarkdownEditorHandle } from "./markdown-editor"
import { createClipboardImageCoverage, htmlToMarkdown } from "./html-to-markdown"
import { createAttachmentQueue, type AttachmentQueueOptions, type AttachmentQueueSlotInput } from "@/services/vault/attachment-queue"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] })

let root: Root | undefined
let container: HTMLElement | undefined
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined })

const target = { cacheId: "cache", noteId: "A", editorSessionKey: "A", noteTitle: "甲" }
const file = (name: string) => new File(["png"], name, { type: "image/png" })
const reference = (name: string) => `![图](${name})`
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function until(predicate: () => boolean) {
  await act(async () => {
    for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(predicate()).toBe(true)
}

// 使用真实 HTML 转换、CodeMirror 占位和附件队列，避免仅靠各层的 mock 掩盖契约不一致。
function setup(html: string, files: File[], write: AttachmentQueueOptions["write"]) {
  const slots: AttachmentQueueSlotInput[] = files.map(() => null)
  const content = htmlToMarkdown(html, {
    imageCoveredByFile: createClipboardImageCoverage(html, files),
    onImagePlaceholder: (p) => { slots[p.fileIndex] = { from: p.offset, text: p.text } },
  })!
  const handle = createRef<MarkdownEditorHandle>()
  container = document.createElement("div"); document.body.appendChild(container)
  root = createRoot(container)
  const render = (sessionKey = "A", value = content) => {
    act(() => root!.render(<MarkdownEditor ref={handle} onChange={() => {}} sessionKey={sessionKey} storageKey={sessionKey} value={value} />))
  }
  render()
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
  const fallback = vi.fn(() => ({ placed: false, notice: "降级写入不可用" }))
  const queue = createAttachmentQueue({ fallback, write })
  const id = queue.enqueue({ target, files, insertions: {
    capture: ({ retry, reinsert, slots: retrySlots }) => handle.current!.captureAttachmentInsertion({
      ownerSessionKey: "A",
      ...(reinsert ? {} : retry ? { retrySlots } : { placeholders: slots }),
    }),
  } })!
  return { queue, id, view, slots, handle, fallback, render }
}

const oneImage = '<p>开头</p><p><img src="file:///a.png" alt="甲图"></p><p>结尾</p>'
const twoImages = '<p><img src="file:///a.png" alt="甲图"></p><p>中间</p><p><img src="file:///b.png" alt="乙图"></p>'

it("失败占位随正文编辑继续映射，多次重试后在原位替换", async () => {
  let attempt = 0
  const { queue, id, view } = setup(oneImage, [file("a.png")], async () => ++attempt < 3
    ? { errors: ["网络失败"], markdown: "" } : { errors: [], markdown: reference("a.png") })
  await until(() => queue.getSnapshot()[0].status === "failed")
  expect(view.state.doc.toString()).toContain("甲图（图片写入失败：网络失败）")
  act(() => view.dispatch({ changes: { from: 0, insert: "新增正文\n" } }))
  const retry = queue.retry(id)!
  await until(() => queue.getSnapshot().find((batch) => batch.id === retry)?.status === "failed")
  act(() => view.dispatch({ changes: { from: 0, insert: "再次新增\n" } }))
  const last = queue.retry(retry)!
  await until(() => queue.getSnapshot().find((batch) => batch.id === last)?.status === "done")
  expect(view.state.doc.toString()).toBe(`再次新增\n新增正文\n开头\n\n${reference("a.png")}\n\n结尾`)
  expect(queue.getSnapshot()[0].pendingReferenceCount).toBe(0)
})

it("同批前一张图片变长，后一张失败占位仍可原位重试", async () => {
  let failed = false
  const { queue, id, view } = setup(twoImages, [file("a.png"), file("b.png")], async (_target, files) => {
    if (files[0].name === "b.png" && !failed) { failed = true; return { errors: ["拒绝"], markdown: "" } }
    return { errors: [], markdown: reference(`attachments/很长的目录名/${files[0].name}`) }
  })
  await until(() => queue.getSnapshot()[0].status === "failed")
  const retry = queue.retry(id)!
  await until(() => queue.getSnapshot().find((batch) => batch.id === retry)?.status === "done")
  expect(view.state.doc.toString()).toBe(`${reference("attachments/很长的目录名/a.png")}\n\n中间\n\n${reference("attachments/很长的目录名/b.png")}`)
})

it("撤销占位后主动补插使用当前光标，成功后拒绝重复补插", async () => {
  const gate = deferred<{ errors: string[]; markdown: string }>()
  const { queue, id, view, fallback } = setup(oneImage, [file("a.png")], () => gate.promise)
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "用户正文\n\n末尾" }, selection: { anchor: 6 } }))
  gate.resolve({ errors: [], markdown: reference("a.png") })
  await until(() => queue.getSnapshot()[0].status === "done")
  expect(fallback).not.toHaveBeenCalled()
  expect(queue.getSnapshot()[0].pendingReferenceCount).toBe(1)
  act(() => { expect(queue.reinsert(id)).toBe(true) })
  expect(view.state.doc.toString()).toBe(`用户正文\n\n${reference("a.png")}\n末尾`)
  expect(queue.reinsert(id)).toBe(false)
  expect(queue.getSnapshot()[0].pendingReferenceCount).toBe(0)
  expect(queue.getSnapshot()[0].notice).toBeUndefined()
})

it("部分占位被撤销时只补插缺失引用，已经插入的图片不重复", async () => {
  const gate = deferred<void>()
  const { queue, id, view, slots } = setup(twoImages, [file("a.png"), file("b.png")], async (_target, files) => {
    await gate.promise
    return { errors: [], markdown: reference(files[0].name) }
  })
  const removed = slots[1]!
  act(() => view.dispatch({ changes: { from: removed.from, to: removed.from + removed.text.length, insert: "用户替换的文字" } }))
  gate.resolve()
  await until(() => queue.getSnapshot()[0].status === "done")
  expect(queue.getSnapshot()[0]).toMatchObject({ insertion: "failed", insertedCount: 1, pendingReferenceCount: 1 })
  act(() => { queue.reinsert(id) })
  expect(view.state.doc.toString().split(reference("a.png"))).toHaveLength(2)
  expect(view.state.doc.toString().split(reference("b.png"))).toHaveLength(2)
  expect(view.state.doc.toString()).toContain("用户替换的文字")
})

it.each(["item", "batch"])("取消运行批次的等待项（%s）会结束写入中占位", async (mode) => {
  const gate = deferred<void>()
  const write = vi.fn(async (_target, files: File[]) => { await gate.promise; return { errors: [], markdown: reference(files[0].name) } })
  const { queue, id, view } = setup(twoImages, [file("a.png"), file("b.png")], write)
  act(() => { if (mode === "item") queue.cancelItem(id, queue.getSnapshot()[0].items[1].id); else queue.cancel(id) })
  gate.resolve()
  await until(() => queue.getSnapshot()[0].status !== "writing")
  expect(view.state.doc.toString()).not.toContain("图片写入中")
  expect(view.state.doc.toString()).toContain("图片写入已取消")
  expect(view.state.doc.toString()).toContain(reference("a.png"))
  expect(write).toHaveBeenCalledTimes(1)
})

it("取消尚未执行的批次也更新正文占位", async () => {
  const gate = deferred<void>()
  const { queue, handle, view } = setup('<p>原文</p>', [file("block.png")], async () => { await gate.promise; return { errors: ["失败"], markdown: "" } })
  const text = "乙图（图片写入中…）"
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }))
  const id = queue.enqueue({ target, files: [file("b.png")], insertions: { capture: () => handle.current!.captureAttachmentInsertion({ placeholders: [{ from: 2, text }] }) } })!
  act(() => { queue.cancel(id) })
  expect(view.state.doc.toString()).toBe("原文乙图（图片写入已取消）")
  gate.resolve()
  await until(() => queue.getSnapshot()[0].status === "failed")
})

it("剪贴板文件顺序相反时按唯一文件名匹配，并按正文位置提交替换", async () => {
  const { queue, view } = setup(twoImages, [file("b.png"), file("a.png")], async (_target, files) => ({ errors: [], markdown: reference(files[0].name) }))
  await until(() => queue.getSnapshot()[0].status === "done")
  expect(view.state.doc.toString()).toBe(`${reference("a.png")}\n\n中间\n\n${reference("b.png")}`)
})

it("匿名图片不能抢走后续唯一名称匹配的文件", async () => {
  const html = '<p><img src="data:image/png;base64,eA==" alt="匿名"></p><p><img src="file:///b.png"></p>'
  const { queue, view } = setup(html, [file("b.png"), file("a.png")], async (_target, files) => ({ errors: [], markdown: reference(files[0].name) }))
  await until(() => queue.getSnapshot()[0].status === "done")
  expect(view.state.doc.toString()).toBe(`${reference("a.png")}\n\n${reference("b.png")}`)
})

it("关闭原记录或失败重试记录后，保留的入口仍能原位重试", async () => {
  let attempt = 0
  const { queue, id, view } = setup(oneImage, [file("a.png")], async () => ++attempt < 3
    ? { errors: ["失败"], markdown: "" } : { errors: [], markdown: reference("a.png") })
  await until(() => queue.getSnapshot()[0].status === "failed")
  const retry = queue.retry(id)!
  await until(() => queue.getSnapshot().find((batch) => batch.id === retry)?.status === "failed")
  expect(queue.dismiss(id)).toBe(true)
  act(() => view.dispatch({ changes: { from: 0, insert: "前缀\n" } }))
  const last = queue.retry(retry)!
  await until(() => queue.getSnapshot().find((batch) => batch.id === last)?.status === "done")
  expect(view.state.doc.toString()).toBe(`前缀\n开头\n\n${reference("a.png")}\n\n结尾`)
})

it("取消排队中的重试后，下一次重试仍能替换取消说明", async () => {
  const gate = deferred<void>()
  let attempt = 0
  const { queue, id, view } = setup(oneImage, [file("a.png")], async (_target, files) => {
    if (files[0].name === "block.png") { await gate.promise; return { errors: ["失败"], markdown: "" } }
    return ++attempt === 1 ? { errors: ["失败"], markdown: "" } : { errors: [], markdown: reference("a.png") }
  })
  await until(() => queue.getSnapshot()[0].status === "failed")
  queue.enqueue({ target, files: [file("block.png")], insertions: { capture: () => null } })
  const retry = queue.retry(id)!
  act(() => { queue.cancel(retry) })
  expect(view.state.doc.toString()).toContain("图片写入已取消")
  act(() => view.dispatch({ changes: { from: 0, insert: "前缀\n" } }))
  const last = queue.retry(id)!
  gate.resolve()
  await until(() => queue.getSnapshot().find((batch) => batch.id === last)?.status === "done")
  expect(view.state.doc.toString()).toBe(`前缀\n开头\n\n${reference("a.png")}\n\n结尾`)
})
