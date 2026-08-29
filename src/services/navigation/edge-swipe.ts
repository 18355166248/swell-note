export type EdgeSwipeGesture = {
  elapsedMs: number
  endX: number
  endY: number
  startX: number
  startY: number
}

export function shouldCompleteEdgeSwipe({
  elapsedMs,
  endX,
  endY,
  startX,
  startY,
}: EdgeSwipeGesture) {
  if (startX > 24 || elapsedMs > 800) return false
  return endX - startX >= 72 && Math.abs(endY - startY) <= 48
}
