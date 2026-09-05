// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { history, historyKeymap } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"

import { focusExistingLinkUrl, markdownInputEnhancements, toggleInlineMark } from "./markdown-input"

function createView(doc: string, anchor: number, head = anchor) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
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

// Cmd+B/Cmd+I 与工具栏的加粗/斜体/删除线/行内代码按钮共用这一路径：选区已经在对应标记
// 里面时应当「再点一次就取消」，而不是在外面再套一层，否则连续按会越叠越多层。
describe("toggleInlineMark", () => {
  it("wraps plain selected text when there is no existing mark", () => {
    const view = createView("这是 加粗 文字", 3, 5)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 **加粗** 文字")
    view.destroy()
  })

  it("unwraps when the selection is exactly the inner text", () => {
    const view = createView("这是 **加粗** 文字", 5, 7)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    expect(view.state.selection.main.from).toBe(3)
    expect(view.state.selection.main.to).toBe(5)
    view.destroy()
  })

  it("unwraps with an empty cursor placed inside the bold run", () => {
    const view = createView("这是 **加粗** 文字", 6)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    view.destroy()
  })

  it("unwraps even when the selection swallows the markers themselves", () => {
    const view = createView("这是 **加粗** 文字", 3, 9)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    view.destroy()
  })

  it("does not treat italic as bold", () => {
    const view = createView("这是 *斜体* 文字", 6)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 *斜体**加粗文字*** 文字")
    view.destroy()
  })

  it("toggles the outer bold when the cursor sits in a nested italic run", () => {
    const view = createView("**外层*内层*外层**", 5)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("外层*内层*外层")
    view.destroy()
  })

  it("toggles strikethrough and inline code through the same path", () => {
    const strike = createView("这是 ~~删除~~ 文字", 6)
    toggleInlineMark(strike, "strike", "删除线文字")
    expect(strike.state.doc.toString()).toBe("这是 删除 文字")
    strike.destroy()

    const code = createView("这是 `代码` 文字", 6)
    toggleInlineMark(code, "code", "行内代码")
    expect(code.state.doc.toString()).toBe("这是 代码 文字")
    code.destroy()
  })

  it("inserts the placeholder template when there is no selection and no enclosing mark", () => {
    const view = createView("这是文字", 2)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是**加粗文字**文字")
    view.destroy()
  })

  it("participates in undo/redo like a normal edit", () => {
    const view = createView("这是 **加粗** 文字", 6)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    press(view, "z", { ctrlKey: true })
    expect(view.state.doc.toString()).toBe("这是 **加粗** 文字")
    press(view, "y", { ctrlKey: true })
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    view.destroy()
  })
})

// Cmd+K 在光标（无选区）落在已有链接文字里时，此前会在原文字中间插一段新链接，
// 拼出嵌套错乱的 Markdown；现在改成直接选中已有链接的 URL 方便就地改地址。
describe("focusExistingLinkUrl", () => {
  it("selects the URL when the empty cursor sits inside an existing link's label", () => {
    const doc = "这是 [已有链接](https://example.com) 结尾"
    const view = createView(doc, doc.indexOf("有链接"))
    expect(focusExistingLinkUrl(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)
    const selection = view.state.selection.main
    expect(view.state.sliceDoc(selection.from, selection.to)).toBe("https://example.com")
    view.destroy()
  })

  it("leaves a real selection alone so the caller falls back to wrapping", () => {
    const doc = "这是 [已有链接](https://example.com) 结尾"
    const from = doc.indexOf("有链接")
    const view = createView(doc, from, from + 2)
    expect(focusExistingLinkUrl(view)).toBe(false)
    view.destroy()
  })

  it("does nothing outside any link", () => {
    const view = createView("这是普通文字，没有链接", 3)
    expect(focusExistingLinkUrl(view)).toBe(false)
    view.destroy()
  })

  it("does nothing for a bracket-only link with no URL child", () => {
    const doc = "这是 [笔记双链] 结尾"
    const view = createView(doc, doc.indexOf("笔记"))
    expect(focusExistingLinkUrl(view)).toBe(false)
    view.destroy()
  })
})
