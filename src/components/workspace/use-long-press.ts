import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react"

export function useLongPress(onLongPress?: () => void, delay = 500) {
  const timerRef = useRef<number | null>(null)
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    originRef.current = null
  }

  useEffect(() => clearTimer, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!onLongPress || (event.pointerType === "mouse" && event.button !== 0)) return
    suppressClickRef.current = false
    originRef.current = { x: event.clientX, y: event.clientY }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      suppressClickRef.current = true
      onLongPress()
    }, delay)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = originRef.current
    if (!origin) return
    // 手指滚动列表时立即取消长按，避免滑动过程中误弹操作菜单。
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) clearTimer()
  }

  const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  const onContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!onLongPress) return
    event.preventDefault()
    clearTimer()
    suppressClickRef.current = true
    onLongPress()
  }

  return {
    onClickCapture,
    onContextMenu,
    onPointerCancel: clearTimer,
    onPointerDown,
    onPointerLeave: clearTimer,
    onPointerMove,
    onPointerUp: clearTimer,
  }
}
