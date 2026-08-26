export type TableAlignment = "center" | "left" | "right" | ""

export type MarkdownTable = {
  aligns: TableAlignment[]
  header: string[]
  rows: string[][]
}

const tableCellSplitPattern = /(?<!\\)\|/

function splitTableRow(line: string) {
  // 拆分后还原转义管道，单元格里应显示 | 而不是 \|。
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(tableCellSplitPattern)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"))
}

// 纯模型层不依赖 DOM 或 CodeMirror，预览、编辑器和后续导入工具都可以复用。
export function parseMarkdownTable(source: string): MarkdownTable | null {
  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const header = splitTableRow(lines[0])
  const delimiter = splitTableRow(lines[1])
  if (!delimiter.length || !delimiter.every((cell) => /^:?-{1,}:?$/.test(cell))) return null
  const aligns = delimiter.map((cell): TableAlignment => {
    const start = cell.startsWith(":")
    const end = cell.endsWith(":")
    if (start && end) return "center"
    if (end) return "right"
    return "left"
  })
  return { aligns, header, rows: lines.slice(2).map(splitTableRow) }
}

function serializeTableCell(value: string) {
  // Markdown 表格不能包含物理换行，统一转成兼容 CommonMark/GFM 的 HTML 换行标签。
  return value.trim().replace(/\r?\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|")
}

export function serializeMarkdownTable(table: MarkdownTable) {
  const row = (cells: string[]) => `| ${cells.map(serializeTableCell).join(" | ")} |`
  const delimiter = table.aligns.map((align) => align === "center" ? ":---:" : align === "right" ? "---:" : "---")
  return [row(table.header), row(delimiter), ...table.rows.map(row)].join("\n")
}

export function cloneMarkdownTable(table: MarkdownTable): MarkdownTable {
  return {
    aligns: [...table.aligns],
    header: [...table.header],
    rows: table.rows.map((row) => [...row]),
  }
}

export function appendTableRow(table: MarkdownTable) {
  const next = cloneMarkdownTable(table)
  next.rows.push(Array(next.header.length).fill(""))
  return next
}

export function appendTableColumn(table: MarkdownTable, label = "新列") {
  const next = cloneMarkdownTable(table)
  next.header.push(label)
  next.aligns.push("left")
  next.rows.forEach((row) => row.push(""))
  return next
}

export function deleteTableRow(table: MarkdownTable, rowIndex: number) {
  if (rowIndex < 0 || rowIndex >= table.rows.length) return null
  const next = cloneMarkdownTable(table)
  next.rows.splice(rowIndex, 1)
  return next
}

export function deleteTableColumn(table: MarkdownTable, columnIndex: number) {
  // Markdown 表格至少保留一列，否则分隔行不再构成有效表格。
  if (table.header.length <= 1 || columnIndex < 0 || columnIndex >= table.header.length) return null
  const next = cloneMarkdownTable(table)
  next.header.splice(columnIndex, 1)
  next.aligns.splice(columnIndex, 1)
  next.rows.forEach((row) => row.splice(columnIndex, 1))
  return next
}

export function alignTableColumn(table: MarkdownTable, columnIndex: number, align: TableAlignment) {
  if (columnIndex < 0 || columnIndex >= table.header.length) return null
  const next = cloneMarkdownTable(table)
  next.aligns[columnIndex] = align
  return next
}

function textDisplayUnits(value: string) {
  return Array.from(value).reduce((total, character) => total + (/^[\x00-\xff]$/.test(character) ? 1 : 2), 0)
}

function tableCellDisplayUnits(value: string) {
  return Math.max(...value.split(/<br\s*\/?>/i).map(textDisplayUnits))
}

export function tableColumnWidths(table: MarkdownTable) {
  return table.header.map((header, column) => {
    const maxUnits = Math.max(tableCellDisplayUnits(header), ...table.rows.map((row) => tableCellDisplayUnits(row[column] ?? "")))
    return Math.min(360, Math.max(96, maxUnits * 7 + 28))
  })
}
