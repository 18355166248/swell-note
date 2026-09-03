// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { shouldKeepNativeContextMenu, useNativeContextMenuSuppression } from "@/components/desktop/native-context-menu"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement | null = null
let root: Root | null = null

function mount(enabled: boolean) {
  function Harness() {
    useNativeContextMenuSuppression(enabled)
    return <div><button type="button">笔记</button><input aria-label="标题" /></div>
  }

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<Harness />) })
  return container
}

function fireContextMenu(target: Element) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

function selectionStub(text: string): Selection {
  return {
    isCollapsed: text.length === 0,
    toString: () => text,
  } as Selection
}

describe("shouldKeepNativeContextMenu", () => {
  it("普通界面元素交给自定义菜单", () => {
    const row = document.createElement("button")
    expect(shouldKeepNativeContextMenu(row, selectionStub(""))).toBe(false)
  })

  it("输入框与其子节点保留系统菜单，粘贴和拼写检查才可用", () => {
    const input = document.createElement("input")
    expect(shouldKeepNativeContextMenu(input, selectionStub(""))).toBe(true)

    const editor = document.createElement("div")
    editor.setAttribute("contenteditable", "true")
    const line = document.createElement("span")
    editor.append(line)
    expect(shouldKeepNativeContextMenu(line, selectionStub(""))).toBe(true)
  })

  it("选中文字后右键保留系统菜单，方便直接复制", () => {
    const article = document.createElement("article")
    expect(shouldKeepNativeContextMenu(article, selectionStub("一段正文"))).toBe(true)
    // 只有空白的选区等同于没选中，仍然让位给自定义菜单。
    expect(shouldKeepNativeContextMenu(article, selectionStub("  "))).toBe(false)
  })

  it("事件目标不是元素时不拦截", () => {
    expect(shouldKeepNativeContextMenu(null, selectionStub(""))).toBe(false)
  })
})

describe("useNativeContextMenuSuppression", () => {
  it("桌面外壳里挡掉普通区域的系统菜单，输入框仍然放行", () => {
    const tree = mount(true)
    expect(fireContextMenu(tree.querySelector("button")!).defaultPrevented).toBe(true)
    expect(fireContextMenu(tree.querySelector("input")!).defaultPrevented).toBe(false)
  })

  it("非桌面外壳不接管右键", () => {
    const tree = mount(false)
    expect(fireContextMenu(tree.querySelector("button")!).defaultPrevented).toBe(false)
  })
})
