// @vitest-environment jsdom
import { history, redo, undo } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it } from "vitest"

import { markdownLivePreview } from "./live-preview"
import { activeTableEdit } from "./table-edit-target"
import { tableWidgetApiFor } from "./table-widget-registry"

// jsdom 没有布局，Range 的矩形 API 缺失；CodeMirror 撤销后异步测量会踩到，补空实现。
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
}

// 表格 Widget 交互回归：单击编辑、键盘导航、矩形选区、剪贴板与撤销。
// 样本与 e2e/table-editing.spec.ts 对齐，但全部走 jsdom 内的事件分发，运行更快。
const doc = [
  "前段文字。",
  "",
  "| 名称 | 状态 | 备注 |",
  "| --- | :---: | --- |",
  "| 苹果 | 新鲜 | 重点 |",
  "| 香蕉 | 一般 | 普通 |",
  "| 樱桃 | 过期 | 残余 |",
  "",
  "后段文字。",
].join("\n")

function createView(content = doc) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: content,
      extensions: [history(), markdown({ base: markdownLanguage }), markdownLivePreview({})],
    }),
  })
  return view
}

// 表格装饰经延迟 transaction 提交，等 widget 挂载完成。
async function settle() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (document.querySelector(".cm-md-table-wrap")) return
  }
  throw new Error("表格装饰未就绪")
}

function wrapper() {
  const element = document.querySelector<HTMLElement>(".cm-md-table-wrap")
  expect(element).toBeTruthy()
  return element!
}

// row -1 为表头，0 起为正文行，与 data-row-index 一致。
function cellAt(row: number, column: number) {
  const rows = wrapper().querySelectorAll<HTMLTableRowElement>(".cm-md-table tr")
  const tr = rows[row + 1]
  expect(tr).toBeTruthy()
  return tr.children[column] as HTMLElement
}

function clickCell(row: number, column: number, init: MouseEventInit = {}) {
  const cell = cellAt(row, column)
  cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init }))
  cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }))
}

function keydown(target: Element, init: KeyboardEventInit) {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }))
}

function cellInput() {
  return wrapper().querySelector<HTMLTextAreaElement>(".cm-md-table-cell-input")
}

function docText() {
  return view!.state.doc.toString()
}

// 提交后的重新聚焦走 setTimeout（先重建表格，再点击目标格），等一拍让新输入框出现。
async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function typeInto(input: HTMLTextAreaElement, text: string) {
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  input.setRangeText(text, start, end, "end")
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

// jsdom 没有 ClipboardEvent/DataTransfer；事件对象只需要冒泡与 clipboardData 读取接口。
function clipboardEvent(type: string, data: Record<string, string>) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (format: string) => data[format] ?? "",
      setData: (format: string, value: string) => { data[format] = value },
    },
  })
  return event
}

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
  document.body.innerHTML = ""
})

describe("单元格编辑与键盘导航", () => {
  it("Enter 提交并下移，末行自动补行；Tab 跨列回绕；Escape 放弃输入", async () => {
    view = createView()
    await settle()

    // Enter：提交并移到下一行同列。
    clickCell(0, 0)
    const first = cellInput()!
    expect(first.value).toBe("苹果")
    typeInto(first, "X")
    keydown(first, { key: "Enter" })
    await tick()
    expect(docText()).toContain("| 苹果X | 新鲜 | 重点 |")
    // 提交后焦点落在下一行单元格的输入框里。
    const second = cellInput()!
    expect(second.value).toBe("香蕉")

    // Tab 到行末后继续 Tab 回绕到下一行第一列。
    keydown(second, { key: "Tab" })
    await tick()
    const third = cellInput()!
    expect(third.value).toBe("一般")
    keydown(third, { key: "Tab" })
    await tick()
    const fourth = cellInput()!
    expect(fourth.value).toBe("普通")
    keydown(fourth, { key: "Tab" })
    await tick()
    const fifth = cellInput()!
    expect(fifth.value).toBe("樱桃")

    // 末行末列 Tab：自动补一行空行并落进去。
    keydown(fifth, { key: "Tab" })
    await tick()
    keydown(cellInput()!, { key: "Tab" })
    await tick()
    keydown(cellInput()!, { key: "Tab" })
    await tick()
    expect(docText()).toContain("|  |  |  |")

    // Escape：放弃未提交的输入，表格内容不变。
    clickCell(0, 0)
    await tick()
    const editing = cellInput()!
    typeInto(editing, "不应提交")
    keydown(editing, { key: "Escape" })
    await tick()
    expect(cellInput()).toBeNull()
    expect(docText()).not.toContain("不应提交")
    expect(docText()).toContain("| 苹果X | 新鲜 | 重点 |")
  })

  it("编辑中点击另一个单元格：先提交再切换，输入不丢不重", async () => {
    view = createView()
    await settle()

    clickCell(0, 0)
    typeInto(cellInput()!, "X")
    clickCell(1, 1)
    await tick()
    expect(docText()).toContain("| 苹果X | 新鲜 | 重点 |")
    expect(docText().match(/苹果X/g)).toHaveLength(1)
    const input = cellInput()!
    expect(input.value).toBe("一般")
  })
})

describe("矩形选区与剪贴板", () => {
  async function dragRange(anchor: [number, number], focus: [number, number]) {
    clickCell(...anchor)
    const cell = cellAt(...focus)
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, shiftKey: true }))
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, shiftKey: true }))
    await settle()
  }

  it("多格选区持焦时粘贴写入选区左上角，不落正文旧光标", async () => {
    view = createView()
    await settle()
    // 先把正文光标留在「前段文字。」中间，模拟表格操作前的过期选区。
    view.dispatch({ selection: { anchor: 2 } })
    await dragRange([0, 0], [1, 1])

    const before = docText()
    wrapper().dispatchEvent(clipboardEvent("paste", { "text/plain": "虎\t狮\n狼\t豹" }))
    await tick()
    const after = docText()
    // 粘贴必须作用于表格选区；正文一个字都不能动。
    expect(after).toContain("前段文字。")
    expect(after).toContain("| 虎 | 狮 | 重点 |")
    expect(after).toContain("| 狼 | 豹 | 普通 |")
    expect(after).toContain("| 樱桃 | 过期 | 残余 |")
    // 一次撤销恢复整次粘贴。
    undo(view!)
    expect(docText()).toBe(before)
    redo(view!)
    expect(docText()).toBe(after)
  })

  it("选区持焦时粘贴不给正文插入任何内容", async () => {
    view = createView()
    await settle()
    view.dispatch({ selection: { anchor: 0 } })
    await dragRange([1, 1], [2, 2])
    wrapper().dispatchEvent(clipboardEvent("paste", { "text/plain": "外来内容" }))
    await tick()
    expect(docText()).not.toContain("外来内容前段")
    expect(docText()).toContain("前段文字。")
  })

  it("格内换行的 Excel 粘贴优先走 TSV，换行不粘连", async () => {
    view = createView()
    await settle()
    clickCell(0, 0)
    const input = cellInput()!
    // Excel 同源剪贴板：TSV 用引号包住格内换行；HTML 用 <br> 表示，textContent 会把它吃掉。
    input.dispatchEvent(clipboardEvent("paste", {
      "text/html": '<table><tr><td>第一行<br>第二行</td><td>旁</td></tr></table>',
      "text/plain": '"第一行\n第二行"\t旁',
    }))
    await tick()
    // 序列化后格内换行是 <br>；若走了 HTML 的 textContent，两行会粘成「第一行第二行」。
    expect(docText()).toContain("第一行<br>第二行")
    expect(docText()).not.toContain("第一行第二行")
    expect(docText()).toContain("| 第一行<br>第二行 | 旁 | 重点 |")
  })

  it("剪切选区：剪贴板内容与删除范围一致，一次撤销恢复", async () => {
    view = createView()
    await settle()
    await dragRange([0, 0], [1, 1])
    const data: Record<string, string> = {}
    document.dispatchEvent(clipboardEvent("cut", data))
    await tick()
    expect(data["text/plain"]).toBe("苹果\t新鲜\n香蕉\t一般")
    expect(docText()).toContain("|  |  | 重点 |")
    expect(docText()).toContain("|  |  | 普通 |")
    expect(docText()).toContain("| 樱桃 | 过期 | 残余 |")
    undo(view!)
    await tick()
    expect(docText()).toContain("| 苹果 | 新鲜 | 重点 |")
  })

  it("选区在表格边缘时粘贴更大网格向外扩展，范围外不动", async () => {
    view = createView()
    await settle()
    // 选最后一行右侧 1×2，粘 2×3：表格向右扩一列、向下扩一行，其余单元格原样。
    await dragRange([2, 1], [2, 2])
    wrapper().dispatchEvent(clipboardEvent("paste", { "text/plain": "甲\t乙\t丙\n丁\t戊\t己" }))
    await tick()
    expect(docText()).toContain("| 樱桃 | 甲 | 乙 | 丙 |")
    expect(docText()).toContain("|  | 丁 | 戊 | 己 |")
    expect(docText()).toContain("| 苹果 | 新鲜 | 重点 |  |")
    expect(docText()).toContain("| 名称 | 状态 | 备注 |  |")
    // 一次撤销恢复整张表的结构与内容。
    undo(view!)
    await tick()
    expect(docText()).toContain("| 樱桃 | 过期 | 残余 |")
    expect(docText()).not.toContain("|  | 丁 | 戊 | 己 |")
  })

  it("删除选区行后旧选区不残留，撤销恢复结构", async () => {
    view = createView()
    await settle()
    await dragRange([1, 0], [2, 1])
    expect(wrapper().querySelectorAll(".cm-md-table-cell-in-range")).toHaveLength(4)
    const api = tableWidgetApiFor(wrapper())?.api
    expect(api).toBeTruthy()
    api!.deleteRows()
    await tick()
    expect(docText()).not.toContain("香蕉")
    expect(docText()).not.toContain("樱桃")
    expect(docText()).toContain("| 苹果 | 新鲜 | 重点 |")
    // 删除明确清掉选区：高亮不能留在看不见的旧范围上。
    expect(wrapper().querySelectorAll(".cm-md-table-cell-in-range")).toHaveLength(0)
    undo(view!)
    await tick()
    expect(docText()).toContain("| 香蕉 | 一般 | 普通 |")
    expect(docText()).toContain("| 樱桃 | 过期 | 残余 |")
  })
})

describe("撤销与重做", () => {
  it("多格选区持焦时 Cmd+Z 撤销最近一次表格修改", async () => {
    view = createView()
    await settle()
    clickCell(0, 0)
    typeInto(cellInput()!, "X")
    keydown(cellInput()!, { key: "Enter" })
    await tick()
    expect(docText()).toContain("苹果X")

    // 建立选区把焦点交给 wrapper，再按 Cmd+Z：应撤销刚才的单元格提交。
    const cell = cellAt(1, 1)
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, shiftKey: true }))
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, shiftKey: true }))
    await tick()
    keydown(wrapper(), { key: "z", metaKey: true })
    await tick()
    expect(docText()).not.toContain("苹果X")
    expect(docText()).toContain("| 苹果 | 新鲜 | 重点 |")
    keydown(wrapper(), { key: "z", metaKey: true, shiftKey: true })
    await tick()
    expect(docText()).toContain("苹果X")
  })

  it("连续单元格提交逐步撤销，重做一致", async () => {
    view = createView()
    await settle()
    clickCell(0, 0)
    typeInto(cellInput()!, "一")
    keydown(cellInput()!, { key: "Tab" })
    await tick()
    typeInto(cellInput()!, "二")
    keydown(cellInput()!, { key: "Enter" })
    await tick()
    expect(docText()).toContain("| 苹果一 | 新鲜二 | 重点 |")

    undo(view!)
    await tick()
    expect(docText()).toContain("| 苹果一 | 新鲜 | 重点 |")
    expect(docText()).not.toContain("新鲜二")
    undo(view!)
    await tick()
    expect(docText()).toContain("| 苹果 | 新鲜 | 重点 |")
    redo(view!)
    await tick()
    expect(docText()).toContain("| 苹果一 | 新鲜 | 重点 |")
    redo(view!)
    await tick()
    expect(docText()).toContain("| 苹果一 | 新鲜二 | 重点 |")
  })

  it("编辑中执行工具栏撤销：提交后撤销同一改动，不跳过其他操作", async () => {
    view = createView()
    await settle()
    clickCell(2, 2)
    typeInto(cellInput()!, "早")
    keydown(cellInput()!, { key: "Enter" })
    await tick()
    expect(docText()).toContain("残余早")

    // 再编辑另一格但不提交，模拟 runHistory 的「先提交再撤销」。
    clickCell(0, 0)
    await tick()
    typeInto(cellInput()!, "新")
    activeTableEdit(view)?.commit()
    await tick()
    expect(docText()).toContain("苹果新")
    undo(view!)
    await tick()
    // 撤销的是刚提交的「苹果新」，前一步「残余早」必须还在。
    expect(docText()).not.toContain("苹果新")
    expect(docText()).toContain("残余早")
  })
})
