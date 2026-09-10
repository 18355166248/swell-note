import type { EditorView } from "@codemirror/view"

import { detectInlineMarksInText, inlineMarkEditInText, type InlineMarkKind } from "./markdown-input"

export type TableEditTarget = {
  input: HTMLTextAreaElement
  commit: () => void
  cancel: () => void
  format: (template: string) => void
  // 改写指定区间并提交、留在当前单元格继续编辑（链接面板这类非固定模板的写入用）。
  replace: (from: number, to: number, text: string) => void
}
const targets = new WeakMap<EditorView, TableEditTarget>()

// 表格 textarea 与正文 CodeMirror 各有选区；所有工具栏动作先查活动目标，不能落回旧正文光标。
export function activeTableEdit(view: EditorView | undefined) {
  if (!view) return undefined
  const target = targets.get(view)
  return target?.input.isConnected ? target : undefined
}
export function registerTableEdit(view: EditorView, target: TableEditTarget) {
  targets.set(view, target)
  return () => { if (targets.get(view) === target) targets.delete(view) }
}

export type CellInlineMarks = { code: boolean; emphasis: boolean; strike: boolean; strong: boolean }

// 工具栏的格式高亮：与正文 detectFormatState 共用同一套语义判断（Markdown 语法树），
// 不再用「左右紧邻字符」猜——加粗的两个星号不会再被误判成斜体标记。
export function detectCellInlineMarks(value: string, from: number, to: number): CellInlineMarks {
  return detectInlineMarksInText(value, from, to)
}

// 单元格行内格式与正文 toggleInlineMark 共用同一份规则（局部取消、占位插入、
// 代码围栏长度都一致）。textarea 的 setRangeText 一次只能替换一个连续区间，
// 这里取所有改动的包围区间，在字符串上应用后返回。
export function inlineTableFormat(template: string, value: string, from: number, to: number) {
  const inlineMarks: Record<string, [InlineMarkKind, string]> = {
    "**加粗文字**": ["strong", "加粗文字"], "*斜体文字*": ["emphasis", "斜体文字"],
    "~~删除线文字~~": ["strike", "删除线文字"], "`行内代码`": ["code", "行内代码"],
  }
  const mark = inlineMarks[template]
  if (mark) {
    const edit = inlineMarkEditInText(value, from, to, mark[0], mark[1])
    if (!edit) return null
    let text = value
    for (let index = edit.changes.length - 1; index >= 0; index--) {
      const change = edit.changes[index]
      text = text.slice(0, change.from) + change.insert + text.slice(change.to)
    }
    const first = edit.changes[0]
    const last = edit.changes[edit.changes.length - 1]
    return { from: first.from, to: last.to, text: text.slice(first.from, first.from + (last.to - first.from) + (text.length - value.length)) }
  }
  const selected = value.slice(from, to)
  if (template === "[链接](https://)") return { from, to, text: `[${selected || "链接"}](https://)` }
  // 单元格不支持块语法；阻止把标题、整张表格等插入正文的旧选区。
  if (/^\n/.test(template)) return null
  return { from, to, text: template }
}
