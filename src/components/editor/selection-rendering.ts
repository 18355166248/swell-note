import type { Extension } from "@codemirror/state"
import { drawSelection, EditorView } from "@codemirror/view"

type SelectionPlatform = Pick<Navigator, "maxTouchPoints" | "platform" | "userAgent">

export function shouldDrawCodeMirrorSelection(platform: SelectionPlatform = navigator) {
  // iOS WKWebView 依赖系统原生选区手柄和输入法 caret；桌面与 Android 交给 CodeMirror 自绘，
  // 再配合 CSS 隐掉原生高亮，避免两套选区在 WebView 里叠成碎片。
  const iosDevice = /iPad|iPhone|iPod/i.test(platform.userAgent)
    || (/MacIntel/i.test(platform.platform) && platform.maxTouchPoints > 1)
  return !iosDevice
}

export function selectionRenderingExtensions(platform?: SelectionPlatform): Extension {
  const rendering = shouldDrawCodeMirrorSelection(platform) ? "drawn" : "native"
  return [
    EditorView.editorAttributes.of({ "data-selection-rendering": rendering }),
    rendering === "drawn" ? drawSelection({ drawRangeCursor: false }) : [],
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
