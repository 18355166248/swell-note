// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { useNativeContextMenuSuppression } from "@/components/desktop/native-context-menu"

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

describe("useNativeContextMenuSuppression", () => {
  it("统一屏蔽普通区域和输入框的系统菜单", () => {
    const tree = mount(true)
    expect(fireContextMenu(tree.querySelector("button")!).defaultPrevented).toBe(true)
    expect(fireContextMenu(tree.querySelector("input")!).defaultPrevented).toBe(true)
  })

  it("关闭拦截时不接管右键", () => {
    const tree = mount(false)
    expect(fireContextMenu(tree.querySelector("button")!).defaultPrevented).toBe(false)
  })
})
