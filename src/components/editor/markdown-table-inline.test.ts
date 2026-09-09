import { describe, expect, it } from "vitest"

import { rawOffsetForDisplayOffset, truncateLinkLabel } from "./markdown-table-inline"

describe("truncateLinkLabel（表格内长链接显示文本截短）", () => {
  it("短文本原样返回", () => {
    expect(truncateLinkLabel("示例")).toBe("示例")
    expect(truncateLinkLabel("https://example.com")).toBe("example.com")
  })

  it("剥掉协议头后仍超长时中段省略", () => {
    const url = "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/wx-%E8%AE%BE%E8%AE%A1%E7%A8%BF?node-id=1234-5678&t=abcdef"
    const display = truncateLinkLabel(url)
    expect(display.length).toBe(40)
    expect(display).toContain("…")
    expect(display.startsWith("www.figma.com/design/")).toBe(true)
  })

  it("剥协议头后已不超长则直接返回", () => {
    expect(truncateLinkLabel("https://example.com/some/path?a=1&b=2")).toBe("example.com/some/path?a=1&b=2")
  })

  it("非 URL 的长标签同样中段省略", () => {
    const label = "这是一段被用户刻意写得很长很长的链接标签文字，已经超过四十个字符的显示限制长度了，还需要继续截短"
    const display = truncateLinkLabel(label)
    expect(display.length).toBe(40)
    expect(display).toContain("…")
  })
})

describe("rawOffsetForDisplayOffset（展示层偏移 → 原文偏移）", () => {
  it("没有行内标记时逐字符对应", () => {
    expect(rawOffsetForDisplayOffset("普通文字", 0)).toBe(0)
    expect(rawOffsetForDisplayOffset("普通文字", 2)).toBe(2)
    expect(rawOffsetForDisplayOffset("普通文字", 9)).toBe(4)
  })

  it("加粗标记被展示层吃掉，偏移落回标记内侧", () => {
    // 原文 "**加粗**文字"，展示 "加粗文字"；边界偏移收敛到标记内侧（等价视觉位置）。
    expect(rawOffsetForDisplayOffset("**加粗**文字", 0)).toBe(2)
    expect(rawOffsetForDisplayOffset("**加粗**文字", 1)).toBe(3)
    expect(rawOffsetForDisplayOffset("**加粗**文字", 2)).toBe(4)
    expect(rawOffsetForDisplayOffset("**加粗**文字", 3)).toBe(7)
    expect(rawOffsetForDisplayOffset("**加粗**文字", 4)).toBe(8)
  })

  it("链接只显示标签文字", () => {
    // 原文 "[标签](https://a.com)"，展示 "标签"
    expect(rawOffsetForDisplayOffset("[标签](https://a.com)", 1)).toBe(2)
    expect(rawOffsetForDisplayOffset("[标签](https://a.com)", 2)).toBe(3)
  })

  it("删除线与行内代码的标记同样跳过", () => {
    // "~~删~~除" 展示 "删除"；边界偏移落在闭合标记内侧（视觉等价位置）。
    expect(rawOffsetForDisplayOffset("~~删~~除", 1)).toBe(3)
    // "`代码` 后" 展示 "代码 后"
    expect(rawOffsetForDisplayOffset("`代码` 后", 2)).toBe(3)
    expect(rawOffsetForDisplayOffset("`代码` 后", 4)).toBe(6)
  })

  it("空单元格与越界偏移安全收敛", () => {
    expect(rawOffsetForDisplayOffset("", 0)).toBe(0)
    expect(rawOffsetForDisplayOffset("", 5)).toBe(0)
    expect(rawOffsetForDisplayOffset("**加粗**", 99)).toBe(6)
  })

  it("剥掉协议头的裸链接按原文偏移还原", () => {
    // 展示 "example.com"（11 位），点末尾应落到原文 "https://example.com" 的第 19 位。
    expect(rawOffsetForDisplayOffset("https://example.com", 0)).toBe(8)
    expect(rawOffsetForDisplayOffset("https://example.com", 11)).toBe(19)
    // 前面还有普通文本时，段内偏移同样要补上协议头。
    expect(rawOffsetForDisplayOffset("见 https://example.com 收尾", 13)).toBe(21)
  })

  it("中段省略的长链接：头部 1:1、省略号落到尾部起点、尾部对应原文末尾", () => {
    const url = "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/wx-%E8%AE%BE%E8%AE%A1%E7%A8%BF?node-id=1234-5678&t=abcdef"
    const display = truncateLinkLabel(url)
    expect(display.length).toBe(40)
    // 头部 29 位与原文逐位对应（含剥掉的 8 位协议头）。
    expect(rawOffsetForDisplayOffset(url, 0)).toBe(8)
    expect(rawOffsetForDisplayOffset(url, 29)).toBe(37)
    // 省略号右侧是尾部在显示层的起点（第 30 位），应映射到尾部在原文中的起点。
    expect(rawOffsetForDisplayOffset(url, 30)).toBe(url.length - 10)
    // 点显示末尾（第 40 位）应落到原文末尾，而不是第 40 位。
    expect(rawOffsetForDisplayOffset(url, 40)).toBe(url.length)
  })

  it("带标签的长链接同样在标签段内还原", () => {
    // 原文 "[https://example.com](https://a.com)"，展示 "example.com"，起始要越过 "[" 一位。
    expect(rawOffsetForDisplayOffset("[https://example.com](https://a.com)", 11)).toBe(20)
  })
})
