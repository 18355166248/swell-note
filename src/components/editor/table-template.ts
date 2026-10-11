// 行数含表头，所以最少是「表头 + 1 行内容」。
export const TABLE_LIMITS = { minRows: 2, maxRows: 20, minCols: 1, maxCols: 8 } as const
export const TABLE_DEFAULT_SIZE = { rows: 3, cols: 3 } as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value) || min))
}

// 新表格所有单元格留空：占位文字只会变成用户必须手动删掉的脏数据。
export function buildTableTemplate(rows: number, cols: number) {
  const rowCount = clamp(rows, TABLE_LIMITS.minRows, TABLE_LIMITS.maxRows)
  const colCount = clamp(cols, TABLE_LIMITS.minCols, TABLE_LIMITS.maxCols)
  const blank = `|${"  |".repeat(colCount)}`
  const delimiter = `|${" --- |".repeat(colCount)}`
  // 表尾留出空行，避免在段落前插入时 GFM 把原正文吞成额外一行。
  return `\n${[blank, delimiter, ...Array.from({ length: rowCount - 1 }, () => blank)].join("\n")}\n\n`
}

// 插入完成后靠它认出这次插入的是新表格，从而自动聚焦第一个表头格。
export function isTableInsertTemplate(text: string) {
  return /^\n\|(?: {2}\|)+\n\|(?: --- \|)+\n(?:\|(?: {2}\|)+\n)+\n$/.test(text)
}
