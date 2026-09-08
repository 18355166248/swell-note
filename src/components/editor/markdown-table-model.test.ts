import { describe, expect, it } from "vitest"

import {
  alignTableColumn,
  appendTableColumn,
  appendTableRow,
  clampTableCellRange,
  clearTableCellRange,
  deleteTableColumn,
  deleteTableColumnRange,
  deleteTableRow,
  deleteTableRowRange,
  insertTableColumn,
  insertTableRow,
  normalizeTableCellRange,
  parseMarkdownTable,
  parseTabularText,
  pasteTableCells,
  serializeMarkdownTable,
  tableCellAt,
  tableCellRangeToTsv,
  toggleTableCellRangeMark,
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

describe("spreadsheet paste", () => {
  it("preserves quoted newlines and empty trailing cells", () => {
    expect(parseTabularText('"第一行\n第二行"\t2\t\r\nA\t"B""C"\tD\r\n')).toEqual([["第一行\n第二行", "2", ""], ["A", 'B"C', "D"]])
    expect(parseTabularText("普通文本")).toBeNull()
  })
  it("expands from the target cell without overwriting adjacent data or mutating input", () => {
    const original = parseMarkdownTable("| A | B |\n| --- | ---: |\n| keep | old |")!
    const pasted = pasteTableCells(original, 1, 1, [["1", "2"], ["3", "4"]])
    expect(pasted.header).toHaveLength(3)
    expect(pasted.rows).toEqual([["keep", "1", "2"], ["", "3", "4"]])
    expect(original.rows).toEqual([["keep", "old"]])
    expect(pasted.aligns).toEqual(["left", "right", "left"])
  })
})

describe("insertTableRow / insertTableColumn", () => {
  const table = parseMarkdownTable(["| A | B |", "| --- | :---: |", "| 1 | 2 |", "| 3 | 4 |"].join("\n"))!

  it("在任意数据行位置插入空行，内容与对齐保持不变", () => {
    const next = insertTableRow(table, 1)!
    expect(next.rows).toEqual([["1", "2"], ["", ""], ["3", "4"]])
    expect(next.aligns).toEqual(table.aligns)
    // 首尾边界与越界
    expect(insertTableRow(table, 0)!.rows[0]).toEqual(["", ""])
    expect(insertTableRow(table, 2)!.rows[2]).toEqual(["", ""])
    expect(insertTableRow(table, 3)).toBeNull()
    expect(insertTableRow(table, -1)).toBeNull()
    expect(table.rows).toEqual([["1", "2"], ["3", "4"]])
  })

  it("在任意列位置插入空列，新列沿用相邻对齐", () => {
    const left = insertTableColumn(table, 0)!
    expect(left.header).toEqual(["", "A", "B"])
    expect(left.aligns).toEqual(["left", "left", "center"])
    expect(left.rows[0]).toEqual(["", "1", "2"])
    const middle = insertTableColumn(table, 2)!
    expect(middle.aligns).toEqual(["left", "center", "center"])
    expect(insertTableColumn(table, 3)).toBeNull()
  })
})

describe("矩形选区操作", () => {
  const table = parseMarkdownTable(["| A | B | C |", "| --- | --- | --- |", "| 1 | 2 | 3 |", "| 4 | 5 | 6 |"].join("\n"))!
  const range = normalizeTableCellRange({ column: 2, row: 1 }, { column: 1, row: -1 })

  it("normalize 任意两个角点，clamp 裁剪越界选区", () => {
    expect(range).toEqual({ columnFrom: 1, columnTo: 2, rowFrom: -1, rowTo: 1 })
    expect(clampTableCellRange(table, { columnFrom: 1, columnTo: 9, rowFrom: 0, rowTo: 8 })).toEqual({ columnFrom: 1, columnTo: 2, rowFrom: 0, rowTo: 1 })
    expect(clampTableCellRange(table, { columnFrom: 5, columnTo: 9, rowFrom: 0, rowTo: 1 })).toBeNull()
  })

  it("tableCellAt 同时覆盖表头与正文行", () => {
    expect(tableCellAt(table, -1, 0)).toBe("A")
    expect(tableCellAt(table, 1, 2)).toBe("6")
    expect(tableCellAt(table, 9, 9)).toBe("")
  })

  it("删除行范围跳过表头，删除列范围保底一列", () => {
    const withHeaderOnly = deleteTableRowRange(table, { columnFrom: 0, columnTo: 2, rowFrom: -1, rowTo: -1 })
    expect(withHeaderOnly).toBeNull()
    const withoutFirstRow = deleteTableRowRange(table, { columnFrom: 0, columnTo: 2, rowFrom: -1, rowTo: 0 })!
    expect(withoutFirstRow.rows).toEqual([["4", "5", "6"]])
    const squeezed = deleteTableColumnRange(table, { columnFrom: 0, columnTo: 2, rowFrom: -1, rowTo: 1 })
    expect(squeezed).toBeNull()
    const partial = deleteTableColumnRange(table, { columnFrom: 1, columnTo: 2, rowFrom: -1, rowTo: 1 })!
    expect(partial.header).toEqual(["A"])
    expect(partial.aligns).toEqual(["left"])
  })

  it("清空范围只改内容、不动结构；表头也参与清空", () => {
    const cleared = clearTableCellRange(table, range)
    expect(cleared.header).toEqual(["A", "", ""])
    expect(cleared.rows).toEqual([["1", "", ""], ["4", "", ""]])
    expect(cleared.aligns).toEqual(table.aligns)
  })

  it("批量加粗可再次切换取消；混合选区先统一补齐", () => {
    const bolded = toggleTableCellRangeMark(table, { columnFrom: 0, columnTo: 0, rowFrom: 0, rowTo: 1 }, "**")!
    expect(bolded.rows[0][0]).toBe("**1**")
    expect(bolded.rows[1][0]).toBe("**4**")
    const unbolded = toggleTableCellRangeMark(bolded, { columnFrom: 0, columnTo: 0, rowFrom: 0, rowTo: 1 }, "**")!
    expect(unbolded).toEqual(table)
    const alreadyBold = parseMarkdownTable(["| A |", "| --- |", "| **x** |", "| y |"].join("\n"))!
    const mixed = toggleTableCellRangeMark(alreadyBold, { columnFrom: 0, columnTo: 0, rowFrom: 0, rowTo: 1 }, "**")!
    expect(mixed.rows[0][0]).toBe("**x**")
    expect(mixed.rows[1][0]).toBe("**y**")
  })

  it("斜体判定不把加粗误算进去", () => {
    const bold = parseMarkdownTable(["| A |", "| --- |", "| **x** |"].join("\n"))!
    const result = toggleTableCellRangeMark(bold, { columnFrom: 0, columnTo: 0, rowFrom: 0, rowTo: 0 }, "*")!
    expect(result.rows[0][0]).toBe("***x***")
  })

  it("导出 TSV 时转义制表符与换行", () => {
    const tricky = parseMarkdownTable(["| A | B |", "| --- | --- |", "| a<br>b | c |"].join("\n"))!
    expect(tableCellRangeToTsv(tricky, { columnFrom: 0, columnTo: 1, rowFrom: -1, rowTo: 0 })).toBe("A\tB\na<br>b\tc")
  })
})
