import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react"

import { getEdgeSwipeProgress, shouldCompleteEdgeSwipe } from "@/services/navigation/edge-swipe"

type EdgeSwipeKind = "back" | "drawer"
type EdgeSwipePhase = "completing" | "dragging" | "idle" | "returning"
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

// 跟手的关键是拖动期间不碰 React：位移/进度直接写工作区 DOM 上的 CSS 变量，
// transform 由合成器消化，一帧都不重渲染；此前每次 touchmove 都 setState，
// 整个工作区（编辑器 + 垫底的上一页列表）按触摸频率重渲染，主线程被占满，
// translate3d 更新到达不匀，肉眼就是抖动。相位仍走 state：它驱动 transition
// 与上一页显隐，且每次手势最多变三次。
export function useEdgeSwipeAction(onComplete: () => void, enabled: boolean, kind: EdgeSwipeKind = "back") {
  const pointerGestureRef = useRef<Gesture | null>(null)
  const touchGestureRef = useRef<Gesture | null>(null)
  const timersRef = useRef<number[]>([])
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<EdgeSwipePhase>("idle")

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const applyVisual = (offset: number, progress: number) => {
    const element = workspaceRef.current
    if (!element) return
    element.style.setProperty("--edge-swipe-offset", `${offset}px`)
    element.style.setProperty("--edge-swipe-progress", `${progress}`)
  }

  // 相位提交后、绘制前补齐目标变量：transition 随相位生效，变量在同一帧写入，
  // 动画才能从手指松开时的位置起播；idle 没有 transition，同一帧写入即瞬时复位。
  useLayoutEffect(() => {
    if (phase === "idle" || phase === "returning") applyVisual(0, 0)
    else if (phase === "completing") applyVisual(window.innerWidth, 1)
  }, [phase])

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
  const reset = () => setPhase("idle")
  const returnToStart = () => {
    setPhase((current) => current === "idle" ? current : "returning")
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
    applyVisual(kind === "drawer" ? 0 : deltaX, progress)
    setPhase("dragging")
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
    setPhase("completing")
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
    active: phase !== "idle",
    bind: {
      ref: workspaceRef,
      "data-edge-swipe-kind": kind,
      "data-edge-swipe-state": phase,
      onPointerCancel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onTouchCancel,
      onTouchEnd,
      onTouchMove,
      onTouchStart,
    },
    kind,
    phase,
  }
}
