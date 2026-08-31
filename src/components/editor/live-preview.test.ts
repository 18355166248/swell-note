// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { DecorationSet, EditorView } from "@codemirror/view"
import { describe, expect, it, vi } from "vitest"

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
  const initialDecorations = view.state.field(tableDecorationsField)
  let decorations = initialDecorations
  // 表格装饰通过延迟 transaction 提交；首次渲染等非空结果，编辑后则等旧装饰被新版本替换。
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    decorations = view.state.field(tableDecorationsField)
    if (decorations !== initialDecorations && decorations.size > 0) break
  }
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
  it("keeps image Markdown visible while editing", async () => {
    const content = [
      "正文",
      "",
      "![标准图](../attachments/standard.png)",
      "![[截图.png|300]](../attachments/legacy.png)",
      "",
      "```md",
      "![代码图片](../attachments/code.png)",
      "```",
    ].join("\n")
    const view = createView({ anchor: 0 }, content)
    await settle()

    expect(view.contentDOM.querySelector(".cm-md-inline-image")).toBeNull()
    expect(view.contentDOM.textContent).toContain("![标准图](../attachments/standard.png)")
    expect(view.contentDOM.textContent).toContain("![[截图.png|300]](../attachments/legacy.png)")
    view.destroy()
  })

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
    expect(hidden).toContainEqual({ from: doc.indexOf("- [ ]"), to: doc.indexOf("[ ]") })
    expect(hidden).toContainEqual({ from: doc.indexOf("- [x]"), to: doc.indexOf("[x]") })
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

  it("keeps the rendered table when the cursor enters its source range", async () => {
    const view = createView({ anchor: tableDoc.indexOf("| 普通") + 2 }, tableDoc)
    const { tables } = collect(await settleTableDecorations(view))

    expect(tables).toHaveLength(1)
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

describe("markdown live preview table cells", () => {
  const cellDoc = [
    "正文",
    "",
    "| 字段 | 说明 |",
    "| --- | --- |",
    "| snake_case_name | 管道 a \\| b |",
    "| _强调_ | **重点** |",
  ].join("\n")

  async function tableDom(content: string, selection = { anchor: 0 }) {
    const view = createView(selection, content)
    const decorations = await settleTableDecorations(view)
    let widget: TableWidget | undefined
    const cursor = decorations.iter()
    while (cursor.value) {
      if (cursor.value.spec.widget instanceof TableWidget) widget = cursor.value.spec.widget
      cursor.next()
    }
    expect(widget).toBeDefined()
    return widget!.toDOM()
  }

  it("keeps identifiers with underscores intact", async () => {
    const cells = [...(await tableDom(cellDoc)).querySelectorAll("tbody td")]

    // 词内下划线不是强调，snake_case_name 必须原样保留。
    expect(cells[0].textContent).toBe("snake_case_name")
    expect(cells[0].querySelector("em")).toBeNull()
    // 词边界上的下划线仍然是强调。
    expect(cells[2].querySelector("em")?.textContent).toBe("强调")
    expect(cells[3].querySelector("strong")?.textContent).toBe("重点")
  })

  it("unescapes pipes inside cells", async () => {
    const cells = [...(await tableDom(cellDoc)).querySelectorAll("tbody td")]

    expect(cells[1].textContent).toBe("管道 a | b")
  })

  it("re-renders after an equal-length edit inside the table", async () => {
    const source = ["正文", "", "| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    // 同步合并与撤销都可能带来等长改写，位置和长度都不变，必须靠原文判断是否重绘。
    const from = source.indexOf("| 1 | 2 |")
    view.dispatch({ changes: { from, to: from + "| 1 | 2 |".length, insert: "| 8 | 9 |" } })
    const decorations = await settleTableDecorations(view)

    let widget: TableWidget | undefined
    const cursor = decorations.iter()
    while (cursor.value) {
      if (cursor.value.spec.widget instanceof TableWidget) widget = cursor.value.spec.widget
      cursor.next()
    }
    expect(widget?.toDOM().querySelector("tbody tr")?.textContent).toBe("89")
  })

  it("edits a cell in place without removing the rendered table", async () => {
    const source = ["正文", "", "| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const wrapper = view.contentDOM.querySelector(".cm-md-table-wrap")
    expect(wrapper).not.toBeNull()
    const firstCell = wrapper!.querySelector("tbody td") as HTMLTableCellElement
    firstCell.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    const input = firstCell.querySelector("textarea") as HTMLTextAreaElement
    expect(input).not.toBeNull()
    input.value = "9"
    input.dispatchEvent(new FocusEvent("blur"))
    await settle()

    expect(view.state.doc.toString()).toContain("| 9 | 2 |")
    expect(view.contentDOM.querySelector(".cm-md-table-wrap")).not.toBeNull()
    view.destroy()
  })

  it("keeps the rendered cell height when long content enters edit mode", async () => {
    const source = ["| 较长的表头内容 |", "| --- |", "| 较长的正文单元格内容 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const cell = view.contentDOM.querySelector("tbody td") as HTMLTableCellElement
    const display = cell.querySelector(".cm-md-table-cell-display") as HTMLDivElement
    vi.spyOn(display, "getBoundingClientRect").mockReturnValue({ height: 64 } as DOMRect)
    const scrollHeight = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(120)
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus")
    cell.click()

    const editor = cell.querySelector("textarea") as HTMLTextAreaElement
    const stack = cell.querySelector(".cm-md-table-cell-stack") as HTMLDivElement
    expect(editor).not.toBeNull()
    expect(cell.classList.contains("cm-md-table-cell-editing")).toBe(true)
    expect(cell.contains(display)).toBe(true)
    // 原始 Markdown 标记可能让编辑文本比渲染内容更高，聚焦时仍锁定原高度，避免整行抖动。
    expect(editor.style.height).toBe("64px")
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })

    editor.dispatchEvent(new Event("input", { bubbles: true }))
    expect(editor.style.height).toBe("120px")
    expect(stack.style.minHeight).toBe("120px")
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(cell.querySelector("textarea")).toBeNull()
    expect(cell.classList.contains("cm-md-table-cell-editing")).toBe(false)
    expect(cell.contains(display)).toBe(true)
    expect(stack.style.minHeight).toBe("")
    focus.mockRestore()
    scrollHeight.mockRestore()
    view.destroy()
  })

  it("keeps column widths stable after long text commits and supports keyboard resizing", async () => {
    window.localStorage.removeItem("swell-note:editor-table-width")
    const source = ["| A | B |", "| --- | --- |", "| 短文本 | 正常 |"].join("\n")
    const view = createView({ anchor: 0 }, source, { tableStorageKey: "width-stability-note" })
    await settle()

    const initialColumns = [...view.contentDOM.querySelectorAll<HTMLTableColElement>(".cm-md-table col")]
      .map((column) => column.dataset.configuredWidth)
    const cell = view.contentDOM.querySelector("tbody td") as HTMLTableCellElement
    cell.click()
    const input = cell.querySelector("textarea") as HTMLTextAreaElement
    input.value = "这是提交后也不应该重新分配列宽的很长文本内容"
    input.dispatchEvent(new Event("blur"))
    await settle()

    const wrapper = view.contentDOM.querySelector(".cm-md-table-wrap") as HTMLDivElement
    const committedColumns = [...wrapper.querySelectorAll<HTMLTableColElement>("col")]
      .map((column) => column.dataset.configuredWidth)
    expect(committedColumns).toEqual(initialColumns)

    const handles = wrapper.querySelectorAll<HTMLButtonElement>('.cm-md-table-resize-handle[role="separator"]')
    expect(handles).toHaveLength(1)
    handles[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }))
    expect(wrapper.dataset.widthMode).toBe("manual")
    expect(wrapper.querySelector(".cm-md-table-width-toggle")?.textContent).toBe("宽度：自定义")
    expect([...wrapper.querySelectorAll<HTMLTableColElement>("col")].map((column) => column.style.width))
      .toEqual(["56.25%", "43.75%"])
    // 自定义列宽只锁定比例，整表下限按列数计算，不能沿用历史像素总宽撑破窄窗口。
    expect(wrapper.querySelector<HTMLTableElement>("table")?.style.minWidth).toBe("144px")
    view.destroy()
  })

  it("commits the previous cell before editing another cell", async () => {
    const source = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const firstCell = view.contentDOM.querySelector("tbody td") as HTMLTableCellElement
    firstCell.click()
    const firstInput = firstCell.querySelector("textarea") as HTMLTextAreaElement
    firstInput.value = "已写回"

    const secondCell = view.contentDOM.querySelector("tbody td:nth-child(2)") as HTMLTableCellElement
    secondCell.click()
    await settle()

    expect(view.state.doc.toString()).toContain("| 已写回 | 2 |")
    expect(view.contentDOM.querySelectorAll(".cm-md-table-cell-input")).toHaveLength(1)
    expect(view.contentDOM.querySelector("tbody td:nth-child(2) textarea")).not.toBeNull()
    view.destroy()
  })

  it("adds rows and columns from the table toolbar", async () => {
    const source = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const buttons = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
    expect([...view.contentDOM.querySelectorAll(".cm-md-table-menu > summary")].map((summary) => summary.textContent))
      .toEqual(["行列", "水平", "垂直"])
    expect(view.contentDOM.querySelector(".cm-md-table-selection-status")?.textContent).toBe("未选择单元格")
    expect(buttons.map((button) => button.textContent)).toEqual([
      "宽度：适应",
      "添加行",
      "添加列",
      "删除行",
      "删除列",
      "左对齐",
      "居中",
      "右对齐",
      "顶对齐",
      "垂直居中",
      "底对齐",
    ])
    buttons[1].click()
    await settle()
    expect(view.state.doc.toString()).toContain("|  |  |")

    const addColumn = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "添加列")!
    addColumn.click()
    await settle()
    expect(view.state.doc.toString()).toContain("| A | B | 新列 |")
    view.destroy()
  })

  it("deletes the selected row and column while keeping a valid table", async () => {
    const source = ["| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const deleteRow = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "删除行")!
    const deleteColumn = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "删除列")!
    expect(deleteRow.disabled).toBe(true)
    expect(deleteColumn.disabled).toBe(true)

    const secondRowFirstCell = view.contentDOM.querySelector("tbody tr:nth-child(2) td") as HTMLTableCellElement
    secondRowFirstCell.click()
    expect(view.contentDOM.querySelector(".cm-md-table-selection-status")?.textContent).toBe("第 2 行 · 第 1 列")
    expect(deleteRow.disabled).toBe(false)
    expect(deleteColumn.disabled).toBe(false)
    deleteRow.click()
    await settle()
    expect(view.state.doc.toString()).toContain("| 1 | 2 |")
    expect(view.state.doc.toString()).not.toContain("| 3 | 4 |")

    const secondHeader = view.contentDOM.querySelector("thead th:nth-child(2)") as HTMLTableCellElement
    secondHeader.click()
    const refreshedDeleteColumn = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "删除列")!
    refreshedDeleteColumn.click()
    await settle()
    expect(view.state.doc.toString()).toBe(["| A |", "| --- |", "| 1 |"].join("\n"))

    const onlyHeader = view.contentDOM.querySelector("thead th") as HTMLTableCellElement
    onlyHeader.click()
    const protectedDeleteColumn = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "删除列")!
    expect(protectedDeleteColumn.disabled).toBe(true)
    view.destroy()
  })

  it("changes the selected column alignment", async () => {
    const source = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const secondCell = view.contentDOM.querySelector("tbody td:nth-child(2)") as HTMLTableCellElement
    secondCell.click()
    const center = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "居中")!
    expect(center.disabled).toBe(false)
    center.click()
    await settle()

    expect(view.state.doc.toString()).toContain("| --- | :---: |")
    expect((view.contentDOM.querySelector("tbody td:nth-child(2)") as HTMLTableCellElement).style.textAlign).toBe("center")
    view.destroy()
  })

  it("renders strikethrough links bare URLs and standard Markdown images inside cells", async () => {
    const content = [
      "| 类型 | 内容 |",
      "| --- | --- |",
      "| 删除线 | ~~旧内容~~ |",
      "| 链接 | [官网](https://example.com) |",
      "| 裸链接 | https://example.com/docs |",
      "| 图片 | ![示意图](https://example.com/a.png) |",
    ].join("\n")
    const dom = await tableDom(content)

    expect(dom.querySelector("del")?.textContent).toBe("旧内容")
    expect([...dom.querySelectorAll("a")].map((link) => link.textContent)).toEqual(["官网", "https://example.com/docs"])
    const image = dom.querySelector("img") as HTMLImageElement
    expect(image.alt).toBe("示意图")
    expect(image.src).toBe("https://example.com/a.png")
  })

  it("adds rows and columns while preserving the active cell edit", async () => {
    const source = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    // Chromium 对块级 replace widget 的 DOM 位置可能映射到范围末端；表格写回应使用解析阶段的确定位置。
    vi.spyOn(view, "posAtDOM").mockReturnValue(source.length)

    const firstCell = view.contentDOM.querySelector("tbody td") as HTMLTableCellElement
    firstCell.click()
    const input = firstCell.querySelector("textarea") as HTMLTextAreaElement
    input.value = "未提交"

    const addRow = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "添加行")!
    addRow.click()
    await settle()
    expect(view.state.doc.toString()).toContain("| 未提交 | 2 |")
    expect(view.state.doc.toString()).toContain("|  |  |")

    const editedCell = view.contentDOM.querySelector("tbody td") as HTMLTableCellElement
    editedCell.click()
    const editedInput = editedCell.querySelector("textarea") as HTMLTextAreaElement
    editedInput.value = "继续编辑"

    const addColumn = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "添加列")!
    addColumn.click()
    await settle()
    expect(view.state.doc.toString()).toContain("| A | B | 新列 |")
    expect(view.state.doc.toString()).toContain("| 继续编辑 | 2 |  |")
    view.destroy()
  })

  it("adds a row when the Markdown table has leading indentation", async () => {
    const source = ["  | A | B |", "  | --- | --- |", "  | 1 | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const addRow = [...view.contentDOM.querySelectorAll<HTMLButtonElement>(".cm-md-table-toolbar button")]
      .find((button) => button.textContent === "添加行")!
    addRow.click()
    await settle()

    expect(view.state.doc.toString()).toContain("| 1 | 2 |\n|  |  |")
    view.destroy()
  })

  it("switches between content and full width without resizing during cell editing", async () => {
    localStorage.removeItem("swell-note:editor-table-width")
    const source = ["| 短标题 | 更长的说明列 |", "| --- | --- |", "| 1 | 内容 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const wrapper = view.contentDOM.querySelector(".cm-md-table-wrap") as HTMLElement
    const table = wrapper.querySelector("table") as HTMLTableElement
    const initialWidth = table.style.width
    const initialColumns = [...table.querySelectorAll("col")].map((column) => column.getAttribute("style"))
    expect(wrapper.dataset.widthMode).toBe("content")
    expect(initialWidth).toMatch(/px$/)

    const cell = wrapper.querySelector("tbody td") as HTMLTableCellElement
    cell.click()
    const input = cell.querySelector("textarea") as HTMLTextAreaElement
    input.value = "输入一段明显更长但不应撑开列宽的内容"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    expect(table.style.width).toBe(initialWidth)
    expect([...table.querySelectorAll("col")].map((column) => column.getAttribute("style"))).toEqual(initialColumns)
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))

    const widthButton = wrapper.querySelector(".cm-md-table-width-toggle") as HTMLButtonElement
    widthButton.click()
    expect(wrapper.dataset.widthMode).toBe("full")
    expect(table.style.width).toBe("100%")
    expect(widthButton.textContent).toBe("宽度：铺满")
    expect(localStorage.getItem("swell-note:editor-table-width")).toBe("full")

    widthButton.click()
    expect(wrapper.dataset.widthMode).toBe("equal")
    expect(table.style.width).toBe("100%")
    expect(widthButton.textContent).toBe("宽度：均分")
    expect([...table.querySelectorAll<HTMLTableColElement>("col")].map((column) => column.style.width))
      .toEqual(["50%", "50%"])
    localStorage.removeItem("swell-note:editor-table-width")
    view.destroy()
  })

  it("switches vertical alignment as a display preference without rewriting Markdown", async () => {
    localStorage.removeItem("swell-note:editor-table-vertical-align")
    const source = ["| A | B |", "| --- | --- |", "| 短 | 较长内容 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const wrapper = view.contentDOM.querySelector(".cm-md-table-wrap") as HTMLElement
    const middle = wrapper.querySelector<HTMLButtonElement>('[data-table-vertical="middle"]')!
    const bottom = wrapper.querySelector<HTMLButtonElement>('[data-table-vertical="bottom"]')!
    expect(wrapper.dataset.verticalAlign).toBe("top")

    middle.click()
    expect(wrapper.dataset.verticalAlign).toBe("middle")
    expect(middle.getAttribute("aria-pressed")).toBe("true")
    expect(localStorage.getItem("swell-note:editor-table-vertical-align")).toBe("middle")
    expect(view.state.doc.toString()).toBe(source)

    bottom.click()
    expect(wrapper.dataset.verticalAlign).toBe("bottom")
    expect(bottom.getAttribute("aria-pressed")).toBe("true")
    expect(view.state.doc.toString()).toBe(source)
    localStorage.removeItem("swell-note:editor-table-vertical-align")
    view.destroy()
  })

  it("uses Tab to move cells and appends a row after the last cell", async () => {
    const source = ["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const lastCell = view.contentDOM.querySelector("tbody td:last-child") as HTMLTableCellElement
    lastCell.click()
    const input = lastCell.querySelector("textarea") as HTMLTextAreaElement
    input.value = "完成"
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }))
    await settle()

    expect(view.state.doc.toString()).toContain("| 1 | 完成 |")
    expect(view.state.doc.toString()).toContain("|  |  |")
    expect(view.contentDOM.querySelector("tbody tr:last-child td textarea")).not.toBeNull()
    view.destroy()
  })

  it("uses Shift+Enter for a portable line break inside a cell", async () => {
    const source = ["| 内容 |", "| --- |", "| 第一行 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const cell = view.contentDOM.querySelector("tbody td") as HTMLTableCellElement
    cell.click()
    const input = cell.querySelector("textarea") as HTMLTextAreaElement
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", shiftKey: true }))
    input.setRangeText("第二行", input.selectionStart, input.selectionEnd, "end")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new FocusEvent("blur"))
    await settle()

    expect(view.state.doc.toString()).toContain("| 第一行<br>第二行 |")
    expect(view.contentDOM.querySelector("tbody td br")).not.toBeNull()
    view.destroy()
  })

  it("restores formatted cell content when editing is cancelled", async () => {
    const source = ["| A | B |", "| --- | --- |", "| **重点** | 2 |"].join("\n")
    const view = createView({ anchor: 0 }, source)
    await settle()

    const firstCell = view.contentDOM.querySelector("tbody td") as HTMLTableCellElement
    firstCell.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    const input = firstCell.querySelector("textarea") as HTMLTextAreaElement
    input.value = "不保存"
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))

    expect(view.state.doc.toString()).toBe(source)
    expect(firstCell.querySelector("textarea")).toBeNull()
    expect(firstCell.querySelector("strong")?.textContent).toBe("重点")
    view.destroy()
  })
})

describe("markdown live preview links", () => {
  it("recognizes bare GFM urls while excluding code and existing Markdown links", async () => {
    const content = [
      "产品文档",
      "https://tapd.example.com/story/123",
      "带标点 https://example.com/docs。",
      "[正式链接](https://example.com/markdown)",
      "`https://example.com/code`",
    ].join("\n")
    const view = createView({ anchor: 0 }, content)
    const { marks } = collect(await settleInlineDecorations(view))
    const urls = markOf(marks, "cm-md-link-actionable")
      .map((mark) => mark.attributes?.["data-md-href"])

    expect(urls).toEqual([
      "https://tapd.example.com/story/123",
      "https://example.com/docs",
      "https://example.com/markdown",
    ])
  })

  it("hides markdown link urls and keeps the label", async () => {
    const view = createView({ anchor: 0 }, linkDoc)
    const { hidden, marks } = collect(await settleInlineDecorations(view))

    const start = linkDoc.indexOf("[文档]")
    const link = markOf(marks, "cm-md-link")
    const actionable = markOf(marks, "cm-md-link-actionable")
    expect(link).toHaveLength(1)
    expect(actionable[0].attributes?.["data-md-href"]).toBe("https://example.com")
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
    const actionable = markOf(marks, "cm-md-link-actionable")
    expect(wiki).toHaveLength(2)
    expect(actionable.filter((mark) => mark.attributes?.["data-wiki-target"])
      .map((mark) => mark.attributes?.["data-wiki-target"])).toEqual(["产品灵感", "原样"])
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

  it("opens link labels directly even while their source line is active", async () => {
    const opened: string[] = []
    const view = createView({ anchor: 0 }, linkDoc, { onOpenWikiLink: (target) => opened.push(target) })
    await settle()

    const element = view.contentDOM.querySelector("[data-wiki-target]")
    expect(element).not.toBeNull()
    element!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    expect(opened).toEqual(["产品灵感"])
    view.destroy()

    const activePosition = linkDoc.indexOf("产品灵感") + 2
    const activeView = createView({ anchor: activePosition }, linkDoc, { onOpenWikiLink: (target) => opened.push(target) })
    await settle()
    const activeElement = activeView.contentDOM.querySelector("[data-wiki-target]")
    expect(activeElement?.textContent).toBe("灵感")
    activeElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    expect(opened).toEqual(["产品灵感", "产品灵感"])

    const refreshedActiveElement = activeView.contentDOM.querySelector("[data-wiki-target]")
    refreshedActiveElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, metaKey: true }))
    activeView.destroy()
    expect(opened).toEqual(["产品灵感", "产品灵感", "产品灵感"])
  })

  it("treats standard relative Markdown files as note links", async () => {
    const opened: string[] = []
    const content = "查看 [标准笔记](../docs/标准%20笔记.md#目标)"
    const view = createView({ anchor: 0 }, content, { onOpenWikiLink: (target) => opened.push(target) })
    await settle()

    const element = view.contentDOM.querySelector("[data-md-note-target]")
    expect(element?.getAttribute("data-md-note-target")).toBe("../docs/标准 笔记.md#目标")
    element!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, metaKey: true }))
    view.destroy()
    expect(opened).toEqual(["../docs/标准 笔记.md#目标"])
  })

  it("opens the link at the cursor with modifier Enter", async () => {
    const opened: string[] = []
    const content = "查看 [标准笔记](../docs/标准.md)"
    const view = createView({ anchor: content.indexOf("标准笔记") + 2 }, content, {
      onOpenWikiLink: (target) => opened.push(target),
    })
    await settle()

    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", metaKey: true }))
    view.destroy()
    expect(opened).toEqual(["../docs/标准.md"])
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
