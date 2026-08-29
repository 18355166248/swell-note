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
  const deltaX = endX - startX
  const deltaY = Math.abs(endY - startY)
  if (startX > 32 || elapsedMs > 1000 || deltaX < 48) return false
  return deltaX >= deltaY * 1.35
}
