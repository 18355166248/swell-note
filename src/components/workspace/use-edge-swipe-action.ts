import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react"

import { getEdgeSwipeProgress, shouldCompleteEdgeSwipe } from "@/services/navigation/edge-swipe"

type EdgeSwipeKind = "back" | "drawer"
type Gesture = {
  horizontal: boolean
  pointerId?: number
  startedAt: number
  startX: number
  startY: number
  sampledAt: number
  velocityX: number
  x: number
  y: number
}
type VisualState = {
  offset: number
  phase: "completing" | "dragging" | "idle" | "returning"
  progress: number
}

const IDLE_VISUAL: VisualState = { offset: 0, phase: "idle", progress: 0 }

export function useEdgeSwipeAction(onComplete: () => void, enabled: boolean, kind: EdgeSwipeKind = "back") {
  const pointerGestureRef = useRef<Gesture | null>(null)
  const touchGestureRef = useRef<Gesture | null>(null)
  const timersRef = useRef<number[]>([])
  const [visual, setVisual] = useState<VisualState>(IDLE_VISUAL)

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const schedule = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay)
    timersRef.current.push(timer)
  }
  const clearScheduled = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current = []
  }
  const clearPointerGesture = () => { pointerGestureRef.current = null }
  const clearTouchGesture = () => { touchGestureRef.current = null }
  const reset = () => setVisual(IDLE_VISUAL)
  const returnToStart = () => {
    setVisual((current) => current.phase === "idle" ? current : { ...current, offset: 0, phase: "returning", progress: 0 })
    schedule(reset, 190)
  }
  const updateDrag = (gesture: Gesture, currentX: number, currentY: number) => {
    const now = performance.now()
    const deltaX = Math.max(0, currentX - gesture.startX)
    const deltaY = Math.abs(currentY - gesture.startY)
    const sampleDeltaX = currentX - gesture.x
    const sampleElapsed = now - gesture.sampledAt
    if (sampleElapsed > 0 && Math.abs(sampleDeltaX) > 0.5) gesture.velocityX = sampleDeltaX / sampleElapsed
    gesture.sampledAt = now
    gesture.x = currentX
    gesture.y = currentY
    if (!gesture.horizontal) {
      if (deltaY >= 10 && deltaY > deltaX * 1.1) return "vertical" as const
      if (deltaX < 8 || deltaX < deltaY * 1.1) return "pending" as const
      gesture.horizontal = true
    }
    const progress = getEdgeSwipeProgress(deltaX)
    // 根目录手势只负责识别“打开导航”，拖动期间不移动正文；只有返回上页才做跟手转场。
    const offset = kind === "drawer" ? 0 : deltaX
    setVisual({ offset, phase: "dragging", progress })
    return "horizontal" as const
  }
  const finish = (gesture: Gesture | null) => {
    if (!gesture) return
    const complete = gesture.horizontal && shouldCompleteEdgeSwipe({
      elapsedMs: Date.now() - gesture.startedAt,
      endX: gesture.x,
      endY: gesture.y,
      startX: gesture.startX,
      startY: gesture.startY,
      velocityX: gesture.velocityX,
    })
    if (!complete) {
      returnToStart()
      return
    }
    if (kind === "drawer") {
      onComplete()
      reset()
      return
    }
    setVisual({ offset: window.innerWidth, phase: "completing", progress: 1 })
    schedule(() => {
      // 滑出期间底层已经是真实上一页，完成后直接交接路由，避免再做一次反向入场造成闪动。
      onComplete()
      reset()
    }, 170)
  }
  const startGesture = (startX: number, startY: number, pointerId?: number): Gesture => ({
    horizontal: false,
    pointerId,
    sampledAt: performance.now(),
    startedAt: Date.now(),
    startX,
    startY,
    velocityX: 0,
    x: startX,
    y: startY,
  })

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !event.isPrimary || event.clientX > 32) return
    clearScheduled()
    pointerGestureRef.current = startGesture(event.clientX, event.clientY, event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (touchGestureRef.current) return
    const gesture = pointerGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const intent = updateDrag(gesture, event.clientX, event.clientY)
    if (intent === "vertical" || event.clientX < gesture.startX - 8) {
      clearPointerGesture()
      returnToStart()
    }
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (touchGestureRef.current) return
    const gesture = pointerGestureRef.current
    clearPointerGesture()
    if (!gesture || gesture.pointerId !== event.pointerId) return
    updateDrag(gesture, event.clientX, event.clientY)
    finish(gesture)
  }
  const onPointerCancel = () => {
    clearPointerGesture()
    returnToStart()
  }
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!enabled || event.touches.length !== 1 || !touch || touch.clientX > 32) return
    clearScheduled()
    clearPointerGesture()
    touchGestureRef.current = startGesture(touch.clientX, touch.clientY)
  }
  const onTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current
    const touch = event.touches[0]
    if (!gesture || !touch) return
    const intent = updateDrag(gesture, touch.clientX, touch.clientY)
    if (intent === "horizontal" && event.cancelable) event.preventDefault()
    if (intent === "vertical" || touch.clientX < gesture.startX - 8) {
      clearTouchGesture()
      returnToStart()
    }
  }
  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current
    const touch = event.changedTouches[0]
    clearTouchGesture()
    if (!gesture || !touch) return
    updateDrag(gesture, touch.clientX, touch.clientY)
    finish(gesture)
  }
  const onTouchCancel = () => {
    clearTouchGesture()
    returnToStart()
  }

  return {
    active: visual.phase !== "idle",
    bind: {
      "data-edge-swipe-kind": kind,
      "data-edge-swipe-state": visual.phase,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onTouchCancel,
      onTouchEnd,
      onTouchMove,
      onTouchStart,
      style: {
        "--edge-swipe-offset": `${visual.offset}px`,
        "--edge-swipe-progress": visual.progress,
      } as CSSProperties,
    },
    kind,
    phase: visual.phase,
    progress: visual.progress,
  }
}
