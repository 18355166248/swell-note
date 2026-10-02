// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { EditorView } from "@codemirror/view"
import { isolateHistory, undoDepth } from "@codemirror/commands"
import { afterEach, describe, expect, it } from "vitest"

import MarkdownEditor, { type MarkdownEditorHandle } from "./markdown-editor"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Range.prototype.getClientRects) Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] })
if (!Range.prototype.getBoundingClientRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() })

let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined })
const doc = "前文\n\n| 名称 | 备注 |\n| --- | --- |\n| abcdef | 说明 |\n| 第二项 | 其他 |\n\n后文"
const tick = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) }) }
async function mount(initialDoc = doc) {
  const ref = createRef<MarkdownEditorHandle>()
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  const render = async (content = initialDoc, sessionKey = "history-a", readOnly = false) => {
    await act(async () => root!.render(<MarkdownEditor ref={ref} onChange={() => {}} value={content} sessionKey={sessionKey} storageKey={sessionKey} readOnly={readOnly} />))
  }
  await render(); await tick()
  const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!
  const input = () => host!.querySelector<HTMLTextAreaElement>(".cm-md-table-cell-input")
  const open = (table = 0, row = 1, column = 0) => {
    const cell = host!.querySelectorAll(".cm-md-table")[table].querySelectorAll("tr")[row].children[column]
    act(() => cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })))
    return input()!
  }
  return { ref, view, render, input, open }
}

describe("table history editing continuity", () => {
  it("undo and redo formatting restore the same cell and its caret", async () => {
    const { ref, view, input, open } = await mount()
    open().setSelectionRange(6, 6)
    act(() => ref.current!.insertText("**加粗文字**")); await tick()
    const formatted = view.state.doc.toString(); expect(formatted).toContain("**加粗文字**")
    act(() => ref.current!.undo()); await tick()
    expect(view.state.doc.toString()).toBe(doc)
    expect(input()?.value).toBe("abcdef")
    expect(document.activeElement).toBe(input())
    expect(input()?.selectionStart).toBe(6)
    act(() => ref.current!.redo()); await tick()
    expect(view.state.doc.toString()).toBe(formatted)
    expect(document.activeElement).toBe(input())
  })

  it("undo maps a selected formatted range into the restored cell text", async () => {
    const { ref, input, open } = await mount()
    open().setSelectionRange(1, 4)
    act(() => ref.current!.insertText("**加粗文字**")); await tick()
    act(() => ref.current!.undo()); await tick()
    expect(input()?.value).toBe("abcdef")
    expect(document.activeElement).toBe(input())
    expect(input()?.selectionStart).toBe(1)
    expect(input()?.selectionEnd).toBe(4)
    act(() => ref.current!.redo()); await tick()
    expect(input()?.selectionStart).toBe(1)
    expect(input()?.selectionEnd).toBe(8)
  })

  it("multiple formatting entries undo and redo independently in the same cell", async () => {
    const { ref, view, input, open } = await mount()
    open().setSelectionRange(0, 6)
    act(() => ref.current!.insertText("**加粗文字**")); await tick()
    const bold = view.state.doc.toString()
    input()!.setSelectionRange(2, 8)
    act(() => ref.current!.insertText("*斜体文字*")); await tick()
    const italic = view.state.doc.toString()
    expect(italic).not.toBe(bold)
    for (const [forward, expected] of [[false, bold], [false, doc], [true, bold], [true, italic]] as const) {
      act(() => forward ? ref.current!.redo() : ref.current!.undo()); await tick()
      expect(view.state.doc.toString()).toBe(expected)
      expect(document.activeElement).toBe(input())
      expect(input()?.closest("td")?.cellIndex).toBe(0)
    }
  })

  it("an uncommitted cell draft is undone once and remains editable", async () => {
    const { ref, view, input, open } = await mount()
    const draft = open(); draft.value = "abcdefXYZ"; draft.setSelectionRange(9, 9)
    act(() => draft.dispatchEvent(new Event("input", { bubbles: true })))
    act(() => ref.current!.undo()); await tick()
    expect(view.state.doc.toString()).toBe(doc)
    expect(input()?.value).toBe("abcdef")
    expect(document.activeElement).toBe(input())
    expect(input()?.selectionStart).toBe(6)
  })

  it("consecutive history commands before repaint restore the latest cell state", async () => {
    const { ref, view, input, open } = await mount()
    open().setSelectionRange(0, 6)
    act(() => ref.current!.insertText("**加粗文字**")); await tick()
    act(() => { ref.current!.undo(); ref.current!.redo(); ref.current!.undo() }); await tick()
    expect(view.state.doc.toString()).toBe(doc)
    expect(input()?.value).toBe("abcdef")
    expect(document.activeElement).toBe(input())
  })

  it("a note switch followed immediately by returning never revives an old focus request", async () => {
    const { ref, view, input, open, render } = await mount()
    open().setSelectionRange(0, 6); act(() => ref.current!.insertText("**加粗文字**")); await tick()
    act(() => ref.current!.undo())
    await render(doc, "history-b"); await render(doc, "history-a")
    const outside = document.createElement("button"); document.body.append(outside); outside.focus()
    await tick(); expect(document.activeElement).toBe(outside); expect(input()).toBeNull(); expect(view.state.doc.toString()).toBe(doc)
    outside.remove()
  })

  it("locking before restoration drops the request without writing or stealing focus", async () => {
    const { ref, view, input, open, render } = await mount()
    open().setSelectionRange(0, 6); act(() => ref.current!.insertText("**加粗文字**")); await tick()
    act(() => ref.current!.undo()); await render(doc, "history-a", true)
    const outside = document.createElement("button"); document.body.append(outside); outside.focus()
    await tick(); expect(view.state.readOnly).toBe(true); expect(view.state.doc.toString()).toBe(doc); expect(input()).toBeNull(); expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it("a changed body selection cancels pending cell focus", async () => {
    const { ref, view, input, open } = await mount()
    open().setSelectionRange(0, 6); act(() => ref.current!.insertText("**加粗文字**")); await tick()
    act(() => { ref.current!.undo(); view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus() })
    await tick(); expect(input()).toBeNull(); expect(view.state.selection.main.head).toBe(doc.length)
  })

  it("unmount cancels pending restoration", async () => {
    const { ref, open } = await mount()
    open().setSelectionRange(0, 6); act(() => ref.current!.insertText("**加粗文字**")); await tick()
    act(() => { ref.current!.undo(); root!.unmount(); root = undefined })
    const outside = document.createElement("button"); document.body.append(outside); outside.focus()
    await tick(); expect(document.activeElement).toBe(outside); expect(host!.querySelector("textarea")).toBeNull(); outside.remove()
  })

  it("undoing an inserted table does not focus its identical neighbor", async () => {
    const table = "| 名称 | 备注 |\n| --- | --- |\n| abcdef | 说明 |"
    const { ref, view, input, open } = await mount(table)
    act(() => view.dispatch({ changes: { from: 0, insert: table + "\n\n" }, annotations: isolateHistory.of("full") }))
    await tick(); open(0)
    act(() => ref.current!.undo()); await tick()
    expect(view.state.doc.toString()).toBe(table); expect(input()).toBeNull()
  })

  it("undoing a structural change drops an invalid row context", async () => {
    const { ref, view, input, open } = await mount()
    const extra = doc.replace("| 第二项 | 其他 |", "| 第二项 | 其他 |\n| 新项 | 新格 |")
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: extra }, annotations: isolateHistory.of("full") }))
    await tick(); open(0, 3)
    act(() => ref.current!.undo()); await tick()
    expect(view.state.doc.toString()).toBe(doc); expect(input()).toBeNull()
  })

  it("undo before another table maps its range without changing the active table", async () => {
    const table = "| 第二表 | 备注 |\n| --- | --- |\n| 独立内容 | 保留 |"
    const { ref, view, input, open } = await mount(doc + "\n\n" + table)
    open(0).setSelectionRange(0, 6); act(() => ref.current!.insertText("**加粗文字**")); await tick()
    open(1).setSelectionRange(2, 2)
    act(() => ref.current!.undo()); await tick()
    expect(view.state.doc.toString()).toBe(doc + "\n\n" + table)
    expect(input()?.value).toBe("独立内容"); expect(input()?.selectionStart).toBe(2); expect(document.activeElement).toBe(input())
  })

  it("header formatting history also preserves the header target", async () => {
    const { ref, input, open } = await mount()
    open(0, 0).setSelectionRange(0, 2)
    act(() => ref.current!.insertText("**加粗文字**")); await tick()
    act(() => ref.current!.undo()); await tick()
    expect(input()?.value).toBe("名称"); expect(input()?.closest("th")).not.toBeNull(); expect(document.activeElement).toBe(input())
  })

  it("an unchanged draft does not add a history entry", async () => {
    const { ref, view, input, open } = await mount()
    open().setSelectionRange(3, 3)
    act(() => ref.current!.undo()); await tick()
    expect(view.state.doc.toString()).toBe(doc); expect(undoDepth(view.state)).toBe(0)
    expect(input()?.selectionStart).toBe(3); expect(document.activeElement).toBe(input())
  })

  it("a new cell opened during format repaint keeps focus and receives subsequent typing", async () => {
    const { ref, view, input, open } = await mount()
    open().setSelectionRange(0, 6)
    let fresh: HTMLTextAreaElement | null = null
    const observer = new MutationObserver(() => {
      if (fresh || !host!.querySelector(".cm-md-table tbody tr")?.children[0].querySelector("strong")) return
      const cell = host!.querySelectorAll(".cm-md-table tbody tr")[1]?.children[1]
      if (!cell) return
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      fresh = input()
    })
    observer.observe(host!, { subtree: true, childList: true })
    act(() => ref.current!.insertText("**加粗文字**")); await tick()
    observer.disconnect()
    expect(fresh).not.toBeNull()
    expect(document.activeElement).toBe(fresh)
    expect(input()?.value).toBe("其他")
    act(() => {
      input()!.setRangeText("Z", input()!.selectionStart, input()!.selectionEnd, "end")
      input()!.dispatchEvent(new Event("input", { bubbles: true }))
      input()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }))
    })
    await tick()
    expect(view.state.doc.toString()).toBe(doc.replace("abcdef", "**abcdef**").replace("其他", "其他Z"))
    expect(input()?.value).toBe("第二项")
  })

  it("a table control focused during format repaint is not replaced by a cell input", async () => {
    const { ref, view, input, open } = await mount()
    open().setSelectionRange(0, 6)
    let control: HTMLButtonElement | null = null
    const observer = new MutationObserver(() => {
      if (control || !host!.querySelector(".cm-md-table tbody tr")?.children[0].querySelector("strong")) return
      control = host!.querySelector<HTMLButtonElement>(".cm-md-table-width-toggle")
      control?.focus()
    })
    observer.observe(host!, { subtree: true, childList: true })
    act(() => ref.current!.insertText("**加粗文字**")); await tick()
    observer.disconnect()
    expect(control).not.toBeNull()
    expect(document.activeElement).toBe(control)
    expect(input()).toBeNull()
    expect(view.state.doc.toString()).toBe(doc.replace("abcdef", "**abcdef**"))
  })

  it("a new cell opened during undo repaint cancels the previous cell restoration", async () => {
    const { ref, view, input, open } = await mount()
    open().setSelectionRange(0, 6)
    act(() => ref.current!.insertText("**加粗文字**")); await tick()
    let fresh: HTMLTextAreaElement | null = null
    const observer = new MutationObserver(() => {
      const first = host!.querySelector(".cm-md-table tbody tr")?.children[0]
      const cell = host!.querySelectorAll(".cm-md-table tbody tr")[1]?.children[1]
      if (fresh || !first || first.querySelector("strong") || !cell) return
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      fresh = input()
    })
    observer.observe(host!, { subtree: true, childList: true })
    act(() => ref.current!.undo()); await tick()
    observer.disconnect()
    expect(fresh).not.toBeNull()
    expect(document.activeElement).toBe(fresh)
    expect(input()?.value).toBe("其他")
    expect(view.state.doc.toString()).toBe(doc)
  })
})
