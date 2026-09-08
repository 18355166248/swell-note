import { describe, expect, it } from "vitest"

import { detectCellInlineMarks } from "./table-edit-target"

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
})
