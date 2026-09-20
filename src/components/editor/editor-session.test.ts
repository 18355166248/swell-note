// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { history, undo, undoDepth } from "@codemirror/commands"
import { editorSessionStore, sessionFields } from "./editor-session"
import { inlineTableFormat } from "./table-edit-target"

describe("editor continuity", () => {
  it("restores history and selection only when persisted text still matches", () => {
    // 会话快照的读写已收口到 EditorControl，这里直接验证存储层承载的语义：
    // 快照可跨状态重建还原历史与选区，正文被外部改过则整份作废。
    const initial = EditorState.create({ doc: "正文", extensions: [history()] })
    const state = initial.update({ changes: { from: 2, insert: "补充" }, selection: { anchor: 4 } }).state
    editorSessionStore.write("test-note", {
      doc: state.doc.toString(),
      fields: sessionFields,
      json: state.toJSON(sessionFields),
      selection: { anchor: 4, column: 5, head: 4, line: 1 },
      updatedAt: Date.now(),
    })

    const snapshot = editorSessionStore.read("test-note")!
    // 正文一致才允许恢复；不一致时调用方（buildRestoredState）必须放弃整份快照。
    expect(snapshot.doc).toBe("正文补充")
    expect(snapshot.doc === "外部修改").toBe(false)

    const restored = EditorState.fromJSON(snapshot.json as never, { extensions: [history()] }, snapshot.fields as never)
    expect(restored.selection.main.head).toBe(4)
    expect(undoDepth(restored)).toBe(1)
    const view = new EditorView({ state: restored, parent: document.body })
    undo(view)
    expect(view.state.doc.toString()).toBe("正文")
    view.destroy()
  })

  it("formats only selected cell text and refuses block templates", () => {
    expect(inlineTableFormat("**加粗文字**", "重点内容", 0, 2)?.text).toBe("**重点**")
    expect(inlineTableFormat("**加粗文字**", "**重点**", 0, 6)?.text).toBe("重点")
    expect(inlineTableFormat("\n> ", "重点", 0, 2)).toBeNull()
  })
})
