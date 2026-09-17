// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useKeyboardInset } from "./use-keyboard-inset"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  useKeyboardInset()
  return null
}

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport")

afterEach(() => {
  if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport)
  else Reflect.deleteProperty(window, "visualViewport")
  document.documentElement.style.removeProperty("--keyboard-inset")
  vi.restoreAllMocks()
})

describe("useKeyboardInset", () => {
  it("笔记挂载导致可视视口偏移时，即使键盘未弹出也复位根滚动", () => {
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight,
      offsetTop: 56,
      scale: 1,
    })
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport })
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)
    const container = document.createElement("div")
    const root = createRoot(container)

    act(() => { root.render(<Harness />) })

    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("0px")
    act(() => { root.unmount() })
  })
})
