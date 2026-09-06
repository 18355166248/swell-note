// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { history, undo, undoDepth } from "@codemirror/commands"
import { rememberEditorSession, restoreEditorSession } from "./editor-session"
import { inlineTableFormat } from "./table-edit-target"

describe("editor continuity", () => {
  it("restores history and selection only when persisted text still matches", () => {
    const initial = EditorState.create({ doc: "正文", extensions: [history()] })
    const state = initial.update({ changes: { from: 2, insert: "补充" }, selection: { anchor: 4 } }).state
    rememberEditorSession("test-note", state)
    const session = restoreEditorSession("test-note", "正文补充")!
    const restored = EditorState.fromJSON(session.json, { extensions: [history()] }, session.fields)
    expect(restored.selection.main.head).toBe(4)
    expect(undoDepth(restored)).toBe(1)
    const view = new EditorView({ state: restored, parent: document.body })
    undo(view)
    expect(view.state.doc.toString()).toBe("正文")
    view.destroy()
    expect(restoreEditorSession("test-note", "外部修改")).toBeUndefined()
  })
  it("formats only selected cell text and refuses block templates", () => {
    expect(inlineTableFormat("**加粗文字**", "重点内容", 0, 2)?.text).toBe("**重点**")
    expect(inlineTableFormat("**加粗文字**", "**重点**", 0, 6)?.text).toBe("重点")
    expect(inlineTableFormat("\n> ", "重点", 0, 2)).toBeNull()
  })
})
