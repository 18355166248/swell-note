import { describe, expect, it } from "vitest"

import { getKeyboardInset, shouldResetWindowScroll } from "@/services/navigation/keyboard-inset"

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

describe("shouldResetWindowScroll", () => {
  it("文档未被顶起时不需要复位", () => {
    expect(shouldResetWindowScroll({ scrollY: 0 })).toBe(false)
    expect(shouldResetWindowScroll({ scrollY: 0, visualOffsetTop: 0 })).toBe(false)
  })

  it("文档或可视视口被顶起时需要复位", () => {
    expect(shouldResetWindowScroll({ scrollY: 120 })).toBe(true)
    expect(shouldResetWindowScroll({ scrollY: 0, visualOffsetTop: 84 })).toBe(true)
  })

  it("容忍非法输入", () => {
    expect(shouldResetWindowScroll({ scrollY: Number.NaN })).toBe(false)
  })
})

describe("shouldResetWindowScroll 缩放守卫", () => {
  it("捏合缩放（scale > 1）下的平移不复位", () => {
    expect(shouldResetWindowScroll({ scrollY: 120, visualScale: 2 })).toBe(false)
    expect(shouldResetWindowScroll({ scrollY: 0, visualOffsetTop: 84, visualScale: 1.5 })).toBe(false)
  })

  it("未缩放（scale = 1）时的键盘顶起仍复位", () => {
    expect(shouldResetWindowScroll({ scrollY: 120, visualScale: 1 })).toBe(true)
  })
})

describe("getKeyboardInset 缩放守卫", () => {
  it("捏合缩放造成的视口收缩不算键盘", () => {
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 437, visualScale: 2 })).toBe(0)
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 700, visualOffsetTop: 40, visualScale: 1.5 })).toBe(0)
  })

  it("未缩放时键盘高度照常计算", () => {
    expect(getKeyboardInset({ layoutHeight: 874, visualHeight: 471, visualScale: 1 })).toBe(403)
  })
})
