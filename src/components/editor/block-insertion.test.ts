// @vitest-environment jsdom
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { history, undo } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { afterEach, expect, it } from "vitest"
import { buildBlockInsertion, insertBlock, insertNoteTemplate } from "./block-insertion"
import { slashQuery } from "./slash-completion"

const views: EditorView[] = []
function view(doc: string, from = doc.length, to = from, readOnly = false) {
  const editor = new EditorView({ state: EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [history(), markdown(), EditorState.readOnly.of(readOnly)] }), parent: document.body })
  views.push(editor)
  return editor
}
afterEach(() => { views.forEach((editor) => editor.destroy()); views.length = 0; document.body.replaceChildren() })

it("脚注保留选中文字、避开已用引用和定义，一次撤销删除引用及定义", () => {
  const original = "文字[^note-1]\n\n[^note-2]: 已有说明"
  const editor = view(original, 0, 2)
  expect(insertBlock(editor, "footnote")).toBe(true)
  expect(editor.state.doc.toString()).toBe("文字[^note-3][^note-1]\n\n[^note-2]: 已有说明\n\n[^note-3]: 脚注内容\n")
  expect(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)).toBe("脚注内容")
  undo(editor)
  expect(editor.state.doc.toString()).toBe(original)
})

it("末尾斜杠替换为脚注，不吞正文；只读时不能写入", () => {
  const editor = view("正文\n/footnote")
  insertBlock(editor, "footnote", { from: 3, to: editor.state.doc.length })
  expect(editor.state.doc.toString()).toBe("正文\n[^note-1]\n\n[^note-1]: 脚注内容\n")
  expect(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)).toBe("脚注内容")
  expect(insertBlock(view("保持", 2, 2, true), "math")).toBe(false)
})

it("提示块包装多行选区，模板保留原文并使用本地日期", () => {
  expect(buildBlockInsertion("callout", "甲\n乙").content).toBe("> [!note] 提示\n> 甲\n> 乙")
  expect(buildBlockInsertion("meeting", "原文", "", new Date(2026, 9, 2)).content).toContain("日期：2026-10-02\n\n### 讨论内容\n\n原文")
  const editor = view("正文", 0, 2)
  insertNoteTemplate(editor, "## {{date}}\n{{cursor}}继续{{cursor}}")
  expect(editor.state.doc.toString()).not.toContain("{{")
  expect(editor.state.sliceDoc(editor.state.selection.main.head)).toBe("继续\n\n")
  undo(editor)
  expect(editor.state.doc.toString()).toBe("正文")
})

it("斜杠只在独立正文行触发，代码、路径、YAML 和非空选区保持普通输入", () => {
  expect(slashQuery(view("正文\n /math"))).toMatchObject({ from: 3, query: "math" })
  for (const doc of ["正文 /math", "https://", "```\n/math\n```", "---\n/math", "---\n/math\n---"]) {
    const head = doc.includes("/math") ? doc.indexOf("/math") + 5 : doc.length
    expect(slashQuery(view(doc, head)), doc).toBeNull()
  }
  expect(slashQuery(view("/math", 0, 5))).toBeNull()
})
