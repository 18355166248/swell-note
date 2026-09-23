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
  // 表格单元格位于横向滚动层内，WebKit 可能把该层的 overflow-y 计算成 auto，
  // 并因输入框高度的取整误差把它误判成纵向滚动容器。正文实际只由外层视口滚动。
  const editorViewport = element?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
  if (editorViewport) return editorViewport
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

function nativeContentCaretRect(view: EditorView): CursorRect | null {
  const selection = document.getSelection()
  if (!selection?.isCollapsed || !selection.anchorNode || !view.contentDOM.contains(selection.anchorNode) || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (typeof range.getBoundingClientRect !== "function") return null
  const rect = range.getBoundingClientRect()
  return rect.height > 0 ? rect : null
}

function editorCaretRect(view: EditorView): CursorRect {
  const head = view.state.selection.main.head
  const native = view.dom.dataset.selectionRendering === "native" ? nativeContentCaretRect(view) : null
  if (native) return native
  // 虚拟化卸载文末行时 coordsAtPos 会为空；行块位置仍能用于先滚回可见区域。
  const block = view.lineBlockAt(head)
  return view.coordsAtPos(head) ?? {
    top: view.documentTop + block.top,
    bottom: view.documentTop + block.bottom,
  }
}

export function syncCodeMirrorCaretPaint(view: EditorView) {
  if (view.dom.dataset.selectionRendering !== "native") return
  const content = view.contentDOM
  if (!view.hasFocus || !view.state.selection.main.empty) {
    content.style.removeProperty("caret-color")
    return
  }
  const scroller = findScrollParent(view.dom)
  if (!scroller) return
  const band = resolveVisibleBand(view.dom, scroller)
  const caret = editorCaretRect(view)
  // iOS 的插入线可能比 CodeMirror 测得的行框更长，临近工具栏时保留余量。
  if (caret.top >= band.top && caret.bottom <= band.bottom - 16) content.style.removeProperty("caret-color")
  else content.style.caretColor = "transparent"
}

export function scrollCursorIntoView(view: EditorView) {
  const scroller = findScrollParent(view.dom)
  if (!scroller) return
  const cursor = editorCaretRect(view)
  const delta = computeScrollAdjustment(cursor, resolveVisibleBand(view.dom, scroller), view.dom.dataset.selectionRendering === "native" ? 32 : 24)
  if (delta !== 0) scroller.scrollTop += delta
  syncCodeMirrorCaretPaint(view)
}

// 表格单元格的 textarea 持有焦点时 CodeMirror 本身失焦，光标跟随不会触发；
// 键盘弹起后由这里把正在编辑的单元格送回可视带（同样避开底部工具栏）。
export function scrollElementIntoVisibleBand(element: HTMLElement, margin = 12) {
  const scroller = findScrollParent(element)
  if (!scroller) return
  const delta = computeScrollAdjustment(element.getBoundingClientRect(), resolveVisibleBand(element, scroller), margin)
  if (delta !== 0) scroller.scrollTop += delta
}

function textareaCaretRect(input: HTMLTextAreaElement): CursorRect {
  const style = getComputedStyle(input)
  const inputRect = input.getBoundingClientRect()
  // textarea 的原生光标没有可读取的 DOM Range。用同宽、同字体的镜像只测光标所在行，
  // 不改选区和输入法组合态；表格单元格较高时不能拿整个输入框的底边代替光标位置。
  const mirror = document.createElement("div")
  Object.assign(mirror.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    visibility: "hidden",
    boxSizing: style.boxSizing,
    width: `${inputRect.width}px`,
    padding: style.padding,
    border: style.border,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    textIndent: style.textIndent,
    whiteSpace: "pre-wrap",
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    tabSize: style.tabSize,
  })
  mirror.append(document.createTextNode(input.value.slice(0, input.selectionEnd ?? 0)))
  const marker = document.createElement("span")
  marker.textContent = "\u200b"
  mirror.append(marker)
  document.body.append(mirror)
  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  mirror.remove()
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2 || 24
  const top = inputRect.top + markerRect.top - mirrorRect.top - input.scrollTop
  return { top, bottom: top + lineHeight }
}

// WKWebView 的原生插入光标可能独立于 DOM 层级绘制，z-index 盖不住它。
// 先把光标所在行滚回编辑区；若滚动已到极限或动画尚未结束，暂时关掉原生 caret，
// 滚动/布局变化后再测量并恢复，避免蓝色竖线画到快捷操作栏上。
export function keepTextareaCaretInVisibleBand(input: HTMLTextAreaElement, scroll = true): boolean {
  const scroller = findScrollParent(input)
  if (!scroller) return false
  const band = resolveVisibleBand(input, scroller)
  const caret = textareaCaretRect(input)
  const before = scroller.scrollTop
  if (scroll) {
    const delta = computeScrollAdjustment(caret, band, 12)
    if (delta !== 0) scroller.scrollTop += delta
  }
  const moved = Math.abs(scroller.scrollTop - before) > 0.5
  const visible = caret.top >= band.top && caret.bottom <= band.bottom
  if (visible) input.style.removeProperty("caret-color")
  else input.style.caretColor = "transparent"
  return moved
}
