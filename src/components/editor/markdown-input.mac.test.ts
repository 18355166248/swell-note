// @vitest-environment jsdom
import { defaultKeymap, history, historyKeymap, undo } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { afterEach, describe, expect, it, vi } from "vitest"

import { markdownInputEnhancements } from "./markdown-input"

// CodeMirror determines its platform at module load, before an EditorView is created.
vi.hoisted(() => Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" }))
let currentView: EditorView | undefined
afterEach(() => { currentView?.destroy(); currentView = undefined })

function createView(anchor: number, head = anchor, doc = "第一段文字\n第二段文字\n第三段文字") {
  currentView = new EditorView({ parent: document.body, state: EditorState.create({
    doc, selection: { anchor, head },
    extensions: [markdown(), history(), markdownInputEnhancements(), keymap.of([...defaultKeymap, ...historyKeymap])],
  }) })
  return currentView
}

function press(view: EditorView, key: string, options: KeyboardEventInit = {}) {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...options }))
}

describe("macOS paragraph navigation with the default CodeMirror keymap installed", () => {
  it.each(["ArrowUp", "ArrowDown"])("Option+%s navigates without moving text", (key) => {
    const view = createView(8)
    const original = view.state.doc.toString()
    press(view, key, { altKey: true })
    expect(view.state.doc.toString()).toBe(original)
    expect(view.state.selection.main.head).toBe(key === "ArrowUp" ? 6 : 11)
    expect(undo(view)).toBe(false)
    view.destroy()
  })

  it.each(["ArrowUp", "ArrowDown"])("Shift+Option+%s extends the selection without copying text", (key) => {
    const view = createView(8)
    const original = view.state.doc.toString()
    press(view, key, { altKey: true, shiftKey: true })
    expect(view.state.doc.toString()).toBe(original)
    expect(view.state.selection.main.anchor).toBe(8)
    expect(view.state.selection.main.head).toBe(key === "ArrowUp" ? 6 : 11)
    view.destroy()
  })

  it("continues to the previous/next paragraph and stops at document boundaries", () => {
    const view = createView(6)
    press(view, "ArrowUp", { altKey: true })
    expect(view.state.selection.main.head).toBe(0)
    press(view, "ArrowUp", { altKey: true })
    expect(view.state.selection.main.head).toBe(0)
    view.dispatch({ selection: { anchor: 11 } })
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.selection.main.head).toBe(17)
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.selection.main.head).toBe(17)
    view.destroy()
  })

  it.each([false, true])("Cmd+Ctrl+Down retains structural actions and one-step undo (copy=%s)", (shiftKey) => {
    const doc = "1. 第一项\n2. 第二项\n3. 第三项"
    const view = createView(3, 3, doc)
    press(view, "ArrowDown", { ctrlKey: true, metaKey: true, shiftKey })
    expect(view.state.doc.toString()).toBe(shiftKey
      ? "1. 第一项\n2. 第一项\n3. 第二项\n4. 第三项"
      : "1. 第二项\n2. 第一项\n3. 第三项")
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })
})
