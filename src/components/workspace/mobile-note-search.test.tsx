// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MobileNoteSearch } from "./mobile-note-search"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement | null = null
let root: Root | null = null

function mount(onSearch = vi.fn(), onClear?: () => void) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <MobileNoteSearch
        onClear={onClear}
        onSearch={onSearch}
        placeholder="搜索笔记"
        value=""
      />,
    )
  })
  return {
    clear: () => container!.querySelector<HTMLButtonElement>("[aria-label='清空搜索']"),
    input: container.querySelector<HTMLInputElement>("input")!,
    onSearch,
  }
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function dispatch(input: HTMLInputElement, event: Event) {
  act(() => { input.dispatchEvent(event) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

describe("MobileNoteSearch", () => {
  it("输入过程只更新草稿，确认搜索后才提交并关闭键盘", () => {
    const onSearch = vi.fn()
    const view = mount(onSearch)
    view.input.focus()
    type(view.input, "  测试笔记  ")

    expect(onSearch).not.toHaveBeenCalled()
    dispatch(view.input, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }))

    expect(onSearch).toHaveBeenCalledWith("测试笔记")
    expect(view.input.value).toBe("测试笔记")
    expect(document.activeElement).not.toBe(view.input)
  })

  it("中文输入法选词回车不会提前触发搜索", () => {
    const onSearch = vi.fn()
    const view = mount(onSearch)
    type(view.input, "中文")

    dispatch(view.input, new Event("compositionstart", { bubbles: true }))
    dispatch(view.input, new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    expect(onSearch).not.toHaveBeenCalled()

    dispatch(view.input, new Event("compositionend", { bubbles: true }))
    dispatch(view.input, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }))
    expect(onSearch).toHaveBeenCalledWith("中文")
  })

  it("一键清空会清除文本、恢复完整数据并关闭键盘", () => {
    const onSearch = vi.fn()
    const onClear = vi.fn()
    const view = mount(onSearch, onClear)
    view.input.focus()
    type(view.input, "待清空")

    act(() => { view.clear()!.click() })

    expect(view.input.value).toBe("")
    expect(onClear).toHaveBeenCalledOnce()
    expect(onSearch).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(view.input)
  })
})
