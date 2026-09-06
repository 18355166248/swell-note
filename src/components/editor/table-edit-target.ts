import type { EditorView } from "@codemirror/view"

export type TableEditTarget = {
  input: HTMLTextAreaElement
  commit: () => void
  cancel: () => void
  format: (template: string) => void
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

export function inlineTableFormat(template: string, value: string, from: number, to: number) {
  const tokens: Record<string, [string, string]> = {
    "**加粗文字**": ["**", "加粗文字"], "*斜体文字*": ["*", "斜体文字"],
    "~~删除线文字~~": ["~~", "删除线文字"], "`行内代码`": ["`", "行内代码"],
  }
  const selected = value.slice(from, to)
  const pair = tokens[template]
  if (pair) {
    const [mark, placeholder] = pair
    if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length * 2) {
      return { from, to, text: selected.slice(mark.length, -mark.length) }
    }
    if (value.slice(from - mark.length, from) === mark && value.slice(to, to + mark.length) === mark) {
      return { from: from - mark.length, to: to + mark.length, text: selected }
    }
    return { from, to, text: `${mark}${selected || placeholder}${mark}` }
  }
  if (template === "[链接](https://)") return { from, to, text: `[${selected || "链接"}](https://)` }
  // 单元格不支持块语法；阻止把标题、整张表格等插入正文的旧选区。
  if (/^\n/.test(template)) return null
  return { from, to, text: template }
}
