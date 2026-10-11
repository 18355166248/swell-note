import { markdownLanguage } from "@codemirror/lang-markdown"
import { describe, expect, it } from "vitest"

import { buildTableTemplate, isTableInsertTemplate, TABLE_LIMITS } from "./table-template"

describe("新建表格模板", () => {
  it("按行列数生成全空单元格，行数包含表头", () => {
    expect(buildTableTemplate(3, 2)).toBe("\n|  |  |\n| --- | --- |\n|  |  |\n|  |  |\n\n")
    expect(buildTableTemplate(2, 1)).toBe("\n|  |\n| --- |\n|  |\n\n")
  })

  it("插入在正文之前仍保持尺寸和后续段落边界", () => {
    const names: string[] = []
    markdownLanguage.parser.parse(`${buildTableTemplate(3, 3)}正文\n\n结尾`).iterate({ enter: (node) => { names.push(node.name) } })
    expect(names.filter((name) => name === "TableRow")).toHaveLength(2)
    expect(names.filter((name) => name === "Paragraph")).toHaveLength(2)
  })

  it("越界尺寸收敛到上下限", () => {
    expect(buildTableTemplate(0, 0)).toBe(buildTableTemplate(TABLE_LIMITS.minRows, TABLE_LIMITS.minCols))
    expect(buildTableTemplate(999, 999)).toBe(buildTableTemplate(TABLE_LIMITS.maxRows, TABLE_LIMITS.maxCols))
  })

  it("全空单元格仍会被 GFM 解析成表格", () => {
    for (const [rows, cols] of [[2, 1], [3, 3], [20, 8]]) {
      const names: string[] = []
      markdownLanguage.parser.parse(buildTableTemplate(rows, cols).trim()).iterate({ enter: (node) => { names.push(node.name) } })
      expect(names).toContain("Table")
      expect(names.filter((name) => name === "TableRow")).toHaveLength(rows - 1)
    }
  })

  it("能认出自己生成的模板，不误伤其它块", () => {
    expect(isTableInsertTemplate(buildTableTemplate(4, 5))).toBe(true)
    expect(isTableInsertTemplate("\n---\n")).toBe(false)
    expect(isTableInsertTemplate("\n| a | b |\n| --- | --- |\n| 1 | 2 |\n")).toBe(false)
  })
})
