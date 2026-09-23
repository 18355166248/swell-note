// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { EditorView } from "@codemirror/view"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import MarkdownEditor from "@/components/editor/markdown-editor"
import type { NoteSaveState } from "@/types/note"
import { resolveEditorReadOnly } from "./workspace"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

beforeAll(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe("background save editability", () => {
  it("延迟保存进行中仍接受后续连续输入", () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    let value = ""
    const render = (status: NoteSaveState["status"]) => act(() => root!.render(
      <MarkdownEditor
        onChange={(next) => { value = next }}
        readOnly={resolveEditorReadOnly(false, "local", "unified", status)}
        value={value}
      />,
    ))

    render("saved")
    const editor = host.querySelector<HTMLElement>(".cm-editor")!
    const view = EditorView.findFromDOM(editor)!
    act(() => view.dispatch({ changes: { from: 0, insert: "D" }, selection: { anchor: 1 }, userEvent: "input.type" }))

    render("saving")
    expect(EditorView.findFromDOM(editor)).toBe(view)
    expect(view.state.readOnly).toBe(false)
    act(() => view.dispatch({ changes: { from: 1, insert: "ESKTOP-OK" }, selection: { anchor: 10 }, userEvent: "input.type" }))

    expect(value).toBe("DESKTOP-OK")
  })

  it("WebDAV 仅在上传窗口开放正文，其他同步阶段仍锁定", () => {
    expect(resolveEditorReadOnly(false, "local", "unified", "saving")).toBe(false)
    expect(resolveEditorReadOnly(false, "webdav", "unified", "pending")).toBe(false)
    expect(resolveEditorReadOnly(false, "webdav", "unified", "saving")).toBe(true)
    expect(resolveEditorReadOnly(false, "webdav", "unified", "saving", true)).toBe(false)
    expect(resolveEditorReadOnly(true, "webdav", "unified", "saving", true)).toBe(true)
  })
})
