// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { history, historyKeymap } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"

import { markdownInputEnhancements } from "./markdown-input"

function createView(doc: string, anchor: number) {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage }), history(), markdownInputEnhancements(), keymap.of(historyKeymap)],
  })
  return new EditorView({ state, parent: document.body })
}

function press(view: EditorView, key: string, opts: KeyboardEventInit = {}) {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...opts }))
}

// basicSetup 自带 Alt+↑/↓ 移动、Shift+Alt+↑/↓ 复制整行（未在工具栏出现），但它们只逐行搬文本，
// 有序列表项挪位或被复制后编号仍留在原处。这里在同一按键上补一遍编号修正。
describe("moving/copying ordered list items keeps numbering sequential", () => {
  it("moving the first item down renumbers both items", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 3)
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 第二项\n2. 第一项\n3. 第三项")
    view.destroy()
  })

  it("moving an item up renumbers correctly", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 12) // 光标落在第 2 行
    press(view, "ArrowUp", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 第二项\n2. 第一项\n3. 第三项")
    view.destroy()
  })

  it("copying an item down renumbers the duplicate and everything after it", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 3)
    press(view, "ArrowDown", { altKey: true, shiftKey: true })
    expect(view.state.doc.toString()).toBe("1. 第一项\n2. 第一项\n3. 第二项\n4. 第三项")
    view.destroy()
  })

  it("preserves a custom start number instead of forcing 1", () => {
    const view = createView("5. 第一项\n6. 第二项\n7. 第三项", 3)
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.doc.toString()).toBe("5. 第二项\n6. 第一项\n7. 第三项")
    view.destroy()
  })

  it("renumbers a nested sublist independently of its outer list", () => {
    const doc = "1. 外层一\n   1. 内层一\n   2. 内层二\n   3. 内层三\n2. 外层二"
    const view = createView(doc, doc.indexOf("内层一"))
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 外层一\n   1. 内层二\n   2. 内层一\n   3. 内层三\n2. 外层二")
    view.destroy()
  })

  it("leaves bullet lists and plain paragraphs untouched", () => {
    const bullets = createView("- 要点一\n- 要点二\n- 要点三", 5)
    press(bullets, "ArrowDown", { altKey: true })
    expect(bullets.state.doc.toString()).toBe("- 要点二\n- 要点一\n- 要点三")
    bullets.destroy()

    const plain = createView("第一行\n第二行\n第三行", 2)
    press(plain, "ArrowDown", { altKey: true })
    expect(plain.state.doc.toString()).toBe("第二行\n第一行\n第三行")
    plain.destroy()
  })

  it("does nothing past a document boundary", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 3)
    press(view, "ArrowUp", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 第一项\n2. 第二项\n3. 第三项")
    view.destroy()
  })

  it("undoes the move and the renumbering together in one step", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 3)
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 第二项\n2. 第一项\n3. 第三项")
    press(view, "z", { ctrlKey: true })
    expect(view.state.doc.toString()).toBe("1. 第一项\n2. 第二项\n3. 第三项")
    view.destroy()
  })
})
