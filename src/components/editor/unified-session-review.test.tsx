// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { EditorView } from "@codemirror/view"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import MarkdownEditor, { type MarkdownEditorHandle } from "./markdown-editor"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement | undefined
beforeAll(() => {
  // jsdom 不提供文字排版测量；本文件只验数据/会话不变量，实际位置由浏览器独立验证。
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

describe("一体化会话独立验收", () => {
  it("锁定与解除锁定复用编辑器，禁止改写且保留撤销历史", () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    const handle = createRef<MarkdownEditorHandle>()
    let value = "正文"
    const render = (readOnly: boolean) => act(() => root!.render(
      <MarkdownEditor ref={handle} sessionKey="independent-lock-review" value={value}
        onChange={(next) => { value = next }} readOnly={readOnly} />,
    ))
    render(false)
    const editorDOM = host.querySelector<HTMLElement>(".cm-editor")!
    const view = EditorView.findFromDOM(editorDOM)!
    act(() => {
      view.dispatch({ selection: { anchor: value.length } })
      handle.current!.insertText("新增")
    })
    render(false)
    expect(value).toBe("正文新增")
    render(true)
    expect(host.querySelector(".cm-editor")).toBe(editorDOM)
    expect(EditorView.findFromDOM(editorDOM)).toBe(view)
    expect(view.state.readOnly).toBe(true)
    act(() => {
      handle.current!.insertText("不得写入")
      handle.current!.replaceAll("正文", "禁止替换")
      handle.current!.undo()
    })
    expect(view.state.doc.toString()).toBe("正文新增")
    render(false)
    expect(EditorView.findFromDOM(editorDOM)).toBe(view)
    act(() => handle.current!.undo())
    expect(value).toBe("正文")
  })

  it("手机首次打开编辑器不自动聚焦正文", () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(<MarkdownEditor compact value="手机正文" onChange={() => {}} />))
    expect(host.contains(document.activeElement)).toBe(false)
  })

  it("编辑态已经渲染的任务在锁定后立即禁止改写", async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    const original = "正文\n\n- [ ] 待办"
    let value = original
    const render = (readOnly: boolean) => act(() => root!.render(
      <MarkdownEditor value={value} onChange={(next) => { value = next }} readOnly={readOnly} />,
    ))
    render(false)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(false)
    render(true)
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => checkbox.click())
    expect(value).toBe(original)
    expect(checkbox.disabled).toBe(true)
  })
})
