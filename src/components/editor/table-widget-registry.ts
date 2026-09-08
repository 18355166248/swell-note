// 表格 Widget 由 CodeMirror 以命令式 DOM 维护，右键菜单是 React 组件；
// 这里用 wrapper 元素作键登记当前表格的操作接口，React 侧经 closest(".cm-md-table-wrap") 找到它。
// Widget 重建（单元格提交、撤销等）时会用同 wrapper 重新登记，destroy 时注销，接口不会悬空。

export type TableMenuTarget = { column: number; row: number }

export type TableWidgetMenuState = {
  canClear: boolean
  canDeleteColumn: boolean
  canDeleteRow: boolean
  canInsertRowAbove: boolean
  hasRangeSelection: boolean
  readOnly: boolean
  target: TableMenuTarget
}

export type TableWidgetApi = {
  clearContents: () => void
  copySelection: () => Promise<boolean>
  deleteColumns: () => void
  deleteRows: () => void
  deleteWholeTable: () => void
  // 结构操作发生在单元格编辑途中时，先把未提交的输入写回表格，避免内容丢失。
  commitActiveEdit: () => void
  getMenuState: () => TableWidgetMenuState
  insertColumn: (side: "left" | "right") => void
  insertRow: (position: "above" | "below") => void
  // 右键落点不在已有矩形选区内时，把操作目标改到被点的单元格。
  retarget: (cell: TableMenuTarget) => void
  targetInRange: (cell: TableMenuTarget) => boolean
}

const registry = new WeakMap<HTMLElement, TableWidgetApi>()

export function registerTableWidgetApi(wrapper: HTMLElement, api: TableWidgetApi) {
  registry.set(wrapper, api)
  return () => { if (registry.get(wrapper) === api) registry.delete(wrapper) }
}

export function tableWidgetApiFor(element: Element): { api: TableWidgetApi; wrapper: HTMLElement } | null {
  const wrapper = element.closest<HTMLElement>(".cm-md-table-wrap")
  if (!wrapper) return null
  const api = registry.get(wrapper)
  return api ? { api, wrapper } : null
}
