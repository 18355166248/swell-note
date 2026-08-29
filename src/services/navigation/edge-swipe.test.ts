import { describe, expect, it } from "vitest"

import { shouldCompleteEdgeSwipe } from "@/services/navigation/edge-swipe"

describe("shouldCompleteEdgeSwipe", () => {
  it("接受从左缘开始的快速右滑", () => {
    expect(shouldCompleteEdgeSwipe({ elapsedMs: 420, endX: 64, endY: 126, startX: 12, startY: 112 })).toBe(true)
  })

  it("拒绝页面内部开始的横滑", () => {
    expect(shouldCompleteEdgeSwipe({ elapsedMs: 300, endX: 150, endY: 100, startX: 40, startY: 100 })).toBe(false)
  })

  it("拒绝纵向滚动和停留过久的手势", () => {
    expect(shouldCompleteEdgeSwipe({ elapsedMs: 300, endX: 100, endY: 180, startX: 8, startY: 100 })).toBe(false)
    expect(shouldCompleteEdgeSwipe({ elapsedMs: 1100, endX: 100, endY: 100, startX: 8, startY: 100 })).toBe(false)
  })

  it("斜向滑动只有横向意图明显时才触发", () => {
    expect(shouldCompleteEdgeSwipe({ elapsedMs: 280, endX: 64, endY: 142, startX: 8, startY: 100 })).toBe(false)
    expect(shouldCompleteEdgeSwipe({ elapsedMs: 280, endX: 70, endY: 126, startX: 8, startY: 100 })).toBe(true)
  })
})
