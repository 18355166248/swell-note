// @vitest-environment jsdom
import type { EditorView } from "@codemirror/view"
import { afterEach, describe, expect, it, vi } from "vitest"

import { scrollCursorIntoView } from "./cursor-visibility"

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("键盘缩小可视区后的光标跟随", () => {
  function setup(cursor: { top: number; bottom: number } | null) {
    const scroller = document.createElement("div")
    const editor = document.createElement("div")
    scroller.style.overflowY = "auto"
    scroller.append(editor)
    document.body.append(scroller)
    Object.defineProperties(scroller, {
      clientHeight: { value: 300 },
      scrollHeight: { value: 2000 },
    })
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 400 } as DOMRect)
    const view = {
      dom: editor,
      documentTop: 100,
      state: { selection: { main: { head: 1800 } } },
      coordsAtPos: () => cursor,
      lineBlockAt: () => ({ top: 800, bottom: 830 }),
    } as unknown as EditorView
    return { scroller, view }
  }

  it("文末行已被虚拟化卸载时仍能滚回可见范围", () => {
    const { scroller, view } = setup(null)
    scrollCursorIntoView(view)
    expect(scroller.scrollTop).toBe(554) // 行底 930 - 可见底 400 + 安全边距 24
  })

  it("已有精确光标坐标时，不用整段高度强行滚动", () => {
    const { scroller, view } = setup({ top: 250, bottom: 270 })
    scrollCursorIntoView(view)
    expect(scroller.scrollTop).toBe(0)
  })
})
