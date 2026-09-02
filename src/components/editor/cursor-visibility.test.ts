import { describe, expect, it } from "vitest"

import { computeScrollAdjustment } from "./cursor-visibility"

// 可视带取编辑器滚动容器与底部工具栏之间的那段，键盘弹起后 bottom 会大幅上移。
const band = { bottom: 460, top: 60 }

describe("computeScrollAdjustment", () => {
  it("光标已在安全区内时不滚动", () => {
    expect(computeScrollAdjustment({ bottom: 300, top: 280 }, band)).toBe(0)
  })

  it("键盘压上来把光标盖住时，向下滚到露出光标并留出边距", () => {
    // 光标底 648，可视下界 460，留 24 边距：需要滚 648 - 436 = 212
    expect(computeScrollAdjustment({ bottom: 648, top: 620 }, band)).toBe(212)
  })

  it("光标贴着下边距时也会补上这一点距离", () => {
    expect(computeScrollAdjustment({ bottom: 450, top: 430 }, band)).toBe(14)
  })

  it("光标被顶到可视区上方时向上滚，返回负增量", () => {
    expect(computeScrollAdjustment({ bottom: 40, top: 20 }, band)).toBe(-64)
  })

  it("边距可调，跟随更贴近边缘", () => {
    expect(computeScrollAdjustment({ bottom: 450, top: 430 }, band, 0)).toBe(0)
  })

  it("可视带比两倍边距还窄时放弃跟随，避免在上下界之间来回弹", () => {
    expect(computeScrollAdjustment({ bottom: 500, top: 480 }, { bottom: 100, top: 70 })).toBe(0)
  })
})
