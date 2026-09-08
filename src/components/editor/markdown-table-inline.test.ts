import { describe, expect, it } from "vitest"

import { rawOffsetForDisplayOffset } from "./markdown-table-inline"

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
})
