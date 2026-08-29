import { useRef, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react"

import { shouldCompleteEdgeSwipe } from "@/services/navigation/edge-swipe"

export function useEdgeSwipeAction(onComplete: () => void, enabled: boolean) {
  type Gesture = {
    pointerId: number
    startedAt: number
    startX: number
    startY: number
  }
  const pointerGestureRef = useRef<Gesture | null>(null)
  const touchGestureRef = useRef<Omit<Gesture, "pointerId"> | null>(null)

  const isVerticalIntent = (startX: number, startY: number, currentX: number, currentY: number) => {
    const deltaX = Math.max(0, currentX - startX)
    const deltaY = Math.abs(currentY - startY)
    return deltaY >= 12 && deltaY > deltaX * 1.1
  }
  const completeIfReady = (gesture: Omit<Gesture, "pointerId">, endX: number, endY: number) => {
    if (!shouldCompleteEdgeSwipe({
      elapsedMs: Date.now() - gesture.startedAt,
      endX,
      endY,
      startX: gesture.startX,
      startY: gesture.startY,
    })) return false
    onComplete()
    return true
  }
  const clearPointerGesture = () => { pointerGestureRef.current = null }
  const clearTouchGesture = () => { touchGestureRef.current = null }
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !event.isPrimary || event.clientX > 32) return
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      startedAt: Date.now(),
      startX: event.clientX,
      startY: event.clientY,
    }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (touchGestureRef.current) return
    const gesture = pointerGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (event.clientX < gesture.startX - 8 || isVerticalIntent(gesture.startX, gesture.startY, event.clientX, event.clientY)) {
      clearPointerGesture()
      return
    }
    // 横向达到阈值立即完成，不等待抬手，避免 iOS 在滚动接管后发送 pointercancel。
    if (completeIfReady(gesture, event.clientX, event.clientY)) clearPointerGesture()
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (touchGestureRef.current) return
    const gesture = pointerGestureRef.current
    clearPointerGesture()
    if (!gesture || gesture.pointerId !== event.pointerId) return
    completeIfReady(gesture, event.clientX, event.clientY)
  }
  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!enabled || event.touches.length !== 1 || !touch || touch.clientX > 32) return
    // 真机滚动时 touchmove 比 pointerup 更稳定；触摸开始后由 touch 分支独占本次手势。
    clearPointerGesture()
    touchGestureRef.current = { startedAt: Date.now(), startX: touch.clientX, startY: touch.clientY }
  }
  const onTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current
    const touch = event.touches[0]
    if (!gesture || !touch) return
    if (touch.clientX < gesture.startX - 8 || isVerticalIntent(gesture.startX, gesture.startY, touch.clientX, touch.clientY)) {
      clearTouchGesture()
      return
    }
    if (completeIfReady(gesture, touch.clientX, touch.clientY)) clearTouchGesture()
  }
  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current
    const touch = event.changedTouches[0]
    clearTouchGesture()
    if (gesture && touch) completeIfReady(gesture, touch.clientX, touch.clientY)
  }

  return {
    onPointerCancel: clearPointerGesture,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onTouchCancel: clearTouchGesture,
    onTouchEnd,
    onTouchMove,
    onTouchStart,
  }
}
