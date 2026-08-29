// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useLongPress } from "./use-long-press"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement | null = null
let root: Root | null = null

function pointerEvent(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, "pointerType", { value: "touch" })
  return event
}

function mount(onLongPress: () => void, onClick = vi.fn()) {
  function Harness() {
    const longPressProps = useLongPress(onLongPress, 500)
    return <button onClick={onClick} type="button" {...longPressProps}>笔记</button>
  }

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<Harness />) })
  return { button: container.querySelector("button")!, onClick }
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe("useLongPress", () => {
  it("长按触发操作后阻止紧随其后的误点击", () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const view = mount(onLongPress)

    act(() => {
      view.button.dispatchEvent(pointerEvent("pointerdown", 8, 20))
      vi.advanceTimersByTime(500)
    })
    act(() => { view.button.click() })

    expect(onLongPress).toHaveBeenCalledOnce()
    expect(view.onClick).not.toHaveBeenCalled()
  })

  it("手指开始滚动后取消长按，避免滚动时误弹菜单", () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    const view = mount(onLongPress)

    act(() => {
      view.button.dispatchEvent(pointerEvent("pointerdown", 8, 20))
      view.button.dispatchEvent(pointerEvent("pointermove", 9, 40))
      vi.advanceTimersByTime(600)
    })

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it("桌面端右键直接打开同一套操作菜单", () => {
    const onLongPress = vi.fn()
    const view = mount(onLongPress)
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })

    act(() => { view.button.dispatchEvent(event) })

    expect(event.defaultPrevented).toBe(true)
    expect(onLongPress).toHaveBeenCalledOnce()
  })
})
