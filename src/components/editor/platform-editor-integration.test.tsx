// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { undoDepth } from "@codemirror/commands"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { FormattingToolbar } from "@/components/workspace/formatting-toolbar"
import MarkdownEditor, { type MarkdownEditorHandle } from "./markdown-editor"

// The production editor includes EditorControl/basicSetup. Platform is read by CM at import time.
vi.hoisted(() => Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] })
if (!Range.prototype.getBoundingClientRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() })

let root: Root | undefined
let container: HTMLElement | undefined
let session = 0
const originalTouchPoints = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints")
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint")
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined; container = undefined
  if (originalTouchPoints) Object.defineProperty(navigator, "maxTouchPoints", originalTouchPoints)
  else Reflect.deleteProperty(navigator, "maxTouchPoints")
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" })
  if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint)
  else Reflect.deleteProperty(document, "elementFromPoint")
  vi.restoreAllMocks()
})

async function mountEditor(doc: string, options: { readOnly?: boolean; touchPoints?: number; platform?: string; toolbar?: boolean; editingTable?: boolean } = {}) {
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: options.touchPoints ?? 0 })
  Object.defineProperty(navigator, "platform", { configurable: true, value: options.platform ?? "MacIntel" })
  const ref = createRef<MarkdownEditorHandle>()
  const opened = vi.fn()
  vi.spyOn(window, "open").mockImplementation((url) => { opened(String(url)); return null })
  const changed = vi.fn()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  const sessionKey = `integration-note-${++session}`
  await act(async () => {
    root!.render(<TooltipProvider>
      <MarkdownEditor onChange={changed} onOpenWikiLink={opened} readOnly={options.readOnly} ref={ref} sessionKey={sessionKey} storageKey={sessionKey} value={doc} />
      {options.toolbar ? <FormattingToolbar attachmentBusy={false} canInsertAttachment={false} canUndo editingTable={options.editingTable} editorRef={ref} hasSelection mobile onFormat={vi.fn()} onInsertFiles={vi.fn()} /> : null}
    </TooltipProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
  return { view, opened, changed, ref }
}

function click(element: Element, modifiers: MouseEventInit = {}) {
  act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers })) })
}

describe("production editor link activation", () => {
  it.each([
    { doc: "前文\n\n[[另一篇|标签]]", anchor: 10, target: "另一篇" },
    { doc: "前文\n\n[标签](https://example.com)", anchor: 6, target: "https://example.com" },
    { doc: "前文\n\nhttps://example.com", anchor: 12, target: "https://example.com" },
  ])("Cmd+Enter at $target opens once without modifying content/history", async ({ doc, anchor, target }) => {
    const { view, opened, changed } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor } }); view.focus() })
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(view.state.doc.toString()).toBe(doc)
    expect(opened).toHaveBeenCalledExactlyOnceWith(target)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(0)
  })

  it("Cmd+Enter outside a link retains basicSetup insertBlankLine", async () => {
    const { view, opened } = await mountEditor("普通段落")
    act(() => { view.dispatch({ selection: { anchor: 2 } }); view.focus() })
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(view.state.doc.toString()).toBe("普通段落\n")
    expect(opened).not.toHaveBeenCalled()
  })

  it.each(["另一篇.md", "https://example.com"])("plain table click edits and Cmd click opens %s exactly once", async (target) => {
    const doc = `| 名称 |\n| --- |\n| [标签](${target}) |`
    const { view, opened } = await mountEditor(doc)
    let link = view.contentDOM.querySelector(".cm-md-table-link")!
    click(link)
    expect(opened).not.toHaveBeenCalled()
    expect(view.contentDOM.querySelector(".cm-md-table-cell-input")).not.toBeNull()
    const input = view.contentDOM.querySelector<HTMLTextAreaElement>(".cm-md-table-cell-input")!
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    link = view.contentDOM.querySelector(".cm-md-table-link")!
    click(link, { metaKey: true })
    expect(opened).toHaveBeenCalledExactlyOnceWith(target)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it.each([{ readOnly: true, touchPoints: 0 }, { readOnly: false, touchPoints: 1 }, { readOnly: false, touchPoints: 5 }, { readOnly: false, touchPoints: 0, platform: "Win32" }])("table reading/touch/non-Mac keeps single-click activation ($readOnly, $touchPoints)", async (options) => {
    const { view, opened } = await mountEditor("| 名称 |\n| --- |\n| [标签](另一篇.md) |", options)
    click(view.contentDOM.querySelector(".cm-md-table-link")!)
    expect(opened).toHaveBeenCalledExactlyOnceWith("另一篇.md")
  })

  it("a click after table drag selection never opens the link, even with Cmd", async () => {
    const { view, opened } = await mountEditor("| 名称 |\n| --- |\n| [标签](另一篇.md) |\n| 第二格 |")
    const link = view.contentDOM.querySelector(".cm-md-table-link")!
    const cell = link.closest("td")!
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => cell })
    act(() => {
      link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: 30, clientY: 10 }))
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: 30, clientY: 10 }))
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }))
    })
    expect(opened).not.toHaveBeenCalled()
    expect(view.contentDOM.querySelector(".cm-md-table-cell-input")).toBeNull()
  })
})

describe("selection More Undo with real editor transactions", () => {
  function moreUndo() {
    click(container!.querySelector('[aria-label="更多格式"]')!)
    const undo = [...container!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "撤销")!
    const press = new MouseEvent("pointerdown", { bubbles: true, cancelable: true })
    act(() => undo.dispatchEvent(press))
    expect(press.defaultPrevented).toBe(true)
    click(undo)
  }

  it("undo removes the actual CM change and retains editor focus", async () => {
    const { view, changed } = await mountEditor("原正文", { toolbar: true })
    act(() => {
      view.dispatch({ changes: { from: 3, insert: "新增" }, selection: { anchor: 0, head: 5 }, userEvent: "input.type" })
      view.focus()
    })
    expect(undoDepth(view.state)).toBe(1)
    moreUndo()
    expect(view.state.doc.toString()).toBe("原正文")
    expect(changed.mock.lastCall?.[0]).toBe("原正文")
    expect(undoDepth(view.state)).toBe(0)
    expect(view.hasFocus).toBe(true)
  })

  it("undo commits and then reverses an actual table draft, leaving no orphan textarea", async () => {
    const doc = "| 名称 |\n| --- |\n| 原文 |"
    const { view } = await mountEditor(doc, { toolbar: true, editingTable: true })
    click(view.contentDOM.querySelector("td")!)
    const input = view.contentDOM.querySelector<HTMLTextAreaElement>("textarea")!
    act(() => {
      input.value = "修改草稿"
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.setSelectionRange(0, 4)
    })
    expect(view.state.doc.toString()).toBe(doc)
    moreUndo()
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.contentDOM.querySelector("textarea")).toBeNull()
    expect(view.hasFocus).toBe(true)
  })
})
