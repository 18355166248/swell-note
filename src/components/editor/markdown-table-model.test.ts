import { describe, expect, it } from "vitest"

import {
  alignTableColumn,
  appendTableColumn,
  appendTableRow,
  deleteTableColumn,
  deleteTableRow,
  parseMarkdownTable,
  serializeMarkdownTable,
} from "./markdown-table-model"

describe("markdown table model", () => {
  const source = ["| 名称 | 状态 |", "| --- | :---: |", "| 表格 | 正常 |"].join("\n")

  it("parses and serializes GFM tables without DOM dependencies", () => {
    const table = parseMarkdownTable(source)!
    expect(table.aligns).toEqual(["left", "center"])
    expect(serializeMarkdownTable(table)).toBe(source)
  })

  it("exposes immutable reusable row and column operations", () => {
    const table = parseMarkdownTable(source)!
    const withRow = appendTableRow(table)
    const withColumn = appendTableColumn(withRow)
    const aligned = alignTableColumn(withColumn, 2, "right")!
    const withoutRow = deleteTableRow(aligned, 1)!
    const withoutColumn = deleteTableColumn(withoutRow, 2)!

    expect(table.header).toEqual(["名称", "状态"])
    expect(withColumn.header).toEqual(["名称", "状态", "新列"])
    expect(aligned.aligns[2]).toBe("right")
    expect(withoutColumn).toEqual(table)
  })

  it("protects the last remaining column", () => {
    const table = parseMarkdownTable(["| 唯一列 |", "| --- |"].join("\n"))!
    expect(deleteTableColumn(table, 0)).toBeNull()
  })

  it("serializes physical cell line breaks without breaking the table structure", () => {
    const table = parseMarkdownTable(source)!
    table.rows[0][0] = "第一行\n第二行"

    expect(serializeMarkdownTable(table)).toContain("| 第一行<br>第二行 | 正常 |")
  })
})
