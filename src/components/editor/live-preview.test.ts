// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { DecorationSet, EditorView } from "@codemirror/view"
import { describe, expect, it } from "vitest"

import type { LivePreviewOptions } from "./live-preview"
import { markdownLivePreview, markdownLivePreviewPlugin, tableDecorationsField, TableWidget, TaskCheckboxWidget } from "./live-preview"

const doc = [
  "# 标题",
  "",
  "**加粗**正文",
  "",
  "- [ ] 待办",
  "- [x] 完成",
  "",
  "> 引用",
].join("\n")

const tableDoc = [
  "# 表格示例",
  "",
  "| 列 A | 列 B |",
  "| --- | :---: |",
  "| **重点** | `code` |",
  "| 普通 | 2 |",
].join("\n")

const linkDoc = [
  "---",
  "title: 属性",
  "tags: [a, b]",
  "---",
  "",
  "外链 [文档](https://example.com) 内链 [[产品灵感|灵感]] 与 [[原样]]",
  "",
  "嵌入 ![[封面.png]]",
  "",
  "---",
  "",
  "```js",
  'const a = "[[代码里的]]"',
  "```",
].join("\n")

function createView(selection?: { anchor: number }, content = doc, options: LivePreviewOptions = {}) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: content,
      extensions: [markdown({ base: markdownLanguage }), markdownLivePreview(options)],
      selection,
    }),
  })
}

// 语法解析与表格装饰的延迟提交都需要事件循环空转，短暂等待后装饰已就绪。
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

async function settleInlineDecorations(view: EditorView): Promise<DecorationSet> {
  await settle()
  const decorations = view.plugin(markdownLivePreviewPlugin)?.decorations
  view.destroy()
  expect(decorations).toBeDefined()
  return decorations!
}

async function settleTableDecorations(view: EditorView): Promise<DecorationSet> {
  await settle()
  const decorations = view.state.field(tableDecorationsField)
  view.destroy()
  return decorations
}

type DecorationSpec = { attributes?: Record<string, string>; class?: string; widget?: unknown }

function collect(decorations: DecorationSet) {
  const classes: string[] = []
  const hidden: Array<{ from: number; to: number }> = []
  const checkboxes: Array<{ checked: boolean; from: number }> = []
  const tables: Array<{ from: number; to: number }> = []
  const marks: Array<{ attributes?: Record<string, string>; class: string; from: number; to: number }> = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const spec = (cursor.value.spec ?? {}) as DecorationSpec
    if (spec.class) classes.push(...spec.class.split(" "))
    if (spec.class && !spec.widget) marks.push({ attributes: spec.attributes, class: spec.class, from: cursor.from, to: cursor.to })
    if (!spec.class && !spec.widget && cursor.from < cursor.to) hidden.push({ from: cursor.from, to: cursor.to })
    if (spec.widget instanceof TaskCheckboxWidget) checkboxes.push({ checked: spec.widget.checked, from: spec.widget.from })
    if (spec.widget instanceof TableWidget) tables.push({ from: cursor.from, to: cursor.to })
    cursor.next()
  }
  return { checkboxes, classes, hidden, marks, tables }
}

function markOf(marks: ReturnType<typeof collect>["marks"], className: string) {
  return marks.filter((mark) => mark.class.split(" ").includes(className))
}

describe("markdown live preview", () => {
  it("styles headings, quotes and hides inline marks away from the cursor", async () => {
    const view = createView({ anchor: 0 })
    const { checkboxes, classes, hidden } = collect(await settleInlineDecorations(view))

    expect(classes).toContain("cm-md-h1")
    expect(classes).toContain("cm-md-strong")
    expect(classes).toContain("cm-md-quote")
    expect(hidden).toContainEqual({ from: doc.indexOf("**"), to: doc.indexOf("**") + 2 })
    expect(hidden).not.toContainEqual({ from: 0, to: 1 })
    expect(checkboxes).toEqual([
      { checked: false, from: doc.indexOf("[ ]") },
      { checked: true, from: doc.indexOf("[x]") },
    ])
  })

  it("reveals raw syntax on the cursor line", async () => {
    const boldLine = doc.indexOf("**加粗**")
    const view = createView({ anchor: boldLine + 3 })
    const { hidden } = collect(await settleInlineDecorations(view))

    expect(hidden).not.toContainEqual({ from: boldLine, to: boldLine + 2 })
  })

  it("renders tables as block widgets away from the cursor", async () => {
    const view = createView({ anchor: 0 }, tableDoc)
    const { tables } = collect(await settleTableDecorations(view))

    expect(tables).toHaveLength(1)
    expect(tables[0].from).toBe(tableDoc.indexOf("| 列 A"))
    expect(tables[0].to).toBe(tableDoc.indexOf("| 普通 | 2 |") + "| 普通 | 2 |".length)
  })

  it("reveals raw table source when the cursor enters the table", async () => {
    const view = createView({ anchor: tableDoc.indexOf("| 普通") + 2 }, tableDoc)
    const { tables } = collect(await settleTableDecorations(view))

    expect(tables).toHaveLength(0)
  })

  it("renders table widget dom with alignment and inline syntax", async () => {
    const view = createView({ anchor: 0 }, tableDoc)
    const decorations = await settleTableDecorations(view)

    let widget: TableWidget | undefined
    const cursor = decorations.iter()
    while (cursor.value) {
      if (cursor.value.spec.widget instanceof TableWidget) widget = cursor.value.spec.widget
      cursor.next()
    }
    expect(widget).toBeDefined()

    const dom = widget!.toDOM()
    const headerCells = Array.from(dom.querySelectorAll("th"))
    expect(headerCells).toHaveLength(2)
    expect(headerCells[1].style.textAlign).toBe("center")
    // 单元格内行内语法以真实元素渲染，而非原始 Markdown 文本。
    const firstBodyCell = dom.querySelector("tbody tr td")!
    expect(firstBodyCell.querySelector("strong")?.textContent).toBe("重点")
    expect(dom.querySelectorAll("tbody tr")).toHaveLength(2)
  })
})

describe("markdown live preview links", () => {
  it("hides markdown link urls and keeps the label", async () => {
    const view = createView({ anchor: 0 }, linkDoc)
    const { hidden, marks } = collect(await settleInlineDecorations(view))

    const start = linkDoc.indexOf("[文档]")
    const link = markOf(marks, "cm-md-link")
    expect(link).toHaveLength(1)
    expect(link[0].attributes?.["data-md-href"]).toBe("https://example.com")
    // 只留下链接文本：方括号与 (url) 两段都被隐藏。
    expect(hidden).toContainEqual({ from: start, to: start + 1 })
    expect(hidden).toContainEqual({ from: start + "[文档".length, to: linkDoc.indexOf(")", start) + 1 })
  })

  it("renders wiki links with and without aliases", async () => {
    const view = createView({ anchor: 0 }, linkDoc)
    const { hidden, marks } = collect(await settleInlineDecorations(view))

    const aliased = linkDoc.indexOf("[[产品灵感|灵感]]")
    const plain = linkDoc.indexOf("[[原样]]")
    const wiki = markOf(marks, "cm-md-wiki-link")
    expect(wiki.map((mark) => mark.attributes?.["data-wiki-target"])).toEqual(["产品灵感", "原样"])
    // 带别名时目标与竖线一起隐藏，只显示别名。
    expect(hidden).toContainEqual({ from: aliased, to: aliased + "[[产品灵感|".length })
    expect(hidden).toContainEqual({ from: plain, to: plain + 2 })
    expect(hidden).toContainEqual({ from: plain + "[[原样".length, to: plain + "[[原样]]".length })
  })

  it("keeps embeds and fenced code untouched", async () => {
    const view = createView({ anchor: 0 }, linkDoc)
    const { hidden, marks } = collect(await settleInlineDecorations(view))

    const embed = linkDoc.indexOf("![[封面.png]]")
    expect(markOf(marks, "cm-md-wiki-embed")).toHaveLength(1)
    // 嵌入没有等价的编辑器渲染形态，只上色不隐藏标记。
    expect(hidden).not.toContainEqual({ from: embed + 1, to: embed + 3 })
    // 代码块里的 [[...]] 属于代码语义，完全不参与装饰。
    const inCode = linkDoc.indexOf("[[代码里的]]")
    expect(marks.some((mark) => mark.from <= inCode && mark.to >= inCode + 2 && mark.class.includes("wiki"))).toBe(false)
  })

  it("reveals wiki link source on the cursor line", async () => {
    const aliased = linkDoc.indexOf("[[产品灵感|灵感]]")
    const view = createView({ anchor: aliased + 3 }, linkDoc)
    const { hidden } = collect(await settleInlineDecorations(view))

    expect(hidden).not.toContainEqual({ from: aliased, to: aliased + "[[产品灵感|".length })
  })

  it("opens wiki links on modifier click only", async () => {
    const opened: string[] = []
    const view = createView({ anchor: 0 }, linkDoc, { onOpenWikiLink: (target) => opened.push(target) })
    await settle()

    const element = view.contentDOM.querySelector("[data-wiki-target]")
    expect(element).not.toBeNull()
    element!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    expect(opened).toEqual([])

    element!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, metaKey: true }))
    view.destroy()
    expect(opened).toEqual(["产品灵感"])
  })
})

describe("markdown live preview frontmatter and rules", () => {
  it("styles frontmatter instead of rendering it as a setext heading", async () => {
    const view = createView({ anchor: linkDoc.length }, linkDoc)
    const { classes, hidden, marks } = collect(await settleInlineDecorations(view))

    expect(classes).toContain("cm-md-frontmatter")
    expect(classes).toContain("cm-md-frontmatter-fence")
    expect(classes).not.toContain("cm-md-h2")
    expect(markOf(marks, "cm-md-frontmatter")).toHaveLength(4)
    // frontmatter 的 --- 必须保持可见，否则属性区与正文无法区分。
    expect(hidden).not.toContainEqual({ from: 0, to: 3 })
  })

  it("hides horizontal rule text away from the cursor", async () => {
    const view = createView({ anchor: 0 }, linkDoc)
    const { classes, hidden } = collect(await settleInlineDecorations(view))

    const rule = linkDoc.indexOf("---", linkDoc.indexOf("![[封面.png]]"))
    expect(classes).toContain("cm-md-hr")
    expect(hidden).toContainEqual({ from: rule, to: rule + 3 })
  })
})
