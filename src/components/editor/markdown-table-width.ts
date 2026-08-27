export type TableWidthMode = "content" | "equal" | "full" | "manual"

export type TableColumnPreference = {
  mode: TableWidthMode
  widths: number[]
}

const TABLE_COLUMN_PREFERENCE_PREFIX = "swell-note:editor-table-columns:v1"
export const MIN_TABLE_COLUMN_WIDTH = 72

function preferenceStorageKey(noteKey: string, tableIndex: number) {
  // 笔记 ID 可能是很长的 WebDAV URI；稳定哈希可以控制 localStorage key 长度。
  let hash = 2166136261
  for (const character of noteKey) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `${TABLE_COLUMN_PREFERENCE_PREFIX}:${(hash >>> 0).toString(36)}:${tableIndex}`
}

function validWidths(widths: unknown, columnCount: number): widths is number[] {
  return Array.isArray(widths)
    && widths.length === columnCount
    && widths.every((width) => Number.isFinite(width) && width >= MIN_TABLE_COLUMN_WIDTH)
}

export function loadTableColumnPreference(noteKey: string, tableIndex: number, columnCount: number): TableColumnPreference | null {
  try {
    const raw = window.localStorage.getItem(preferenceStorageKey(noteKey, tableIndex))
    if (!raw) return null
    const preference = JSON.parse(raw) as Partial<TableColumnPreference>
    const mode = preference.mode
    const validMode = mode === "content" || mode === "equal" || mode === "full" || mode === "manual"
    if (!validMode || !validWidths(preference.widths, columnCount)) return null
    return { mode, widths: [...preference.widths] }
  } catch {
    return null
  }
}

export function saveTableColumnPreference(noteKey: string, tableIndex: number, preference: TableColumnPreference) {
  try {
    window.localStorage.setItem(preferenceStorageKey(noteKey, tableIndex), JSON.stringify({
      mode: preference.mode,
      widths: preference.widths.map((width) => Math.round(width * 100) / 100),
    }))
  } catch {
    // 隐私模式或存储空间不足时保留当前会话状态，不影响继续编辑表格。
  }
}

export function resizeAdjacentColumnWidths(
  widths: number[],
  dividerIndex: number,
  delta: number,
  minimum = MIN_TABLE_COLUMN_WIDTH,
) {
  if (dividerIndex < 0 || dividerIndex >= widths.length - 1) return [...widths]
  const left = widths[dividerIndex]
  const right = widths[dividerIndex + 1]
  const safeDelta = Math.min(right - minimum, Math.max(minimum - left, delta))
  const next = [...widths]
  next[dividerIndex] = left + safeDelta
  next[dividerIndex + 1] = right - safeDelta
  return next
}

export function tableColumnPercentages(widths: number[]) {
  const total = widths.reduce((sum, width) => sum + width, 0) || 1
  return widths.map((width) => (width / total) * 100)
}
