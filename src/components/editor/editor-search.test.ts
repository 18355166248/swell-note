import { EditorState } from "@codemirror/state"
import { expect, it } from "vitest"
import { beginEditorSearch, configureEditorSearch, editorMatches, editorSearchState, endEditorSearch } from "./editor-search"
import { externalDocumentChange } from "./core/editor-control"

it("整篇外部回写使旧范围失效，不能把原选区替换扩大到整篇", () => {
  let state = EditorState.create({ doc: "猫 猫", extensions: [editorSearchState] })
  state = state.update({ effects: [beginEditorSearch.of({ from: 0, to: 1 }), configureEditorSearch.of({ query: "猫", inSelection: true })] }).state
  state = state.update({ changes: { from: 0, to: 3, insert: "猫 新正文 猫" }, annotations: externalDocumentChange.of(true) }).state
  expect(editorMatches(state, "猫")).toEqual([])
  expect(state.field(editorSearchState).decorations.size).toBe(0)
})

it("初始选区随正文事务映射，查找自身的选区不能改变范围", () => {
  let state = EditorState.create({ doc: "猫 猫 猫", extensions: [editorSearchState], selection: { anchor: 2, head: 3 } })
  state = state.update({ effects: [beginEditorSearch.of({ from: 2, to: 3 }), configureEditorSearch.of({ query: "猫", inSelection: true })] }).state
  state = state.update({ selection: { anchor: 0, head: 1 } }).state
  expect(editorMatches(state, "猫")).toEqual([{ from: 2, to: 3 }])
  state = state.update({ changes: { from: 0, insert: "前缀 " } }).state
  expect(editorMatches(state, "猫")).toEqual([{ from: 5, to: 6 }])
  state = state.update({ changes: { from: 5, to: 6, insert: "猫咪" } }).state
  expect(state.field(editorSearchState).selectionRange).toEqual({ from: 5, to: 7 })
  expect(editorMatches(state, "猫")).toEqual([{ from: 5, to: 6 }])
  state = state.update({ effects: endEditorSearch.of() }).state
  expect(state.field(editorSearchState).decorations.size).toBe(0)
})

it("独立高亮随编辑和选区更新，关闭后不修改正文或选区", () => {
  let state = EditorState.create({ doc: "cat Cat cat", extensions: [editorSearchState] })
  state = state.update({ effects: configureEditorSearch.of({ query: "cat", caseSensitive: true }) }).state
  expect(state.field(editorSearchState).decorations.size).toBe(2)
  state = state.update({ changes: { from: state.doc.length, insert: " cat" }, selection: { anchor: 0, head: 3 } }).state
  expect(state.field(editorSearchState).decorations.size).toBe(3)
  const selection = state.selection
  state = state.update({ effects: endEditorSearch.of() }).state
  expect(state.selection.eq(selection)).toBe(true)
  expect(state.doc.toString()).toBe("cat Cat cat cat")
})
