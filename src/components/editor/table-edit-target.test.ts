import { describe, expect, it } from "vitest"

import { detectCellInlineMarks, inlineTableFormat } from "./table-edit-target"

// inlineTableFormat 返回的是一次 setRangeText 的替换参数，这里把它应用到原文上方便断言。
function apply(value: string, template: string, from: number, to: number) {
  const change = inlineTableFormat(template, value, from, to)
  if (!change) return value
  return value.slice(0, change.from) + change.text + value.slice(change.to)
}

describe("detectCellInlineMarks", () => {
  it("选区紧贴标记内侧时视为已加粗", () => {
    expect(detectCellInlineMarks("**加粗**文字", 2, 4)).toEqual({ code: false, emphasis: false, strike: false, strong: true })
  })

  it("选区连同标记一起框选时同样视为已加粗", () => {
    expect(detectCellInlineMarks("**加粗**", 0, 6)).toEqual({ code: false, emphasis: false, strike: false, strong: true })
  })

  it("加粗不会被误报成斜体", () => {
    const state = detectCellInlineMarks("**加粗**", 2, 4)
    expect(state.strong).toBe(true)
    expect(state.emphasis).toBe(false)
  })

  it("斜体、删除线、行内代码分别识别", () => {
    expect(detectCellInlineMarks("*斜体*", 1, 3).emphasis).toBe(true)
    expect(detectCellInlineMarks("~~删除~~", 2, 4).strike).toBe(true)
    expect(detectCellInlineMarks("`代码`", 1, 3).code).toBe(true)
  })

  it("普通文字与空选区不激活任何格式", () => {
    const empty = { code: false, emphasis: false, strike: false, strong: false }
    expect(detectCellInlineMarks("普通文字", 0, 4)).toEqual(empty)
    expect(detectCellInlineMarks("普通文字", 2, 2)).toEqual(empty)
    expect(detectCellInlineMarks("", 0, 0)).toEqual(empty)
  })

  it("粗斜体叠加时两种格式都激活", () => {
    const state = detectCellInlineMarks("***加粗文字***", 3, 7)
    expect(state.strong).toBe(true)
    expect(state.emphasis).toBe(true)
  })
})

// E05：单元格与正文共用同一套行内格式语义（Markdown 语法树），同一输入、选区和操作
// 在两处结果一致——加粗的两个星号不会再被误判成斜体标记而触发「取消」。
describe("inlineTableFormat 与正文语义一致（E05）", () => {
  it("加粗文字上叠加斜体，保留加粗", () => {
    expect(apply("**加粗文字**", "*斜体文字*", 2, 6)).toBe("***加粗文字***")
  })

  it("粗斜体上取消斜体，保留加粗", () => {
    expect(apply("***加粗文字***", "*斜体文字*", 3, 7)).toBe("**加粗文字**")
  })

  it("粗斜体上取消加粗，保留斜体", () => {
    expect(apply("***加粗文字***", "**加粗文字**", 3, 7)).toBe("*加粗文字*")
  })

  it("局部取消加粗只影响选中部分", () => {
    expect(apply("**甲乙丙丁**", "**加粗文字**", 3, 5)).toBe("**甲**乙丙**丁**")
  })

  it("空格边界的局部取消与正文一致（复核 R5）", () => {
    expect(apply("**甲 乙 丙**", "**加粗文字**", 4, 5)).toBe("**甲** 乙 **丙**")
  })

  it("链接内局部取消与正文一致：链接外文字不受影响（复核 R4）", () => {
    expect(apply("**甲[乙丙](https://example.com)丁**", "**加粗文字**", 5, 6)).toBe("**甲**[**乙**丙](https://example.com)**丁**")
  })

  it("符号边界的局部取消与正文一致（复核 R6）", () => {
    expect(apply("**甲$乙$丙**", "**加粗文字**", 4, 5)).toBe("**甲**$乙$**丙**")
  })

  it("普通选区加粗、斜体、删除线", () => {
    expect(apply("甲乙", "**加粗文字**", 0, 2)).toBe("**甲乙**")
    expect(apply("甲乙", "*斜体文字*", 0, 2)).toBe("*甲乙*")
    expect(apply("甲乙", "~~删除线文字~~", 0, 2)).toBe("~~甲乙~~")
  })

  it("取消双反引号行内代码时移除完整分隔符", () => {
    expect(apply("``a`b``", "`行内代码`", 2, 5)).toBe("a`b")
  })

  it("正文含反引号时新增代码自动加长围栏", () => {
    expect(apply("a`b", "`行内代码`", 0, 3)).toBe("``a`b``")
  })

  it("空光标插入占位文字", () => {
    expect(apply("甲乙", "**加粗文字**", 1, 1)).toBe("甲**加粗文字**乙")
  })
})
