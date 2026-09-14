// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useEdgeSwipeAction } from "./use-edge-swipe-action"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement | null = null
let root: Root | null = null

function pointerEvent(type: string, x: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 120 })
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
  })
  return event
}

function transitionEnd() {
  const event = new Event("transitionend", { bubbles: true })
  Object.defineProperty(event, "propertyName", { value: "transform" })
  return event
}

function touchEvent(type: string, touches: Array<{ identifier: number; x: number }>, changed = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const toTouch = ({ identifier, x }: { identifier: number; x: number }) => ({
    clientX: x,
    clientY: 120,
    identifier,
  })
  Object.defineProperties(event, {
    changedTouches: { value: changed.map(toTouch) },
    touches: { value: touches.map(toTouch) },
  })
  return event
}

function Harness({ navigationKey, onComplete }: {
  navigationKey: string
  onComplete: () => boolean | void | Promise<boolean | void>
}) {
  const edge = useEdgeSwipeAction(onComplete, true, "back", navigationKey)
  return <div {...edge.bind}><div className="mobile-edge-swipe-current" /></div>
}

function renderHarness(navigationKey: string, onComplete: () => boolean | void | Promise<boolean | void>) {
  if (!container) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() => { root!.render(<Harness navigationKey={navigationKey} onComplete={onComplete} />) })
  return container.firstElementChild as HTMLElement
}

function completePointerGesture(workspace: HTMLElement) {
  act(() => {
    workspace.dispatchEvent(pointerEvent("pointerdown", 6))
    workspace.dispatchEvent(pointerEvent("pointermove", 120))
    workspace.dispatchEvent(pointerEvent("pointerup", 120))
  })
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe("useEdgeSwipeAction navigation handoff", () => {
  it("keeps the completed transform until the route key commits", async () => {
    const onComplete = vi.fn()
    let workspace = renderHarness("route-a", onComplete)
    completePointerGesture(workspace)
    expect(workspace.dataset.edgeSwipeState).toBe("completing")

    await act(async () => {
      workspace.querySelector(".mobile-edge-swipe-current")!.dispatchEvent(transitionEnd())
      await Promise.resolve()
    })
    expect(onComplete).toHaveBeenCalledOnce()
    expect(workspace.dataset.edgeSwipeState).toBe("completing")

    workspace = renderHarness("route-b", onComplete)
    expect(workspace.dataset.edgeSwipeState).toBe("idle")
    expect(workspace.style.getPropertyValue("--edge-swipe-offset")).toBe("0px")
  })

  it("rejects a second gesture while completion is waiting for navigation", async () => {
    const onComplete = vi.fn()
    const workspace = renderHarness("route-a", onComplete)
    completePointerGesture(workspace)
    completePointerGesture(workspace)
    await act(async () => {
      workspace.querySelector(".mobile-edge-swipe-current")!.dispatchEvent(transitionEnd())
      await Promise.resolve()
    })
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it("returns to the current page when navigation reports failure", async () => {
    const workspace = renderHarness("route-a", () => false)
    completePointerGesture(workspace)
    await act(async () => {
      workspace.querySelector(".mobile-edge-swipe-current")!.dispatchEvent(transitionEnd())
      await Promise.resolve()
    })
    expect(workspace.dataset.edgeSwipeState).toBe("returning")
  })

  it("returns safely when navigation throws synchronously", async () => {
    const workspace = renderHarness("route-a", () => { throw new Error("navigation failed") })
    completePointerGesture(workspace)
    await act(async () => {
      workspace.querySelector(".mobile-edge-swipe-current")!.dispatchEvent(transitionEnd())
      await Promise.resolve()
    })
    expect(workspace.dataset.edgeSwipeState).toBe("returning")
  })

  it("cancels a pending handoff when an external navigation commits", () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    let workspace = renderHarness("route-a", onComplete)
    completePointerGesture(workspace)
    workspace = renderHarness("route-external", onComplete)
    act(() => { vi.advanceTimersByTime(500) })
    expect(workspace.dataset.edgeSwipeState).toBe("idle")
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("does not let an old rejected completion reset a new route gesture", async () => {
    let rejectOldNavigation: ((value: boolean) => void) | undefined
    const oldCompletion = new Promise<boolean>((resolve) => { rejectOldNavigation = resolve })
    let workspace = renderHarness("route-a", () => oldCompletion)
    completePointerGesture(workspace)
    act(() => { workspace.querySelector(".mobile-edge-swipe-current")!.dispatchEvent(transitionEnd()) })

    workspace = renderHarness("route-b", vi.fn())
    act(() => {
      workspace.dispatchEvent(pointerEvent("pointerdown", 6))
      workspace.dispatchEvent(pointerEvent("pointermove", 70))
    })
    expect(workspace.dataset.edgeSwipeState).toBe("dragging")
    await act(async () => {
      rejectOldNavigation?.(false)
      await Promise.resolve()
    })
    expect(workspace.dataset.edgeSwipeState).toBe("dragging")
  })

  it("ignores cancel events after the completion lock is set", async () => {
    const onComplete = vi.fn()
    const workspace = renderHarness("route-a", onComplete)
    completePointerGesture(workspace)
    act(() => {
      workspace.dispatchEvent(pointerEvent("pointercancel", 120))
      workspace.dispatchEvent(touchEvent("touchcancel", []))
    })
    expect(workspace.dataset.edgeSwipeState).toBe("completing")
    await act(async () => {
      workspace.querySelector(".mobile-edge-swipe-current")!.dispatchEvent(transitionEnd())
      await Promise.resolve()
    })
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it("ignores pointercancel while the matching touch gesture is active", async () => {
    const onComplete = vi.fn()
    const workspace = renderHarness("route-a", onComplete)
    act(() => {
      workspace.dispatchEvent(touchEvent("touchstart", [{ identifier: 7, x: 6 }]))
      workspace.dispatchEvent(pointerEvent("pointercancel", 6))
      workspace.dispatchEvent(touchEvent("touchmove", [{ identifier: 7, x: 120 }]))
      workspace.dispatchEvent(touchEvent("touchend", [], [{ identifier: 7, x: 120 }]))
    })
    await act(async () => {
      workspace.querySelector(".mobile-edge-swipe-current")!.dispatchEvent(transitionEnd())
      await Promise.resolve()
    })
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it("cancels the touch gesture when a second finger joins", () => {
    vi.useFakeTimers()
    const onComplete = vi.fn()
    const workspace = renderHarness("route-a", onComplete)
    act(() => {
      workspace.dispatchEvent(touchEvent("touchstart", [{ identifier: 7, x: 6 }]))
      workspace.dispatchEvent(touchEvent("touchmove", [{ identifier: 7, x: 70 }]))
      workspace.dispatchEvent(touchEvent("touchstart", [{ identifier: 7, x: 70 }, { identifier: 8, x: 18 }]))
      workspace.dispatchEvent(touchEvent("touchend", [], [{ identifier: 7, x: 150 }]))
      vi.advanceTimersByTime(500)
    })
    expect(workspace.dataset.edgeSwipeState).toBe("idle")
    expect(onComplete).not.toHaveBeenCalled()
  })
})
