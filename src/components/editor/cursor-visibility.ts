import type { EditorView } from "@codemirror/view"

// 编辑器自身不滚动（.cm-scroller 是 overflow: visible），滚动发生在外层 ScrollArea，
// CodeMirror 的 scrollIntoView 够不到那个容器。手机键盘弹起时可视区被压掉一半，
// 光标常常正好落在键盘或底部工具栏后面，得由这里把它送回可见范围。

export type EdgeBand = { bottom: number; top: number }
export type CursorRect = { bottom: number; top: number }

// 返回需要施加到 scrollTop 的增量：正数向下滚，负数向上滚，0 表示光标已经在安全区内。
export function computeScrollAdjustment(cursor: CursorRect, band: EdgeBand, margin = 24): number {
  // 可视高度还不够放下一行加边距时，不折腾滚动，否则会在上下边界之间来回弹。
  if (band.bottom - band.top <= margin * 2) return 0
  if (cursor.bottom > band.bottom - margin) return Math.round(cursor.bottom - (band.bottom - margin))
  if (cursor.top < band.top + margin) return Math.round(cursor.top - (band.top + margin))
  return 0
}

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === "auto" || overflowY === "scroll") return node
  }
  return null
}

// 可视下界取底部工具栏的上沿：键盘之上还压着格式栏与选区操作条，只避开键盘仍然会被工具栏挡住。
function resolveVisibleBand(view: EditorView, scroller: HTMLElement): EdgeBand {
  const viewport = window.visualViewport
  const visualBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
  const scrollerRect = scroller.getBoundingClientRect()
  const bars = view.dom.closest(".note-editor")?.querySelectorAll<HTMLElement>(".selection-action-bar,.formatting-toolbar")
  let bottom = Math.min(scrollerRect.bottom, visualBottom)
  for (const bar of bars ?? []) bottom = Math.min(bottom, bar.getBoundingClientRect().top)
  return { bottom, top: Math.max(scrollerRect.top, viewport?.offsetTop ?? 0) }
}

export function scrollCursorIntoView(view: EditorView) {
  const cursor = view.coordsAtPos(view.state.selection.main.head)
  const scroller = findScrollParent(view.dom)
  if (!cursor || !scroller) return
  const delta = computeScrollAdjustment(cursor, resolveVisibleBand(view, scroller))
  if (delta !== 0) scroller.scrollTop += delta
}
