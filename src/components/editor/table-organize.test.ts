import { expect, it } from "vitest"
import { organizeMarkdownTable, parseMarkdownTable, serializeMarkdownTable } from "./markdown-table-model"
const table = () => parseMarkdownTable("| 名称 | 数量 |\n| --- | ---: |\n| 甲 | 10 |\n| 乙 | 2 |\n| 丙 | 2 |")!
it("移动和复制行列不修改原模型，表头及列对齐随列移动", () => {
  const original = table()
  expect(organizeMarkdownTable(original, "row-up", 0, 0)).toBeNull()
  expect(organizeMarkdownTable(original, "row-copy", -1, 0)).toBeNull()
  expect(organizeMarkdownTable(original, "row-down", 0, 0)?.rows[1]).toEqual(["甲", "10"])
  expect(organizeMarkdownTable(original, "row-copy", 0, 0)?.rows).toHaveLength(4)
  const moved = organizeMarkdownTable(original, "column-left", 0, 1)!
  expect(moved.header).toEqual(["数量", "名称"])
  expect(moved.aligns).toEqual(["right", "left"])
  expect(moved.rows[0]).toEqual(["10", "甲"])
  const copy = organizeMarkdownTable(original, "column-copy", 0, 1)!
  expect(copy.rows[0]).toEqual(["甲", "10", "10"])
  expect(copy.aligns).toEqual(["left", "right", "right"])
  expect(original).toEqual(table())
})
it("按列自然排序保持同值稳定，空格和转义可往返", () => {
  const sorted = organizeMarkdownTable(table(), "sort-asc", 0, 1)!
  expect(sorted.rows.map((row) => row[0])).toEqual(["乙", "丙", "甲"])
  expect(parseMarkdownTable(serializeMarkdownTable(sorted))).toEqual(sorted)
  expect(organizeMarkdownTable(sorted, "sort-desc", 0, 1)?.rows.map((row) => row[0])).toEqual(["甲", "乙", "丙"])
})
