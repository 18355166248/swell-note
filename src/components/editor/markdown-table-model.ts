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

// 在当前行上方/下方插入空行。rowIndex 以正文行为基准（0..rows.length），
// 表头由 GFM 语法固定为首行，不提供「表头上方插行」；调用方负责把表头映射成 rowIndex 0。
export function insertTableRow(table: MarkdownTable, rowIndex: number) {
  if (rowIndex < 0 || rowIndex > table.rows.length) return null
  const next = cloneMarkdownTable(table)
  next.rows.splice(rowIndex, 0, Array(next.header.length).fill(""))
  return next
}

// 在当前列左侧/右侧插入空列。columnIndex 允许 0..header.length；
// 新列沿用左侧相邻列的对齐方式（最左侧则沿用原第一列），表头留空由用户填写。
export function insertTableColumn(table: MarkdownTable, columnIndex: number) {
  if (columnIndex < 0 || columnIndex > table.header.length) return null
  const next = cloneMarkdownTable(table)
  next.header.splice(columnIndex, 0, "")
  next.aligns.splice(columnIndex, 0, next.aligns[Math.min(columnIndex, next.aligns.length - 1)] ?? "left")
  next.rows.forEach((row) => row.splice(columnIndex, 0, ""))
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

// 矩形选区统一用「可视行」坐标：-1 表示表头，0 起为正文行；行列范围均已按大小归一（from <= to）。
export type TableCellRange = {
  columnFrom: number
  columnTo: number
  rowFrom: number
  rowTo: number
}

export function normalizeTableCellRange(a: { column: number; row: number }, b: { column: number; row: number }): TableCellRange {
  return {
    columnFrom: Math.min(a.column, b.column),
    columnTo: Math.max(a.column, b.column),
    rowFrom: Math.min(a.row, b.row),
    rowTo: Math.max(a.row, b.row),
  }
}

// 结构改写后表格尺寸变化，旧选区可能越界；裁剪后仍有效才保留，否则由调用方丢弃。
export function clampTableCellRange(table: MarkdownTable, range: TableCellRange): TableCellRange | null {
  const columnFrom = Math.max(0, range.columnFrom)
  const columnTo = Math.min(table.header.length - 1, range.columnTo)
  const rowFrom = Math.max(-1, range.rowFrom)
  const rowTo = Math.min(table.rows.length - 1, range.rowTo)
  if (columnFrom > columnTo || rowFrom > rowTo) return null
  return { columnFrom, columnTo, rowFrom, rowTo }
}

export function tableCellAt(table: MarkdownTable, row: number, column: number) {
  return row < 0 ? table.header[column] ?? "" : table.rows[row]?.[column] ?? ""
}

// 删除选区覆盖的正文行。表头行（-1）在 GFM 中不可删除，落在选区里也只是被跳过。
export function deleteTableRowRange(table: MarkdownTable, range: TableCellRange) {
  const from = Math.max(0, range.rowFrom)
  const to = Math.min(table.rows.length - 1, range.rowTo)
  if (from > to) return null
  const next = cloneMarkdownTable(table)
  next.rows.splice(from, to - from + 1)
  return next
}

// 删除选区覆盖的列；至少保留一列，否则分隔行不再构成有效表格。
export function deleteTableColumnRange(table: MarkdownTable, range: TableCellRange) {
  const from = Math.max(0, range.columnFrom)
  const to = Math.min(table.header.length - 1, range.columnTo)
  if (from > to || table.header.length - (to - from + 1) < 1) return null
  const next = cloneMarkdownTable(table)
  next.header.splice(from, to - from + 1)
  next.aligns.splice(from, to - from + 1)
  next.rows.forEach((row) => row.splice(from, to - from + 1))
  return next
}

export function clearTableCellRange(table: MarkdownTable, range: TableCellRange) {
  const next = cloneMarkdownTable(table)
  for (let row = range.rowFrom; row <= range.rowTo; row += 1) {
    for (let column = range.columnFrom; column <= range.columnTo; column += 1) {
      if (row < 0) next.header[column] = ""
      else if (next.rows[row]) next.rows[row][column] = ""
    }
  }
  return next
}

// 批量加粗/斜体/删除线：选区内所有非空单元格都已被同一标记完整包裹时统一解除，否则统一包裹。
// 与正文「再点一次取消格式」的交互一致，且整次改写是单个事务，可一次撤销。
export function toggleTableCellRangeMark(table: MarkdownTable, range: TableCellRange, mark: "**" | "*" | "~~" | "`") {
  const cells: Array<{ column: number; row: number; value: string }> = []
  for (let row = range.rowFrom; row <= range.rowTo; row += 1) {
    for (let column = range.columnFrom; column <= range.columnTo; column += 1) {
      const value = tableCellAt(table, row, column)
      if (value.trim()) cells.push({ column, row, value })
    }
  }
  if (cells.length === 0) return null
  // 加粗标记同时满足斜体的包裹形式，斜体判断必须先排除加粗，否则会误判成可解除。
  const isWrapped = (value: string) => {
    if (mark === "*") {
      return value.startsWith("*") && value.endsWith("*") && !value.startsWith("**") && !value.endsWith("**") && value.length > 2
    }
    return value.startsWith(mark) && value.endsWith(mark) && value.length > mark.length * 2 - 1
  }
  const unwrap = cells.every((cell) => isWrapped(cell.value.trim()))
  const next = cloneMarkdownTable(table)
  for (const cell of cells) {
    const value = cell.value.trim()
    // 混合选区补齐时，已包裹的单元格原样保留，不能叠成 ****x****。
    const replaced = unwrap
      ? mark === "*"
        ? value.slice(1, -1)
        : value.slice(mark.length, -mark.length)
      : isWrapped(value)
        ? value
        : `${mark}${value}${mark}`
    if (cell.row < 0) next.header[cell.column] = replaced
    else next.rows[cell.row][cell.column] = replaced
  }
  return next
}

// 复制选区为制表符文本，与 Excel/Numbers 及 pasteTableCells 的解析互相对应；
// 单元格内的换行（<br>）还原为真实换行会破坏 TSV 结构，这里保留 <br> 字面形式。
export function tableCellRangeToTsv(table: MarkdownTable, range: TableCellRange) {
  const lines: string[] = []
  for (let row = range.rowFrom; row <= range.rowTo; row += 1) {
    const cells: string[] = []
    for (let column = range.columnFrom; column <= range.columnTo; column += 1) {
      cells.push(tableCellAt(table, row, column).replace(/\t/g, " ").replace(/\r?\n/g, "<br>"))
    }
    lines.push(cells.join("\t"))
  }
  return lines.join("\n")
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

// Excel/Numbers 的制表符内容允许双引号包住换行；解析时保留格内换行，只将行尾换行视为结束。
export function parseTabularText(text: string): string[][] | null {
  if (!text.includes("\t")) return null
  const rows: string[][] = [[]]
  let value = "", quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '"' && (quoted || value === "")) {
      if (quoted && text[i + 1] === '"') { value += '"'; i += 1 }
      else quoted = !quoted
    } else if (!quoted && (ch === "\t" || ch === "\n" || ch === "\r")) {
      rows[rows.length - 1].push(value); value = ""
      if (ch !== "\t") {
        if (ch === "\r" && text[i + 1] === "\n") i += 1
        rows.push([])
      }
    } else value += ch
  }
  if (value || rows[rows.length - 1].length) rows[rows.length - 1].push(value)
  else rows.pop()
  return rows.length ? rows : null
}

export function pasteTableCells(table: MarkdownTable, row: number, column: number, cells: string[][]) {
  const next = cloneMarkdownTable(table)
  const width = Math.max(next.header.length, column + Math.max(...cells.map((line) => line.length)))
  while (next.header.length < width) { next.header.push(""); next.aligns.push("left") }
  next.rows.forEach((line) => { while (line.length < width) line.push("") })
  while (next.rows.length < row + cells.length - 1) next.rows.push(Array(width).fill(""))
  cells.forEach((line, offset) => {
    const target = row + offset === 0 ? next.header : next.rows[row + offset - 1]
    line.forEach((value, col) => { target[column + col] = value })
  })
  return next
}
