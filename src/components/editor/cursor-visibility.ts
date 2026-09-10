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

// 单看 overflowY 会误判：overflow-x:auto 的横滑层（如表格），其 overflow-y 计算值也会变成 auto，
// 但它纵向上并不滚动。必须同时确认内容真的在纵向溢出，才认它是纵向滚动容器。
export function isVerticalScroller({ overflowY, scrollHeight, clientHeight }: { overflowY: string; scrollHeight: number; clientHeight: number }) {
  if (overflowY !== "auto" && overflowY !== "scroll") return false
  return scrollHeight > clientHeight + 1
}

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (isVerticalScroller({ overflowY, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })) return node
  }
  return null
}

function findOverlayBars(container: HTMLElement) {
  return container.closest(".note-editor")?.querySelectorAll<HTMLElement>(".selection-action-bar,.formatting-toolbar")
}

// 工具条只有真正遮住可视带的对应边缘时才收缩它：竖屏格式栏压在底部、横屏布局里
// 它可能整条位于滚动区之外（完全不收缩），也可能从上沿盖住一部分。无条件取 min
// 会把可视带压成负值，滚动校正直接放弃（横屏键盘下单元格因此滚不进可见区）。
export function clampBandByBars(band: EdgeBand, bars: CursorRect[]): EdgeBand {
  let { bottom, top } = band
  for (const bar of bars) {
    if (bar.bottom - bar.top <= 0) continue
    if (bar.bottom <= top || bar.top >= bottom) continue
    if (bar.top <= top) top = Math.min(Math.max(top, bar.bottom), bottom)
    else bottom = bar.top
  }
  return { bottom, top }
}

// 底部悬浮条（格式栏 / 选区操作条）合计占高：scrollHandler 的固定边距感知不到它们，
// 文末行会正好藏到条子后面，由调用方把这个高度加进自己的下边距。
// 只统计贴住可视区底边的条；横屏等布局里位于其他位置的条不算下边距。
export function bottomOverlayHeightFromRects(visualBottom: number, bars: CursorRect[]): number {
  let height = 0
  for (const bar of bars) {
    if (bar.bottom - bar.top <= 0) continue
    if (bar.bottom >= visualBottom - 1 && bar.top < visualBottom) height += bar.bottom - bar.top
  }
  return height
}

export function bottomOverlayHeight(container: HTMLElement): number {
  const viewport = window.visualViewport
  const visualBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
  const rects = Array.from(findOverlayBars(container) ?? [], (bar) => bar.getBoundingClientRect())
  return bottomOverlayHeightFromRects(visualBottom, rects)
}

// 可视下界取底部工具栏的上沿：键盘之上还压着格式栏与选区操作条，只避开键盘仍然会被工具栏挡住。
function resolveVisibleBand(container: HTMLElement, scroller: HTMLElement): EdgeBand {
  const viewport = window.visualViewport
  const visualBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight
  const scrollerRect = scroller.getBoundingClientRect()
  const band = {
    bottom: Math.min(scrollerRect.bottom, visualBottom),
    top: Math.max(scrollerRect.top, viewport?.offsetTop ?? 0),
  }
  const rects = Array.from(findOverlayBars(container) ?? [], (bar) => bar.getBoundingClientRect())
  return clampBandByBars(band, rects)
}

export function scrollCursorIntoView(view: EditorView) {
  const cursor = view.coordsAtPos(view.state.selection.main.head)
  const scroller = findScrollParent(view.dom)
  if (!cursor || !scroller) return
  const delta = computeScrollAdjustment(cursor, resolveVisibleBand(view.dom, scroller))
  if (delta !== 0) scroller.scrollTop += delta
}

// 表格单元格的 textarea 持有焦点时 CodeMirror 本身失焦，光标跟随不会触发；
// 键盘弹起后由这里把正在编辑的单元格送回可视带（同样避开底部工具栏）。
export function scrollElementIntoVisibleBand(element: HTMLElement, margin = 12) {
  const scroller = findScrollParent(element)
  if (!scroller) return
  const delta = computeScrollAdjustment(element.getBoundingClientRect(), resolveVisibleBand(element, scroller), margin)
  if (delta !== 0) scroller.scrollTop += delta
}
