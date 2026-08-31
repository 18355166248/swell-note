export type EdgeSwipeGesture = {
  elapsedMs: number
  endX: number
  endY: number
  startX: number
  startY: number
  velocityX?: number
}

export function getEdgeSwipeProgress(deltaX: number, completionDistance = 96) {
  if (!Number.isFinite(deltaX) || completionDistance <= 0) return 0
  return Math.min(1, Math.max(0, deltaX / completionDistance))
}

export function shouldCompleteEdgeSwipe({
  elapsedMs,
  endX,
  endY,
  startX,
  startY,
  velocityX = 0,
}: EdgeSwipeGesture) {
  const deltaX = endX - startX
  const deltaY = Math.abs(endY - startY)
  if (startX > 32 || deltaX < 0 || deltaX < deltaY * 1.35) return false
  // 原生返回允许短距离快速甩动完成，慢拖仍使用距离阈值，兼顾灵敏度和防误触。
  if (deltaX >= 24 && velocityX >= 0.42) return true
  // 慢速拖动只要距离足够也应完成；否则用户跟手拖远后仍回弹，会显得手势失效。
  return deltaX >= 48 && (elapsedMs <= 1000 || deltaX >= 120)
}
