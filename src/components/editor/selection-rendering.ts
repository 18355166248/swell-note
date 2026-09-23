import type { Extension } from "@codemirror/state"
import { drawSelection, EditorView } from "@codemirror/view"

export function selectionRenderingExtensions(): Extension {
  return [
    EditorView.editorAttributes.of({ "data-selection-rendering": "drawn" }),
    // iOS 的系统插入线由 WKWebView 单独绘制，会越过网页工具栏。交给 CodeMirror
    // 绘制光标和选区，编辑焦点与键盘仍归 contenteditable；默认保留 iOS 选区手柄。
    drawSelection({ drawRangeCursor: false, iosSelectionHandles: true }),
    EditorView.updateListener.of(({ view }) => syncTableSelection(view)),
  ]
}

function syncTableSelection(view: EditorView) {
  // iOS 原生 Range 不会可靠染色整表 Widget；桌面自绘也会跳过选区首尾的块级 Widget。
  // 在 DOM 更新后按源码范围补齐整表选中态，滚动挂载的新表格也能同步；
  // 仅覆盖完整表格时染色，避免把局部文字选区误显示成整表全选。
  for (const table of view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-wrap")) {
    const from = Number(table.dataset.tableFrom)
    const to = Number(table.dataset.tableTo)
    const selected = Number.isFinite(from) && Number.isFinite(to) && to > from
      && view.state.selection.ranges.some((range) => range.from <= from && range.to >= to)
    table.toggleAttribute("data-document-selected", selected)
  }
}
