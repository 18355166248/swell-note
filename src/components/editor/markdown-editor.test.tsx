// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MarkdownEditorHandle } from "./markdown-editor"
import MarkdownEditor, { findPlainTextMatches, formatToolbarText } from "./markdown-editor"

// React 19 在测试里要求显式打开 act 环境标记。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement | null = null
let root: Root | null = null

function mount(element: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(element) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

describe("MarkdownEditor", () => {
  it("finds plain text without case sensitivity and keeps offsets", () => {
    expect(findPlainTextMatches("Swell note SWELL", "swell")).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ])
    expect(findPlainTextMatches("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ])
    expect(findPlainTextMatches("正文", "")).toEqual([])
  })

  it("finds and replaces through the editor handle", () => {
    const handle = createRef<MarkdownEditorHandle>()
    const onChange = vi.fn()
    mount(<MarkdownEditor onChange={onChange} ref={handle} value="第一处 TODO，第二处 todo" />)

    expect(handle.current!.findText("todo", "next", true)).toEqual({ current: 1, total: 2 })
    expect(handle.current!.replaceCurrent("todo", "完成")).toEqual({ current: 1, total: 1 })
    expect(handle.current!.replaceAll("todo", "完成")).toBe(1)
    expect(onChange).toHaveBeenLastCalledWith("第一处 完成，第二处 完成", expect.anything())
  })

  it("formats the current selection instead of discarding it", () => {
    expect(formatToolbarText("**加粗文字**", "重点").text).toBe("**重点**")
    expect(formatToolbarText("\n> ", "第一行\n第二行").text).toBe("> 第一行\n> 第二行")
    expect(formatToolbarText("\n```\n\n```\n", "const value = 1").text)
      .toBe("\n```\nconst value = 1\n```\n")
    expect(formatToolbarText("[链接](https://)", "官网")).toEqual({
      selection: { from: 5, to: 13 },
      text: "[官网](https://)",
    })
  })

  it("reports the cursor position through the latest callback", () => {
    const handle = createRef<MarkdownEditorHandle>()
    const first = vi.fn()
    mount(<MarkdownEditor onChange={() => {}} onCursorChange={first} ref={handle} value={"第一行\n第二行"} />)

    // 换成新的内联回调后仍要生效：扩展经 ref 中转，不随回调身份重建。
    const second = vi.fn()
    act(() => {
      root!.render(<MarkdownEditor onChange={() => {}} onCursorChange={second} ref={handle} value={"第一行\n第二行"} />)
    })

    act(() => { handle.current!.insertText("补充") })

    expect(second).toHaveBeenCalledWith(1, 3)
    expect(first).not.toHaveBeenCalled()
  })
})
