import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react"

import { getEdgeSwipeProgress, shouldCompleteEdgeSwipe } from "@/services/navigation/edge-swipe"

// 边缘手势的起手区宽度，指针与触摸两条路径共用。
const EDGE_ZONE_WIDTH = 32
// 交接路由的兜底时长：略长于当前层滑出的 CSS 过渡（190ms），
// transitionend 收不到时（被打断、reduce-motion 等）用它收尾。
const EDGE_SWIPE_HANDOFF_FALLBACK_MS = 230

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

function isEditorSurface(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  // 起手未必正落在编辑器上：落在容器留白里同样会被夺焦——浏览器会把光标塞进这一片中
  // 最近的 contenteditable，所以容器自身也要算进来。
  const surface = target.closest(".cm-editor, .document-canvas")
  return Boolean(surface && (surface.matches(".cm-editor") || surface.querySelector(".cm-editor")))
}

// 跟手的关键是拖动期间不碰 React：位移/进度直接写工作区 DOM 上的 CSS 变量，
// transform 由合成器消化，一帧都不重渲染；此前每次 touchmove 都 setState，
// 整个工作区（编辑器 + 垫底的上一页列表）按触摸频率重渲染，主线程被占满，
// translate3d 更新到达不匀，肉眼就是抖动。相位仍走 state：它驱动 transition
// 与上一页显隐，且每次手势最多变三次。
export function useEdgeSwipeAction(onComplete: () => void, enabled: boolean, kind: EdgeSwipeKind = "back") {
  const pointerGestureRef = useRef<Gesture | null>(null)
  const touchGestureRef = useRef<Gesture | null>(null)
  const suppressClickRef = useRef(false)
  const timersRef = useRef<number[]>([])
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  // 滑出动画结束前不交接路由；等待期间把「立即收尾 / 取消」两个入口存这里，
  // 供下一次手势或组件卸载时处理，避免路由交接被丢掉或在卸载后才触发。
  const pendingHandoffRef = useRef<{ cancel: () => void; run: () => void } | null>(null)
  const [phase, setPhase] = useState<EdgeSwipePhase>("idle")

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    pendingHandoffRef.current?.cancel()
  }, [])

  useEffect(() => {
    const element = workspaceRef.current
    if (!element || !enabled) return
    // React 把 touchstart 统一挂成 passive 监听，onTouchStart 里调用 preventDefault 是无效的。
    // 真机走的正是触摸这条路径，所以单独补一个非 passive 的原生监听来拦截编辑器抢焦点。
    const blockEditorFocus = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || event.touches.length !== 1 || touch.clientX > EDGE_ZONE_WIDTH) return
      if (!isEditorSurface(event.target)) return
      event.preventDefault()
    }
    element.addEventListener("touchstart", blockEditorFocus, { passive: false })
    return () => element.removeEventListener("touchstart", blockEditorFocus)
  }, [enabled])

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
      // 横向拖动一旦成立，这一轮补发的 click 必须吞掉。React 把 touchmove 挂成 passive 监听，
      // onTouchMove 里的 preventDefault 拦不住它，松手时手指下方的笔记会被当成点击直接打开，
      // 紧接着手势再把页面切到上一级，看起来就是侧滑中间闪一下别的页面。
      suppressClickRef.current = true
      // 带着键盘侧滑时，焦点要等编辑器卸载才消失，键盘于是在列表已经落位之后才收起，
      // 布局又跳一次。手势一确立就主动失焦，让键盘收起与页面滑出并成同一个动作。
      const focused = document.activeElement
      if (focused instanceof HTMLElement && isEditorSurface(focused)) focused.blur()
    }
    const progress = getEdgeSwipeProgress(deltaX)
    // 根目录手势只负责识别“打开导航”，拖动期间不移动正文；只有返回上页才做跟手转场。
    applyVisual(kind === "drawer" ? 0 : deltaX, progress)
    setPhase("dragging")
    return "horizontal" as const
  }
  const finish = (gesture: Gesture | null) => {
    if (!gesture) return
    // 上一次返回若还在等滑出动画收尾，先把它的路由交接补上，再处理这一次。
    pendingHandoffRef.current?.run()
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
    // 底层此刻已是真实上一页。交接路由会把正在滑出的当前层整棵子树卸载，
    // 真机上 var() 驱动的 transform 过渡跑在主线程、还要和列表回收抢占，
    // 若在滑出结束前就卸载，旧页往往还盖着小半屏，被硬删后下一页瞬间顶上——
    // 就是返回时的那下闪。等这一层真的滑出屏幕（transitionend）再交接。
    const outgoing = workspaceRef.current?.querySelector<HTMLElement>(":scope > .mobile-edge-swipe-current") ?? null
    let done = false
    const handoff = () => {
      if (done) return
      done = true
      pendingHandoffRef.current = null
      outgoing?.removeEventListener("transitionend", onTransitionEnd)
      // 手势已经把页面送到位，交接后不再补一段反向入场动画，避免二次位移。
      onComplete()
      reset()
    }
    function onTransitionEnd(event: TransitionEvent) {
      if (event.target === outgoing && event.propertyName === "transform") handoff()
    }
    outgoing?.addEventListener("transitionend", onTransitionEnd)
    // transitionend 收不到时的兜底；下次手势 run()、卸载 cancel()。
    schedule(handoff, EDGE_SWIPE_HANDOFF_FALLBACK_MS)
    pendingHandoffRef.current = {
      cancel: () => {
        done = true
        outgoing?.removeEventListener("transitionend", onTransitionEnd)
      },
      run: handoff,
    }
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
    // 每次新的按下都先解除抑制，否则上一轮残留的标记会把这次正常点击一起吞掉。
    suppressClickRef.current = false
    if (!enabled || !event.isPrimary || event.clientX > EDGE_ZONE_WIDTH) return
    // 起手落在编辑器上就别让它拿到焦点：contenteditable 一聚焦，iOS 立刻顶起输入辅助栏，
    // 布局跟着收缩，手势走完焦点又消失、布局回落，看起来就是侧滑中途闪一下。
    if (isEditorSurface(event.target)) event.preventDefault()
    // 上一次返回若还在等滑出动画收尾，这里先把路由交接补上，别让它悬着。
    pendingHandoffRef.current?.run()
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
    suppressClickRef.current = false
    const touch = event.touches[0]
    if (!enabled || event.touches.length !== 1 || !touch || touch.clientX > EDGE_ZONE_WIDTH) return
    // 上一次返回若还在等滑出动画收尾，这里先把路由交接补上，别让它悬着。
    pendingHandoffRef.current?.run()
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
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    active: phase !== "idle",
    bind: {
      ref: workspaceRef,
      "data-edge-swipe-kind": kind,
      "data-edge-swipe-state": phase,
      onClickCapture,
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
