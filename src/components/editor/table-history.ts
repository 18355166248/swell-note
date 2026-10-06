import { ChangeSet, type EditorSelection, type Text } from "@codemirror/state"
import { diffChars } from "diff"

import type { EditorControl } from "./core/editor-control"
import { parseMarkdownTable, tableCellAt } from "./markdown-table-model"
import { restoreTableHistoryContext } from "./markdown-table-widget"
import { activeTableEdit, type TableHistoryContext } from "./table-edit-target"

type PendingRestore = {
  context: TableHistoryContext
  control: EditorControl
  doc: Text
  owner: object
  selection: EditorSelection
}

// 单元格输入不属于 CodeMirror 的正文选区。只在本次 history 命令仍拥有焦点和
// 文档时恢复逻辑单元格；重绘前连续撤销/重做沿用同一个待恢复目标。
export class TableHistoryController {
  private pending: PendingRestore | null = null
  private timer: number | null = null

  constructor(private currentControl: () => EditorControl | null, private currentOwner: () => object) {}

  cancel() {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }

  private owns(request: PendingRestore) {
    const view = request.control.getView()
    return this.currentControl() === request.control
      && this.currentOwner() === request.owner
      && view.dom.isConnected && !view.state.readOnly
      && view.state.doc === request.doc && view.state.selection.eq(request.selection)
      && view.hasFocus && !activeTableEdit(view)
  }

  run(forward: boolean) {
    const control = this.currentControl()
    // 工具栏也可能在中文候选词尚未确认时触发，不能把组合中的半个单元格先提交再撤销。
    if (!control || control.getSettings().readOnly || control.isComposing()) return
    const view = control.getView()
    const target = activeTableEdit(view)
    const context = target?.captureHistoryContext?.()
      ?? (this.pending && this.owns(this.pending) ? this.pending.context : null)
    this.cancel()
    const owner = this.currentOwner()
    let from = context?.from ?? 0
    let to = context?.to ?? 0
    // 提交草稿和 history 均同步派发事务；映射整段表格边界，不能凭表格序号
    // 或相同单元格文字去找目标，否则删除表格会误恢复到相邻的另一张表。
    const stop = control.on("documentChange", event => {
      for (const transaction of event.update?.transactions ?? []) {
        from = transaction.changes.mapPos(from, -1)
        to = transaction.changes.mapPos(to, 1)
      }
    })
    try {
      target?.commit()
      if (this.currentControl() !== control || this.currentOwner() !== owner || view.state.readOnly) return
      if (forward) control.redo()
      else control.undo()
    } finally { stop() }
    if (!context || from >= to) return
    const source = view.state.sliceDoc(from, to)
    const before = parseMarkdownTable(context.source)
    const after = parseMarkdownTable(source)
    if (!before || !after || before.header.length !== after.header.length || before.rows.length !== after.rows.length
      || context.column >= after.header.length || context.row >= after.rows.length) return
    const value = tableCellAt(after, context.row, context.column)
    const selection = mapCellSelection(context.value, value, context.selectionStart, context.selectionEnd)
    const request: PendingRestore = {
      context: { ...context, from, to, source, value, ...selection }, control,
      doc: view.state.doc, owner, selection: view.state.selection,
    }
    this.pending = request
    const restore = (attempt: number) => {
      this.timer = null
      if (this.pending !== request || !this.owns(request)) { this.pending = null; return }
      if (restoreTableHistoryContext(view, request.context)) { this.pending = null; return }
      // 表格装饰随后同步。重试有界；新输入、点击、只读或换会话都会作废请求。
      if (attempt < 2) this.timer = window.setTimeout(() => restore(attempt + 1), 16)
      else this.pending = null
    }
    this.timer = window.setTimeout(() => restore(0), 0)
  }
}

function mapCellSelection(before: string, after: string, from: number, to: number) {
  const diff = diffChars(before, after, { timeout: 20, maxEditLength: 2048 })
  const changes: Array<{ from: number; to?: number; insert?: string }> = []
  let offset = 0
  for (const part of diff ?? []) {
    if (part.added) changes.push({ from: offset, insert: part.value })
    else {
      if (part.removed) changes.push({ from: offset, to: offset + part.value.length })
      offset += part.value.length
    }
  }
  const clamp = (position: number) => Math.max(0, Math.min(position, after.length))
  if (!diff) return { selectionStart: clamp(from), selectionEnd: clamp(to) }
  const mapping = ChangeSet.of(changes, before.length)
  return {
    selectionStart: mapping.mapPos(Math.min(from, before.length), from === to ? 1 : -1),
    selectionEnd: mapping.mapPos(Math.min(to, before.length), 1),
  }
}
