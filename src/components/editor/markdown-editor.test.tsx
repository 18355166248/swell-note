// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MarkdownEditorHandle } from "./markdown-editor"
import MarkdownEditor from "./markdown-editor"

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
