import { describe, expect, it } from "vitest"

import { getKeyboardInset } from "@/services/navigation/keyboard-inset"

describe("getKeyboardInset", () => {
  it("没有键盘时返回 0", () => {
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 874 })).toBe(0)
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 873.5, visualOffsetTop: 0 })).toBe(0)
  })

  it("按 visualViewport 收缩量算出键盘遮挡高度", () => {
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 471 })).toBe(403)
    expect(getKeyboardInset({ layoutHeight: 812, visualHeight: 476.4 })).toBe(336)
  })

  it("视口被上推时扣掉偏移量，避免把滚动误判成键盘", () => {
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 471, visualOffsetTop: 120 })).toBe(283)
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 806, visualOffsetTop: 68 })).toBe(0)
  })

  it("忽略工具栏一行以内的抖动", () => {
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 830 })).toBe(0)
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 820 })).toBe(54)
  })

  it("保留最低可视高度并容忍非法输入", () => {
    expect(getKeyboardInset({ layoutHeight: 800, visualHeight: 20 })).toBe(720)
    expect(getKeyboardInset({ layoutHeight: 0, visualHeight: 0 })).toBe(0)
    expect(getKeyboardInset({ layoutHeight: Number.NaN, visualHeight: 400 })).toBe(0)
  })
})
