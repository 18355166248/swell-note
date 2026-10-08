// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { undo, undoDepth } from "@codemirror/commands"
import { Compartment, EditorState, Prec, StateEffect } from "@codemirror/state"
import * as language from "@codemirror/language"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { FormattingToolbar } from "@/components/workspace/formatting-toolbar"
import MarkdownEditor, { type MarkdownEditorHandle } from "./markdown-editor"

vi.mock("@codemirror/language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/language")>()
  return { ...actual, ensureSyntaxTree: vi.fn(actual.ensureSyntaxTree) }
})

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
  vi.mocked(language.ensureSyntaxTree).mockReset()
  vi.restoreAllMocks()
})

async function mountEditor(doc: string, options: { readOnly?: boolean; touchPoints?: number; platform?: string; toolbar?: boolean; editingTable?: boolean; sourceMode?: boolean } = {}) {
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
  const renderEditor = (nextDoc = doc, nextSessionKey = sessionKey, nextOptions = options) => {
    root!.render(<TooltipProvider>
      <MarkdownEditor onChange={changed} onOpenWikiLink={opened} readOnly={nextOptions.readOnly} sourceMode={nextOptions.sourceMode} ref={ref} sessionKey={nextSessionKey} storageKey={nextSessionKey} value={nextDoc} />
      {options.toolbar ? <FormattingToolbar attachmentBusy={false} canInsertAttachment={false} canUndo editingTable={options.editingTable} editorRef={ref} hasSelection mobile onFormat={vi.fn()} onInsertFiles={vi.fn()} /> : null}
    </TooltipProvider>)
  }
  await act(async () => renderEditor())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!
  return { view, opened, changed, ref, rerender: async (nextDoc: string, nextSessionKey = sessionKey, nextOptions = options) => {
    await act(async () => renderEditor(nextDoc, nextSessionKey, nextOptions))
  } }
}

function click(element: Element, modifiers: MouseEventInit = {}) {
  act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers })) })
}

describe("production editor link activation", () => {

  it("an incomplete parse consumes Cmd+Enter then opens once in bounded slices", async () => {
    const doc = "[标签](https://example.com/path)"
    const { view, opened, changed } = await mountEditor(doc)
    act(() => view.dispatch({ changes: { from: 0, insert: "更新 " }, userEvent: "input.type" }))
    const edited = view.state.doc.toString()
    changed.mockClear()
    act(() => { view.dispatch({ selection: { anchor: edited.length - 1 } }); view.focus() })
    const selection = view.state.selection.toJSON()
    const parse = vi.mocked(language.ensureSyntaxTree).mockReturnValueOnce(null)
    act(() => {
      for (let repeat = 0; repeat < 3; repeat++) view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }))
    })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(opened).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toBe(edited)
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(1)
    await act(async () => { await vi.waitFor(() => expect(opened).toHaveBeenCalledExactlyOnceWith("https://example.com/path")) })
    expect(parse.mock.calls.map((call) => call[2])).toEqual([50, 10])
    expect(view.state.doc.toString()).toBe(edited)
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(1)
  })

  it("an incomplete non-link parse leaves this key intact and the next parsed key retains default newline", async () => {
    const doc = "普通段落"
    const { view, opened, changed } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor: 2 } }); view.focus() })
    const parse = vi.mocked(language.ensureSyntaxTree).mockReturnValueOnce(null)
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(view.state.doc.toString()).toBe(doc)
    expect(changed).not.toHaveBeenCalled()
    await act(async () => { await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(2)) })
    expect(view.state.doc.toString()).toBe(doc)
    expect(undoDepth(view.state)).toBe(0)
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(view.state.doc.toString()).toBe(doc + "\n")
    expect(opened).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(1)
  })

  it("parse exhaustion stops after eight slices and announces retry without opening or editing", async () => {
    const doc = "[标签](https://example.com/path)"
    const { view, opened, changed } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor: doc.length - 1 } }); view.focus() })
    const selection = view.state.selection.toJSON()
    const parse = vi.mocked(language.ensureSyntaxTree).mockReturnValue(null)
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(view.state.doc.toString()).toBe(doc)
    await act(async () => { await vi.waitFor(() => expect(view.dom.querySelector(".cm-announced")?.textContent).toContain("内容仍在解析，请稍后再试")) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
    expect(parse.mock.calls.map((call) => call[2])).toEqual([50, ...Array(8).fill(10)])
    expect(opened).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(0)
  })

  it.each(["selection", "document", "blur", "same-content note switch", "source mode", "unmount"])("pending activation cancels on %s without late opening", async (reason) => {
    const doc = "[标签](https://example.com/path)"
    const { view, opened, changed, rerender } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor: doc.length - 1 } }); view.focus() })
    const parse = vi.mocked(language.ensureSyntaxTree).mockReturnValueOnce(null)
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(view.state.doc.toString()).toBe(doc)
    expect(changed).not.toHaveBeenCalled()
    if (reason === "selection") act(() => {
      view.dispatch({ selection: { anchor: 0 } })
      view.dispatch({ selection: { anchor: doc.length - 1 } })
    })
    if (reason === "document") act(() => view.dispatch({ changes: { from: 0, insert: "修改 " } }))
    if (reason === "blur") act(() => view.contentDOM.dispatchEvent(new FocusEvent("blur", { bubbles: false })))
    if (reason === "same-content note switch") await rerender(doc, `integration-note-next-${++session}`)
    if (reason === "source mode") await rerender(doc, undefined, { sourceMode: true })
    if (reason === "unmount") act(() => { root!.unmount(); root = undefined })
    const after = view.state.doc.toString()
    const depth = undoDepth(view.state)
    changed.mockClear()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 90)) })
    // 源码折叠边栏会独立请求 30ms 解析；取消验证只看链接的首次 50ms 与后续 10ms 分片。
    expect(parse.mock.calls.map((call) => call[2]).filter((budget) => budget === 50 || budget === 10)).toEqual([50])
    expect(opened).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toBe(after)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(depth)
  })

  it.each([20000, 100000])("large-document tail (%i paragraphs) consumes immediately and opens or safely requests retry", async (paragraphs) => {
    const doc = "普通段落\n\n".repeat(paragraphs) + "[标签](https://example.com/path)"
    const { view, opened, changed } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor: doc.length - 1 }, scrollIntoView: true }); view.focus() })
    const selection = view.state.selection.toJSON()
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(view.state.doc.toString()).toBe(doc)
    expect(changed).not.toHaveBeenCalled()
    await act(async () => { await vi.waitFor(() => expect(opened.mock.calls.length === 1 || view.dom.querySelector(".cm-announced")?.textContent?.includes("内容仍在解析，请稍后再试")).toBe(true), { timeout: 2000 }) })
    if (opened.mock.calls.length) expect(opened).toHaveBeenCalledExactlyOnceWith("https://example.com/path")
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(0)
  }, 15000)

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


  // ¦ marks the caret. At a shared boundary the right-hand link wins; an isolated
  // link accepts both outer boundaries, but an intervening space is not a link.
  it.each([
    ["label", "[标¦签](https://example.com/path)", "https://example.com/path"],
    ["code-formatted label", "[\u0060标¦签\u0060](https://example.com/path)", "https://example.com/path"],
    ["linked-image outer destination", "[![图](https://example.com/image.png)](https://example.com/pa¦th)", "https://example.com/path"],
    ["URL middle", "[标签](https://exam¦ple.com/path)", "https://example.com/path"],
    ["URL tail", "[标签](https://example.com/path¦)", "https://example.com/path"],
    ["label close", "[标签¦](https://example.com/path)", "https://example.com/path"],
    ["between ] and (", "[标签]¦(https://example.com/path)", "https://example.com/path"],
    ["URL start", "[标签](¦https://example.com/path)", "https://example.com/path"],
    ["link start", "¦[标签](https://example.com/path)", "https://example.com/path"],
    ["link end", "[标签](https://example.com/path)¦", "https://example.com/path"],
    ["title", '[标签](https://example.com/path "提¦示")', "https://example.com/path"],
    ["nested parentheses", "[标签](https://example.com/a(b(c))¦)", "https://example.com/a(b(c))"],
    ["escaped parentheses", "[标签](https://example.com/a\\(b\\)¦)", "https://example.com/a(b)"],
    ["escaped trailing greater-than", "[标签](https://example.com/a\\>¦)", "https://example.com/a>"],
    ["angle destination", "[标签](<https://example.com/a¦b>)", "https://example.com/ab"],
    ["internal URL tail", "[标签](./另一篇.md¦)", "./另一篇.md"],
    ["internal encoded URL", "[标签](./%E5%8F%A6%E4%B8%80%E7%AF%87.md¦)", "./另一篇.md"],
    ["internal escaped parentheses", "[标签](./笔记\\(甲\\).md¦)", "./笔记(甲).md"],
    ["mailto", "[邮件](mailto:test@exam¦ple.com)", "mailto:test@example.com"],
    ["wiki target", "[[另¦一篇|标签]]", "另一篇"],
    ["wiki label", "[[另一篇|标¦签]]", "另一篇"],
    ["wiki start", "¦[[另一篇|标签]]", "另一篇"],
    ["wiki close", "[[另一篇|标签]¦]", "另一篇"],
    ["wiki end", "[[另一篇|标签]]¦", "另一篇"],
    ["bare URL middle", "https://example.com/pa¦th", "https://example.com/path"],
    ["bare URL end", "https://example.com/path¦", "https://example.com/path"],
    ["bare URL punctuation boundary", "https://example.com/path¦。", "https://example.com/path"],
    ["autolink", "<https://example.com/pa¦th>", "https://example.com/path"],
    ["autolink close", "<https://example.com/path>¦", "https://example.com/path"],
    ["adjacent Markdown links", "[甲](https://a.example)¦[乙](https://b.example)", "https://b.example"],
    ["Markdown then wiki", "[甲](https://a.example)¦[[另一篇]]", "另一篇"],
    ["wiki then Markdown", "[[另一篇]]¦[乙](https://b.example)", "https://b.example"],
  ])("Cmd+Enter resolves %s in the complete editor without content/history changes", async (_label, marked, target) => {
    const anchor = marked.indexOf("¦")
    const doc = marked.replace("¦", "")
    const { view, opened, changed } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor } }); view.focus() })
    const selection = view.state.selection.toJSON()
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(opened).toHaveBeenCalledExactlyOnceWith(target)
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(0)
  })

  it.each([
    ["after intervening space", "[标签](https://example.com) ¦后文"],
    ["before intervening space", "前文¦ [标签](https://example.com)"],
    ["linked-image inner destination", "[![图](https://example.com/im¦age.png)](https://example.com/path)"],
    ["image destination", "![图](https://example.com/im¦age.png)"],
    ["image label", "![图¦片](https://example.com/image.png)"],
    ["wiki image embed", "![[图¦片.png]]"],
    ["wiki note embed", "![[另¦一篇]]"],
    ["inline code Markdown", "\u0060[标签](https://example.com/pa¦th)\u0060"],
    ["inline code wiki", "\u0060[[另¦一篇]]\u0060"],
    ["inline code URL", "\u0060https://example.com/pa¦th\u0060"],
    ["fenced code", "\u0060\u0060\u0060md\n[标签](https://example.com/pa¦th)\n\u0060\u0060\u0060"],
    ["indented code", "    [标签](https://example.com/pa¦th)"],
    ["unsupported protocol", "[标签](javascript:ale¦rt(1))"],
    ["relative attachment", "[附件](./报告.p¦df)"],
    ["frontmatter wiki", "---\nvalue: [[另¦一篇]]\n---\n正文"],
    ["frontmatter URL", "---\nvalue: https://example.com/pa¦th\n---\n正文"],
    ["past trailing URL punctuation", "https://example.com/path。¦"],
  ])("Cmd+Enter excludes %s and retains the default editing command", async (_label, marked) => {
    const anchor = marked.indexOf("¦")
    const doc = marked.replace("¦", "")
    const { view, opened } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor } }); view.focus() })
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(opened).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).not.toBe(doc)
    expect(undoDepth(view.state)).toBe(1)
  })

  it("Ctrl+Enter resolves the same address without an extra transaction", async () => {
    const doc = "[标签](https://example.com/path)"
    const { view, opened, changed } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor: doc.length - 1 } }); view.focus() })
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })))
    expect(opened).toHaveBeenCalledExactlyOnceWith("https://example.com/path")
    expect(view.state.doc.toString()).toBe(doc)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(0)
  })

  it("Cmd+Enter in a read-only destination opens without edits", async () => {
    const doc = "[标签](https://example.com/path)"
    const { view, opened, changed } = await mountEditor(doc, { readOnly: true })
    act(() => view.dispatch({ selection: { anchor: doc.length - 1 } }))
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(opened).toHaveBeenCalledExactlyOnceWith("https://example.com/path")
    expect(view.state.doc.toString()).toBe(doc)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(0)
  })

  it("source mode retains basicSetup instead of activating live-preview links", async () => {
    const doc = "[标签](https://example.com/path)"
    const { view, opened } = await mountEditor(doc, { sourceMode: true })
    act(() => { view.dispatch({ selection: { anchor: doc.length - 1 } }); view.focus() })
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(opened).not.toHaveBeenCalled()
    expect(view.state.doc.toString()).toBe(doc + "\n")
    expect(undoDepth(view.state)).toBe(1)
  })

  it("opening a destination preserves an existing undo entry", async () => {
    const doc = "[标签](https://example.com/path)"
    const { view, opened, changed, ref } = await mountEditor(doc)
    act(() => view.dispatch({ changes: { from: 0, insert: "更新 " }, userEvent: "input.type" }))
    const edited = view.state.doc.toString()
    changed.mockClear()
    act(() => { view.dispatch({ selection: { anchor: edited.length - 1 } }); view.focus() })
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(opened).toHaveBeenCalledExactlyOnceWith("https://example.com/path")
    expect(view.state.doc.toString()).toBe(edited)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(1)
    act(() => ref.current!.undo())
    expect(view.state.doc.toString()).toBe(doc)
  })

  it("Cmd+Enter outside a link retains basicSetup insertBlankLine", async () => {
    const { view, opened } = await mountEditor("普通段落")
    act(() => { view.dispatch({ selection: { anchor: 2 } }); view.focus() })
    act(() => view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })))
    expect(view.state.doc.toString()).toBe("普通段落\n")
    expect(opened).not.toHaveBeenCalled()
  })

  it.each(["另一篇.md", "https://example.com"])("plain table click opens %s exactly once without editing", async (target) => {
    const doc = `| 名称 |\n| --- |\n| [标签](${target}) |`
    const { view, opened } = await mountEditor(doc)
    click(view.contentDOM.querySelector(".cm-md-table-link")!)
    expect(opened).toHaveBeenCalledExactlyOnceWith(target)
    expect(view.contentDOM.querySelector(".cm-md-table-cell-input")).toBeNull()
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

describe("production task widget activation", () => {
  it("keeps the replacement checkbox focused across continuous native activations", async () => {
    const doc = "前文\n\n- [ ] 第一项\n- [ ] 第二项\n\n末段"
    const { view, changed } = await mountEditor(doc)
    act(() => view.dispatch({ selection: { anchor: doc.length - 2, head: doc.length } }))
    const selection = view.state.selection.toJSON()
    const first = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    act(() => first.focus())
    for (let count = 1; count <= 4; count++) {
      act(() => (document.activeElement as HTMLInputElement).click())
      const replacement = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
      expect(document.activeElement).toBe(replacement)
      expect(replacement.checked).toBe(count % 2 === 1)
      expect(view.state.selection.toJSON()).toEqual(selection)
      expect(changed).toHaveBeenCalledTimes(count)
    }
    expect(view.state.doc.toString()).toBe(doc)
  })

  it("names each task with its own readable Markdown body and refreshes edited names", async () => {
    const doc = "前文\n\n- [ ] **买牛奶** [店铺](https://example.com) `清单` &amp; \\*字面\\*\n  - [x] 子任务 **[链接](https://example.com)**\n- [ ] \n- [ ] `<img onerror=alert(1)>`\n\n末段"
    const { view } = await mountEditor(doc)
    const names = () => Array.from(view.contentDOM.querySelectorAll(".cm-md-task-checkbox"), (box) => box.getAttribute("aria-label"))
    expect(names()).toEqual(["买牛奶 店铺 清单 & *字面*", "子任务 链接", "切换任务状态", "<img onerror=alert(1)>"])
    expect(view.contentDOM.querySelector("img[onerror]")).toBeNull()
    const from = doc.indexOf("买牛奶")
    act(() => view.dispatch({ changes: { from, to: from + 3, insert: "买面包" } }))
    expect(names()[0]).toBe("买面包 店铺 清单 & *字面*")
  })

  it.each([["续写", "店铺续写"], [" 续写", "店铺 续写"]])("excludes link title whitespace while preserving visible spacing (%s)", async (suffix, label) => {
    const doc = `前文\n\n- [ ] [店铺](https://example.com "标题")${suffix}\n\n末段`
    const { view } = await mountEditor(doc)
    expect(view.contentDOM.querySelector(".cm-md-task-checkbox")?.getAttribute("aria-label")).toBe(label)
  })

  it.each([["[A [B] C](https://example.com \"标题\")结束", "A [B] C结束"], ["[A [**B**] C](https://example.com \"标题\") 结束", "A [B] C 结束"]])("keeps literal brackets inside an existing nested task link label (%s)", async (body, label) => {
    const { view } = await mountEditor(`前文\n\n- [ ] ${body}\n\n末段`)
    expect(view.contentDOM.querySelector(".cm-md-task-checkbox")?.getAttribute("aria-label")).toBe(label)
  })

  it.each([false, true])("mounts multiline link titles without changing source (readonly=%s)", async (readOnly) => {
    const doc = '前文\n\n[普通链接](https://example.com\n  "普通标题")\n\n- [ ] [店铺](https://example.com\n  "任务标题")续写\n\n末段'
    const { view, changed } = await mountEditor(doc, { readOnly })
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.contentDOM.textContent).toContain("普通链接")
    expect(view.contentDOM.textContent).not.toContain("https://example.com")
    expect(view.contentDOM.textContent).not.toContain("任务标题")
    const box = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    expect(box.getAttribute("aria-label")).toBe("店铺续写")
    expect(box.disabled).toBe(readOnly)
    expect(changed).not.toHaveBeenCalled()
    if (!readOnly) {
      act(() => { view.dispatch({ selection: { anchor: doc.length } }); box.focus(); box.click() })
      expect(view.state.doc.toString()).toBe(doc.replace("[ ]", "[x]"))
      expect(document.activeElement).toBe(view.contentDOM.querySelector(".cm-md-task-checkbox"))
      act(() => { view.focus(); expect(undo(view)).toBe(true) })
      expect(view.state.doc.toString()).toBe(doc)
    }
  })

  it("does not take focus back from a control acquired during the task update", async () => {
    const doc = "前文\n\n- [ ] 任务\n\n末段"
    const { view, changed } = await mountEditor(doc)
    const button = document.createElement("button")
    container!.appendChild(button)
    changed.mockImplementation(() => button.focus())
    const box = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    act(() => { box.focus(); box.click() })
    expect(document.activeElement).toBe(button)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(document.activeElement).toBe(button)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])("retires keyboard focus after a readonly boundary during dispatch (ABA=%s)", async (aba) => {
    const doc = "前文\n\n- [ ] 任务\n\n末段"
    const { view, changed } = await mountEditor(doc)
    const mode = new Compartment()
    act(() => view.dispatch({ effects: StateEffect.appendConfig.of(mode.of(Prec.highest(EditorState.readOnly.of(false)))) }))
    changed.mockImplementation(() => {
      view.dispatch({ effects: mode.reconfigure(Prec.highest(EditorState.readOnly.of(true))) })
      if (aba) view.dispatch({ effects: mode.reconfigure(Prec.highest(EditorState.readOnly.of(false))) })
    })
    const box = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    act(() => { box.focus(); box.click() })
    const replacement = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    expect(replacement.disabled).toBe(!aba)
    expect(document.activeElement).not.toBe(replacement)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(document.activeElement).not.toBe(replacement)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it("ignores an old checkbox after switching notes and after unmount", async () => {
    const doc = "前文\n\n- [ ] 旧任务\n\n末段"
    const { changed, rerender } = await mountEditor(doc)
    const old = container!.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    act(() => old.focus())
    const nextDoc = "前文\n\n- [ ] 新任务\n\n末段"
    await rerender(nextDoc, "replacement-task-note")
    const next = container!.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    act(() => old.click())
    expect(next.getAttribute("aria-label")).toBe("新任务")
    expect(document.activeElement).not.toBe(next)
    expect(EditorView.findFromDOM(next.closest<HTMLElement>(".cm-editor")!)?.state.doc.toString()).toBe(nextDoc)
    expect(changed).not.toHaveBeenCalled()
    act(() => { root!.unmount(); root = undefined; next.click() })
    expect(changed).not.toHaveBeenCalled()
  })

  it("keeps mouse editor focus, selection, scroll and one-step undo", async () => {
    const doc = "前文\n\n- [ ] 任务\n\n末段"
    const { view, changed } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor: doc.length - 2, head: doc.length } }); view.focus() })
    const selection = view.state.selection.toJSON()
    view.scrollDOM.scrollTop = 180
    const box = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    act(() => box.click())
    expect(document.activeElement).toBe(view.contentDOM)
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(view.scrollDOM.scrollTop).toBe(180)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(undoDepth(view.state)).toBe(1)
    act(() => { expect(undo(view)).toBe(true) })
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.state.selection.toJSON()).toEqual(selection)
  })

  function taskPointer(type: string, x: number) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20, button: 0 })
    Object.defineProperties(event, { pointerId: { value: 7 }, isPrimary: { value: true } })
    return event
  }

  it("a task drag returning to the control never toggles and a following tap still works", async () => {
    const doc = "前文\n\n- [ ] 任务\n\n末段"
    const { view, changed } = await mountEditor(doc)
    act(() => { view.dispatch({ selection: { anchor: doc.length } }); view.focus() })
    const selection = view.state.selection.toJSON()
    const box = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    const control = box.closest(".cm-md-task-control") ?? box
    act(() => {
      control.dispatchEvent(taskPointer("pointerdown", 20))
      control.dispatchEvent(taskPointer("pointermove", 50))
      control.dispatchEvent(taskPointer("pointermove", 20))
      control.dispatchEvent(taskPointer("pointerup", 20))
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }))
    })
    expect(view.state.doc.toString()).toBe(doc)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(0)
    act(() => {
      control.dispatchEvent(taskPointer("pointerdown", 20))
      control.dispatchEvent(taskPointer("pointerup", 20))
      box.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }))
    })
    expect(view.state.doc.toString()).toBe(doc.replace("[ ]", "[x]"))
    expect(changed).toHaveBeenCalledTimes(1)
    expect(view.state.selection.toJSON()).toEqual(selection)
    expect(view.hasFocus).toBe(true)
    expect(undoDepth(view.state)).toBe(1)
  })

  it("a cancelled pointer does not poison subsequent keyboard/programmatic checkbox activation", async () => {
    const doc = "前文\n\n- [ ] 任务"
    const { view, changed } = await mountEditor(doc)
    act(() => view.dispatch({ selection: { anchor: 0 } }))
    const box = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    const control = box.closest(".cm-md-task-control") ?? box
    act(() => { control.dispatchEvent(taskPointer("pointerdown", 20)); control.dispatchEvent(taskPointer("pointercancel", 20)); box.click() })
    expect(view.state.doc.toString()).toBe(doc.replace("[ ]", "[x]"))
    expect(changed).toHaveBeenCalledTimes(1)
    expect(undoDepth(view.state)).toBe(1)
  })

  it("task controls remain disabled and do not write after a live readonly transition", async () => {
    const doc = "前文\n\n- [ ] 任务"
    const { view, changed, rerender } = await mountEditor(doc)
    const old = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    await rerender(doc, undefined, { readOnly: true })
    const box = view.contentDOM.querySelector<HTMLInputElement>(".cm-md-task-checkbox")!
    act(() => { old.click(); (box.closest<HTMLElement>(".cm-md-task-control") ?? box).click() })
    expect(box.disabled).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)
    expect(changed).not.toHaveBeenCalled()
    expect(undoDepth(view.state)).toBe(0)
  })
})
