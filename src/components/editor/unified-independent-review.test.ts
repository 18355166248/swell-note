// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import { collectUnifiedRichBlocks } from "./unified-rich-block"

function state(doc: string) {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
}

// 独立评审关注源文档边界：一个范围只能属于一个结果块，不能因嵌套标记让整篇编辑器崩溃。
describe("统一编辑独立评审：富块范围", () => {
  it("数学块内看似 Mermaid 的文本只能属于外层数学块", () => {
    const doc = "前文\n\n$$\n```mermaid\ngraph LR\nA-->B\n```\n$$\n\n后文"
    const blocks = collectUnifiedRichBlocks(state(doc))
    expect(blocks.map((block) => block.kind)).toEqual(["math"])
    expect(blocks[0].source).toBe("$$\n```mermaid\ngraph LR\nA-->B\n```\n$$")
  })

  it("YAML 属性中的公式字面量不能当成正文公式", () => {
    const doc = "---\nlatex: |\n  $$\n  x + y\n  $$\n---\n\n正文"
    expect(collectUnifiedRichBlocks(state(doc))).toEqual([])
  })

  it("有效 Mermaid 后的正文与第二个公式分别保留独立范围", () => {
    const doc = "```mermaid\ngraph LR\nA-->B\n```\n\n必须保留的正文\n\n$$x^2$$"
    const blocks = collectUnifiedRichBlocks(state(doc))
    expect(blocks.map((block) => block.kind)).toEqual(["mermaid", "math"])
    expect(doc.slice(blocks[0].to, blocks[1].from)).toContain("必须保留的正文")
  })
})
