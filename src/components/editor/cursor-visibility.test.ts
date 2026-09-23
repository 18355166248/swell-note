import { describe, expect, it } from "vitest"

// @vitest-environment jsdom
import type { EditorView } from "@codemirror/view"
import { bottomOverlayHeightFromRects, clampBandByBars, computeScrollAdjustment, isVerticalScroller, keepTextareaCaretInVisibleBand, scrollElementIntoVisibleBand, syncCodeMirrorCaretPaint } from "./cursor-visibility"

// 可视带取编辑器滚动容器与底部工具栏之间的那段，键盘弹起后 bottom 会大幅上移。
const band = { bottom: 460, top: 60 }

describe("computeScrollAdjustment", () => {
  it("光标已在安全区内时不滚动", () => {
    expect(computeScrollAdjustment({ bottom: 300, top: 280 }, band)).toBe(0)
  })

  it("键盘压上来把光标盖住时，向下滚到露出光标并留出边距", () => {
    // 光标底 648，可视下界 460，留 24 边距：需要滚 648 - 436 = 212
    expect(computeScrollAdjustment({ bottom: 648, top: 620 }, band)).toBe(212)
  })

  it("光标贴着下边距时也会补上这一点距离", () => {
    expect(computeScrollAdjustment({ bottom: 450, top: 430 }, band)).toBe(14)
  })

  it("光标被顶到可视区上方时向上滚，返回负增量", () => {
    expect(computeScrollAdjustment({ bottom: 40, top: 20 }, band)).toBe(-64)
  })

  it("边距可调，跟随更贴近边缘", () => {
    expect(computeScrollAdjustment({ bottom: 450, top: 430 }, band, 0)).toBe(0)
  })

  it("可视带比两倍边距还窄时放弃跟随，避免在上下界之间来回弹", () => {
    expect(computeScrollAdjustment({ bottom: 500, top: 480 }, { bottom: 100, top: 70 })).toBe(0)
  })
})

describe("clampBandByBars", () => {
  // 横屏键盘下可视带本身就很窄，工具条只有真的遮住带的边缘才允许收缩它。
  it("底部工具条压住下沿时收缩下界", () => {
    expect(clampBandByBars({ bottom: 400, top: 100 }, [{ bottom: 420, top: 360 }])).toEqual({ bottom: 360, top: 100 })
  })

  it("顶部工具条压住上沿时收缩上界（横屏场景）", () => {
    expect(clampBandByBars({ bottom: 300, top: 80 }, [{ bottom: 120, top: 60 }])).toEqual({ bottom: 300, top: 120 })
  })

  it("完全在可视带之外的条不收缩（横屏键盘下位于带下方的工具条）", () => {
    const band = { bottom: 300, top: 80 }
    expect(clampBandByBars(band, [{ bottom: 460, top: 420 }])).toEqual(band)
    expect(clampBandByBars(band, [{ bottom: 40, top: 10 }])).toEqual(band)
  })

  it("工具条把整带盖满时压成空带，交给 computeScrollAdjustment 放弃滚动", () => {
    expect(clampBandByBars({ bottom: 300, top: 80 }, [{ bottom: 400, top: 0 }])).toEqual({ bottom: 300, top: 300 })
  })

  it("高度为零的条与上下两个方向的条组合时按相交部分逐个收缩", () => {
    const band = clampBandByBars({ bottom: 400, top: 100 }, [
      { bottom: 100, top: 100 },
      { bottom: 150, top: 60 },
      { bottom: 420, top: 360 },
    ])
    expect(band).toEqual({ bottom: 360, top: 150 })
  })
})

describe("bottomOverlayHeightFromRects", () => {
  it("只统计贴住可视区底边的条", () => {
    const height = bottomOverlayHeightFromRects(400, [
      { bottom: 400, top: 352 },
      { bottom: 120, top: 80 },
    ])
    expect(height).toBe(48)
  })

  it("横屏布局里位于其他位置的条不算下边距", () => {
    expect(bottomOverlayHeightFromRects(300, [{ bottom: 460, top: 420 }])).toBe(0)
    expect(bottomOverlayHeightFromRects(300, [{ bottom: 120, top: 80 }])).toBe(0)
  })

  it("底边与可视区底边相差 1px 以内视为贴底，容忍取整抖动", () => {
    expect(bottomOverlayHeightFromRects(400, [{ bottom: 399.4, top: 360 }])).toBeCloseTo(39.4)
  })
})

describe("isVerticalScroller", () => {
  it("overflowY 为 auto/scroll 且内容纵向溢出时是纵向滚动容器", () => {
    expect(isVerticalScroller({ overflowY: "auto", scrollHeight: 900, clientHeight: 500 })).toBe(true)
    expect(isVerticalScroller({ overflowY: "scroll", scrollHeight: 900, clientHeight: 500 })).toBe(true)
  })

  it("overflow-x:auto 的横滑层纵向没有溢出，不算纵向滚动容器", () => {
    // 横滑层的 overflow-y 计算值也是 auto，但 scrollHeight 与 clientHeight 相等
    expect(isVerticalScroller({ overflowY: "auto", scrollHeight: 240, clientHeight: 240 })).toBe(false)
  })

  it("overflowY 为 visible/hidden 时一律不算", () => {
    expect(isVerticalScroller({ overflowY: "visible", scrollHeight: 900, clientHeight: 500 })).toBe(false)
    expect(isVerticalScroller({ overflowY: "hidden", scrollHeight: 900, clientHeight: 500 })).toBe(false)
  })

  it("容忍 1px 的取整抖动", () => {
    expect(isVerticalScroller({ overflowY: "auto", scrollHeight: 501, clientHeight: 500 })).toBe(false)
  })
})

it("表格横滑层纵向也溢出时，仍滚动编辑器视口以露出输入框", () => {
  const viewport = document.createElement("div")
  viewport.dataset.slot = "scroll-area-viewport"
  const tableScroll = document.createElement("div")
  tableScroll.style.overflowX = "auto"
  tableScroll.style.overflowY = "auto"
  const input = document.createElement("textarea")
  viewport.appendChild(tableScroll)
  tableScroll.appendChild(input)
  document.body.appendChild(viewport)
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400, x: 0, y: 0, toJSON: () => ({}) })
  input.getBoundingClientRect = () => ({ top: 380, bottom: 420, left: 0, right: 100, width: 100, height: 40, x: 0, y: 380, toJSON: () => ({}) })
  try {
    scrollElementIntoVisibleBand(input, 12)
    expect(viewport.scrollTop).toBe(32)
    expect(tableScroll.scrollTop).toBe(0)
  } finally {
    viewport.remove()
  }
})

it("原生光标进入工具栏区域时隐藏，返回编辑区后恢复", () => {
  const editor = document.createElement("div")
  editor.className = "note-editor"
  const viewport = document.createElement("div")
  viewport.dataset.slot = "scroll-area-viewport"
  const input = document.createElement("textarea")
  const toolbar = document.createElement("div")
  toolbar.className = "formatting-toolbar"
  editor.append(viewport, toolbar)
  viewport.append(input)
  document.body.append(editor)
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400, x: 0, y: 0, toJSON: () => ({}) })
  toolbar.getBoundingClientRect = () => ({ top: 360, bottom: 420, left: 0, right: 300, width: 300, height: 60, x: 0, y: 360, toJSON: () => ({}) })
  let inputTop = 380
  input.getBoundingClientRect = () => ({ top: inputTop, bottom: inputTop + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: inputTop, toJSON: () => ({}) })
  try {
    keepTextareaCaretInVisibleBand(input, false)
    expect(input.style.caretColor).toBe("transparent")
    inputTop = 100
    keepTextareaCaretInVisibleBand(input, false)
    expect(input.style.caretColor).toBe("")
  } finally {
    editor.remove()
  }
})

it("iOS 正文光标滚到格式栏时隐藏，滚回正文后恢复", () => {
  const editor = document.createElement("div")
  editor.className = "note-editor"
  const viewport = document.createElement("div")
  viewport.dataset.slot = "scroll-area-viewport"
  const root = document.createElement("div")
  root.dataset.selectionRendering = "native"
  const content = document.createElement("div")
  root.append(content)
  viewport.append(root)
  const toolbar = document.createElement("div")
  toolbar.className = "formatting-toolbar"
  editor.append(viewport, toolbar)
  document.body.append(editor)
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400, x: 0, y: 0, toJSON: () => ({}) })
  toolbar.getBoundingClientRect = () => ({ top: 360, bottom: 420, left: 0, right: 300, width: 300, height: 60, x: 0, y: 360, toJSON: () => ({}) })
  let caretTop = 350
  const view = {
    dom: root,
    contentDOM: content,
    hasFocus: true,
    state: { selection: { main: { empty: true, head: 0 } } },
    coordsAtPos: () => ({ top: caretTop, bottom: caretTop + 30 }),
    lineBlockAt: () => ({ top: caretTop, bottom: caretTop + 30 }),
    documentTop: 0,
  } as unknown as EditorView
  try {
    syncCodeMirrorCaretPaint(view)
    expect(content.style.caretColor).toBe("transparent")
    caretTop = 100
    syncCodeMirrorCaretPaint(view)
    expect(content.style.caretColor).toBe("")
    // 系统 Range 与 CodeMirror 坐标不一致时，以真正在工具栏里的原生光标为准。
    content.textContent = "正文"
    const range = document.createRange()
    range.setStart(content.firstChild!, 1)
    range.collapse(true)
    range.getBoundingClientRect = () => ({ top: 350, bottom: 380, left: 0, right: 0, width: 0, height: 30, x: 0, y: 350, toJSON: () => ({}) })
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    syncCodeMirrorCaretPaint(view)
    expect(content.style.caretColor).toBe("transparent")
    selection.removeAllRanges()
  } finally {
    document.getSelection()?.removeAllRanges()
    editor.remove()
  }
})
