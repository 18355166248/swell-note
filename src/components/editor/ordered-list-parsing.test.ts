// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { ensureSyntaxTree } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { markdownInputEnhancements } from "./markdown-input"

vi.mock("@codemirror/language", async importOriginal => {
  const language = await importOriginal<typeof import("@codemirror/language")>()
  return { ...language, ensureSyntaxTree: vi.fn(language.ensureSyntaxTree) }
})
afterEach(() => vi.mocked(ensureSyntaxTree).mockClear())
const source = "1. 第一项\n2. 第二项\n3. 第三项"
describe("结构命令等待完整解析", () => {
  it.each(["before", "after"])("%s 移动的语法解析未完成时保留原文，不留下半次操作", async phase => {
    const real = await vi.importActual<typeof import("@codemirror/language")>("@codemirror/language")
    const ensure = vi.mocked(ensureSyntaxTree)
    ensure.mockImplementation(real.ensureSyntaxTree)
    const view = new EditorView({ parent: document.body, state: EditorState.create({
      doc: source, selection: { anchor: 12 }, extensions: [markdown({ base: markdownLanguage }), markdownInputEnhancements()],
    }) })
    try {
      if (phase === "after") ensure.mockImplementationOnce(real.ensureSyntaxTree)
      ensure.mockReturnValueOnce(null)
      view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }))
      expect(view.state.doc.toString()).toBe(source)
      expect(view.state.selection.main.head).toBe(12)
    } finally { view.destroy() }
  })
})
