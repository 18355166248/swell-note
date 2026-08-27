import { EditorView, WidgetType } from "@codemirror/view"

import {
  alignTableColumn,
  appendTableColumn,
  appendTableRow,
  cloneMarkdownTable,
  deleteTableColumn,
  deleteTableRow,
  parseMarkdownTable,
  serializeMarkdownTable,
  tableColumnWidths,
  type MarkdownTable,
  type TableAlignment,
} from "./markdown-table-model"
import { renderTableInlineMarkdown, type TableInlineOptions } from "./markdown-table-inline"
import {
  loadTableColumnPreference,
  MIN_TABLE_COLUMN_WIDTH,
  resizeAdjacentColumnWidths,
  saveTableColumnPreference,
  tableColumnPercentages,
  type TableColumnPreference,
  type TableWidthMode,
} from "./markdown-table-width"

type TableVerticalMode = "bottom" | "middle" | "top"
type CellTarget = { column: number; row: number }

const TABLE_WIDTH_MODE_KEY = "swell-note:editor-table-width"
const TABLE_VERTICAL_MODE_KEY = "swell-note:editor-table-vertical-align"
const widthModeOrder: Array<Exclude<TableWidthMode, "manual">> = ["content", "full", "equal"]
const sessionTableColumnPreferences = new WeakMap<EditorView, Map<number, TableColumnPreference>>()

function loadTableWidthMode(): TableWidthMode {
  try {
    const value = window.localStorage.getItem(TABLE_WIDTH_MODE_KEY)
    return value === "full" || value === "equal" ? value : "content"
  } catch {
    return "content"
  }
}

function saveTableWidthMode(mode: TableWidthMode) {
  try {
    window.localStorage.setItem(TABLE_WIDTH_MODE_KEY, mode)
  } catch {
    // 隐私模式可能禁用 localStorage；当前表格仍可切换，只是不跨会话保留。
  }
}

function loadTableVerticalMode(): TableVerticalMode {
  try {
    const value = window.localStorage.getItem(TABLE_VERTICAL_MODE_KEY)
    return value === "middle" || value === "bottom" ? value : "top"
  } catch {
    return "top"
  }
}

function saveTableVerticalMode(mode: TableVerticalMode) {
  try {
    window.localStorage.setItem(TABLE_VERTICAL_MODE_KEY, mode)
  } catch {
    // 显示偏好写入失败不影响当前表格继续编辑。
  }
}

function nextTableWidthMode(mode: TableWidthMode): Exclude<TableWidthMode, "manual"> {
  if (mode === "manual") return "content"
  return widthModeOrder[(widthModeOrder.indexOf(mode) + 1) % widthModeOrder.length] ?? "content"
}

function applyTableWidthMode(wrapper: HTMLElement, mode: TableWidthMode, configuredWidths?: number[]) {
  const table = wrapper.querySelector<HTMLTableElement>(".cm-md-table")
  const columns = Array.from(table?.querySelectorAll<HTMLTableColElement>("col[data-content-width]") ?? [])
  if (!table || columns.length === 0) return
  const widths = configuredWidths?.length === columns.length
    ? configuredWidths
    : columns.map((column) => Number(column.dataset.configuredWidth || column.dataset.contentWidth) || 96)
  const totalWidth = widths.reduce((total, width) => total + width, 0)
  const percentages = tableColumnPercentages(widths)

  wrapper.dataset.widthMode = mode
  wrapper.dataset.columnWidths = widths.join(",")
  table.style.tableLayout = "fixed"
  table.style.width = mode === "content" ? `${totalWidth}px` : "100%"
  // 自定义模式保存的是列宽比例；整表只保留可用性下限，避免窄窗口继续沿用旧像素总宽而撑破编辑区。
  table.style.minWidth = mode === "manual" ? `${columns.length * MIN_TABLE_COLUMN_WIDTH}px` : ""
  columns.forEach((column, index) => {
    column.dataset.configuredWidth = String(widths[index])
    column.style.width = mode === "equal"
      ? `${100 / columns.length}%`
      : mode === "full" || mode === "manual"
        ? `${percentages[index]}%`
        : `${widths[index]}px`
  })

  const headerCells = Array.from(table.tHead?.rows[0]?.cells ?? [])
  headerCells.slice(0, -1).forEach((cell, index) => {
    const handle = cell.querySelector<HTMLElement>(".cm-md-table-resize-handle")
    if (!handle) return
    handle.setAttribute("aria-valuenow", String(Math.round(percentages[index])))
    handle.setAttribute("aria-valuetext", `第 ${index + 1} 列宽度 ${Math.round(percentages[index])}%`)
  })

  const button = wrapper.querySelector<HTMLButtonElement>(".cm-md-table-width-toggle")
  if (!button) return
  const labels: Record<TableWidthMode, string> = {
    content: "宽度：适应",
    equal: "宽度：均分",
    full: "宽度：铺满",
    manual: "宽度：自定义",
  }
  button.textContent = labels[mode]
  button.title = mode === "manual" ? "列宽已锁定，点击重置为内容适应" : `当前${labels[mode].slice(3)}，点击切换列宽模式`
  button.setAttribute("aria-pressed", String(mode !== "content"))
}

function applyTableVerticalMode(wrapper: HTMLElement, mode: TableVerticalMode) {
  wrapper.dataset.verticalAlign = mode
  for (const button of wrapper.querySelectorAll<HTMLButtonElement>("[data-table-vertical]")) {
    const active = button.dataset.tableVertical === mode
    button.setAttribute("aria-pressed", String(active))
    button.dataset.active = String(active)
  }
}

export class TableWidget extends WidgetType {
  readonly objectUrls = new Set<string>()
  readonly cleanupCallbacks = new Set<() => void>()

  constructor(
    readonly source: string,
    readonly view: EditorView,
    readonly from: number,
    readonly to: number,
    readonly options: TableInlineOptions = {},
    readonly tableIndex = 0,
  ) {
    super()
  }

  eq(other: TableWidget) {
    return other.source === this.source
      && other.from === this.from
      && other.to === this.to
      && other.tableIndex === this.tableIndex
      && other.options.tableStorageKey === this.options.tableStorageKey
  }

  private loadColumnPreference(initialWidths: number[]) {
    let preferences = sessionTableColumnPreferences.get(this.view)
    if (!preferences) {
      preferences = new Map()
      sessionTableColumnPreferences.set(this.view, preferences)
    }
    const sessionPreference = preferences.get(this.tableIndex)
    if (sessionPreference?.widths.length === initialWidths.length) return sessionPreference

    const stored = this.options.tableStorageKey
      ? loadTableColumnPreference(this.options.tableStorageKey, this.tableIndex, initialWidths.length)
      : null
    const preference = stored ?? { mode: loadTableWidthMode(), widths: initialWidths }
    preferences.set(this.tableIndex, preference)
    if (!stored && this.options.tableStorageKey) {
      // 第一次渲染即锁定内容推导出的基准宽度，后续长文本提交不会重新分配整张表。
      saveTableColumnPreference(this.options.tableStorageKey, this.tableIndex, preference)
    }
    return preference
  }

  private saveColumnPreference(preference: TableColumnPreference) {
    let preferences = sessionTableColumnPreferences.get(this.view)
    if (!preferences) {
      preferences = new Map()
      sessionTableColumnPreferences.set(this.view, preferences)
    }
    preferences.set(this.tableIndex, { mode: preference.mode, widths: [...preference.widths] })
    if (this.options.tableStorageKey) {
      saveTableColumnPreference(this.options.tableStorageKey, this.tableIndex, preference)
    }
  }

  toDOM() {
    const table = parseMarkdownTable(this.source)
    const wrapper = document.createElement("div")
    wrapper.className = "cm-md-table-wrap"
    wrapper.dataset.tableFrom = String(this.from)
    if (!table) return wrapper

    const preference = this.loadColumnPreference(tableColumnWidths(table))
    const element = this.createTableElement(table, wrapper, preference.widths)
    const tableScroll = document.createElement("div")
    tableScroll.className = "cm-md-table-scroll"
    tableScroll.appendChild(element)
    wrapper.appendChild(tableScroll)
    applyTableWidthMode(wrapper, preference.mode, preference.widths)
    applyTableVerticalMode(wrapper, loadTableVerticalMode())

    if (!this.view.state.readOnly) {
      wrapper.insertBefore(this.createToolbar(wrapper, table), tableScroll)
      applyTableWidthMode(wrapper, preference.mode, preference.widths)
      applyTableVerticalMode(wrapper, loadTableVerticalMode())
    }
    return wrapper
  }

  destroy() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url)
    this.objectUrls.clear()
    for (const cleanup of this.cleanupCallbacks) cleanup()
    this.cleanupCallbacks.clear()
  }

  private createTableElement(table: MarkdownTable, wrapper: HTMLDivElement, configuredWidths: number[]) {
    const element = document.createElement("table")
    element.className = "cm-md-table"
    const colgroup = document.createElement("colgroup")
    for (const width of configuredWidths) {
      const column = document.createElement("col")
      column.dataset.contentWidth = String(width)
      column.dataset.configuredWidth = String(width)
      colgroup.appendChild(column)
    }
    element.appendChild(colgroup)

    const headRow = document.createElement("tr")
    table.header.forEach((cell, columnIndex) => {
      headRow.appendChild(this.createCell("th", cell, table, wrapper, -1, columnIndex))
    })
    if (!this.view.state.readOnly) this.addColumnResizeHandles(headRow, wrapper)
    const thead = document.createElement("thead")
    thead.appendChild(headRow)
    element.appendChild(thead)

    const tbody = document.createElement("tbody")
    table.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr")
      table.header.forEach((_, columnIndex) => {
        tr.appendChild(this.createCell("td", row[columnIndex] ?? "", table, wrapper, rowIndex, columnIndex))
      })
      tbody.appendChild(tr)
    })
    element.appendChild(tbody)
    return element
  }

  private createCell(
    tag: "td" | "th",
    value: string,
    table: MarkdownTable,
    wrapper: HTMLDivElement,
    rowIndex: number,
    columnIndex: number,
  ) {
    const cell = document.createElement(tag)
    cell.style.textAlign = table.aligns[columnIndex] || "left"
    const contentStack = document.createElement("div")
    contentStack.className = "cm-md-table-cell-stack"
    const display = document.createElement("div")
    display.className = "cm-md-table-cell-display"
    this.renderCell(display, value)
    contentStack.appendChild(display)
    cell.appendChild(contentStack)
    this.enableCellEditing(cell, wrapper, table, rowIndex, columnIndex, value)
    return cell
  }

  private renderCell(parent: HTMLElement, value: string) {
    renderTableInlineMarkdown(parent, value, this.options, (url) => this.objectUrls.add(url))
  }

  private renderedColumnWidths(wrapper: HTMLElement) {
    const table = wrapper.querySelector<HTMLTableElement>(".cm-md-table")
    const rendered = Array.from(table?.tHead?.rows[0]?.cells ?? []).map((cell) => cell.getBoundingClientRect().width)
    if (rendered.length > 1 && rendered.every((width) => width >= MIN_TABLE_COLUMN_WIDTH)) return rendered
    return (wrapper.dataset.columnWidths ?? "")
      .split(",")
      .map(Number)
      .filter((width) => Number.isFinite(width))
  }

  private applyManualColumnWidths(wrapper: HTMLElement, widths: number[]) {
    const preference = { mode: "manual", widths } satisfies TableColumnPreference
    applyTableWidthMode(wrapper, preference.mode, preference.widths)
    this.saveColumnPreference(preference)
  }

  private addColumnResizeHandles(headRow: HTMLTableRowElement, wrapper: HTMLDivElement) {
    Array.from(headRow.cells).slice(0, -1).forEach((cell, columnIndex) => {
      const handle = document.createElement("button")
      handle.type = "button"
      handle.className = "cm-md-table-resize-handle"
      handle.setAttribute("aria-label", `调整第 ${columnIndex + 1} 列宽度`)
      handle.setAttribute("aria-orientation", "vertical")
      handle.setAttribute("aria-valuemin", "0")
      handle.setAttribute("aria-valuemax", "100")
      handle.setAttribute("role", "separator")
      handle.title = "拖拽调整相邻列宽；方向键可微调"
      handle.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      handle.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        event.stopPropagation()
        const widths = this.renderedColumnWidths(wrapper)
        if (widths.length !== headRow.cells.length) return
        this.applyManualColumnWidths(
          wrapper,
          resizeAdjacentColumnWidths(widths, columnIndex, event.key === "ArrowLeft" ? -12 : 12),
        )
      })
      handle.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        const startWidths = this.renderedColumnWidths(wrapper)
        if (startWidths.length !== headRow.cells.length) return
        const startX = event.clientX
        let nextWidths = startWidths
        wrapper.classList.add("cm-md-table-resizing")

        const move = (moveEvent: MouseEvent) => {
          moveEvent.preventDefault()
          nextWidths = resizeAdjacentColumnWidths(startWidths, columnIndex, moveEvent.clientX - startX)
          applyTableWidthMode(wrapper, "manual", nextWidths)
        }
        const finish = () => {
          wrapper.classList.remove("cm-md-table-resizing")
          document.removeEventListener("mousemove", move)
          document.removeEventListener("mouseup", finish)
          this.cleanupCallbacks.delete(cleanup)
          this.applyManualColumnWidths(wrapper, nextWidths)
        }
        const cleanup = () => {
          wrapper.classList.remove("cm-md-table-resizing")
          document.removeEventListener("mousemove", move)
          document.removeEventListener("mouseup", finish)
        }
        document.addEventListener("mousemove", move)
        document.addEventListener("mouseup", finish, { once: true })
        this.cleanupCallbacks.add(cleanup)
      })
      cell.appendChild(handle)
    })
  }

  private createToolbar(wrapper: HTMLDivElement, table: MarkdownTable) {
    const toolbar = document.createElement("div")
    toolbar.className = "cm-md-table-toolbar"
    toolbar.setAttribute("aria-label", "表格操作")
    const selectionStatus = document.createElement("span")
    selectionStatus.className = "cm-md-table-selection-status"
    selectionStatus.setAttribute("aria-live", "polite")
    selectionStatus.textContent = "未选择单元格"
    toolbar.append(
      this.createWidthButton(wrapper, table),
      this.createToolbarMenu("行列", [
        this.createMutationButton("添加行", wrapper, () => appendTableRow(table)),
        this.createMutationButton("添加列", wrapper, () => appendTableColumn(table)),
        this.createDeleteButton("删除行", "row", wrapper, table),
        this.createDeleteButton("删除列", "column", wrapper, table),
      ]),
      this.createToolbarMenu("水平", [
        this.createAlignButton("左对齐", "left", wrapper, table),
        this.createAlignButton("居中", "center", wrapper, table),
        this.createAlignButton("右对齐", "right", wrapper, table),
      ]),
      this.createToolbarMenu("垂直", [
        this.createVerticalAlignButton("顶对齐", "top"),
        this.createVerticalAlignButton("垂直居中", "middle"),
        this.createVerticalAlignButton("底对齐", "bottom"),
      ]),
      selectionStatus,
    )
    return toolbar
  }

  private createToolbarMenu(label: string, buttons: HTMLButtonElement[]) {
    const menu = document.createElement("details")
    menu.className = "cm-md-table-menu"
    const trigger = document.createElement("summary")
    trigger.textContent = label
    trigger.setAttribute("aria-label", `${label}操作`)
    trigger.addEventListener("mousedown", (event) => event.preventDefault())
    const panel = document.createElement("div")
    panel.className = "cm-md-table-menu-panel"
    panel.append(...buttons)
    panel.addEventListener("click", (event) => {
      if (event.target instanceof HTMLButtonElement && !event.target.disabled) menu.open = false
    })
    menu.addEventListener("toggle", () => {
      if (!menu.open) return
      for (const sibling of menu.parentElement?.querySelectorAll<HTMLDetailsElement>(".cm-md-table-menu[open]") ?? []) {
        if (sibling !== menu) sibling.open = false
      }
    })
    const closeOnOutside = (event: PointerEvent) => {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false
    }
    document.addEventListener("pointerdown", closeOnOutside)
    this.cleanupCallbacks.add(() => document.removeEventListener("pointerdown", closeOnOutside))
    menu.append(trigger, panel)
    return menu
  }

  private createWidthButton(wrapper: HTMLDivElement, table: MarkdownTable) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "cm-md-table-width-toggle"
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      const current = widthModeOrder.includes(wrapper.dataset.widthMode as Exclude<TableWidthMode, "manual">)
        ? wrapper.dataset.widthMode as Exclude<TableWidthMode, "manual">
        : wrapper.dataset.widthMode === "manual" ? "manual" : "content"
      const mode = nextTableWidthMode(current)
      saveTableWidthMode(mode)
      const widths = current === "manual"
        ? tableColumnWidths(this.tableWithActiveEdit(wrapper, table))
        : this.renderedColumnWidths(wrapper)
      const preference = { mode, widths } satisfies TableColumnPreference
      this.saveColumnPreference(preference)
      // 列宽是当前表格的显示偏好，不改写 Markdown；新表格仍沿用最近选择的基础模式。
      applyTableWidthMode(wrapper, mode, widths)
    })
    return button
  }

  private createMutationButton(label: string, wrapper: HTMLDivElement, update: () => MarkdownTable) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.title = label
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.replaceTable(this.mergeActiveEdit(wrapper, update()))
    })
    return button
  }

  private createDeleteButton(
    label: string,
    kind: "column" | "row",
    wrapper: HTMLDivElement,
    table: MarkdownTable,
  ) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.dataset.tableAction = kind === "row" ? "delete-row" : "delete-column"
    button.disabled = true
    button.title = kind === "row" ? "先选择需要删除的正文行" : "先选择需要删除的列"
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      const rowIndex = Number(wrapper.dataset.selectedRow)
      const columnIndex = Number(wrapper.dataset.selectedColumn)
      if (!Number.isInteger(columnIndex)) return

      const current = this.tableWithActiveEdit(wrapper, table)
      if (kind === "row") {
        const next = deleteTableRow(current, rowIndex)
        if (!next) return
        const focusRow = next.rows.length === 0 ? 0 : Math.min(rowIndex, next.rows.length - 1) + 1
        this.replaceTable(next, { column: Math.min(columnIndex, next.header.length - 1), row: focusRow })
        return
      }

      const next = deleteTableColumn(current, columnIndex)
      if (!next) return
      const focusColumn = Math.min(columnIndex, next.header.length - 1)
      const focusRow = rowIndex < 0 ? 0 : Math.min(rowIndex, Math.max(0, next.rows.length - 1)) + 1
      this.replaceTable(next, { column: focusColumn, row: focusRow })
    })
    return button
  }

  private createAlignButton(
    label: string,
    align: TableAlignment,
    wrapper: HTMLDivElement,
    table: MarkdownTable,
  ) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.dataset.tableAction = "align"
    button.dataset.tableAlign = align
    button.disabled = true
    button.title = `选中单元格后将所在列设为${label}`
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      const rowIndex = Number(wrapper.dataset.selectedRow)
      const columnIndex = Number(wrapper.dataset.selectedColumn)
      const next = alignTableColumn(this.tableWithActiveEdit(wrapper, table), columnIndex, align)
      if (!next) return
      this.replaceTable(next, { column: columnIndex, row: rowIndex < 0 ? 0 : rowIndex + 1 })
    })
    return button
  }

  private createVerticalAlignButton(label: string, align: TableVerticalMode) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.dataset.tableVertical = align
    button.title = `${label}（显示偏好，不改写 Markdown）`
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      saveTableVerticalMode(align)
      // Markdown 没有垂直对齐语法，因此作为编辑器级显示偏好应用到当前正文的所有表格。
      for (const candidate of this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-wrap")) {
        applyTableVerticalMode(candidate, align)
      }
    })
    return button
  }

  private mergeActiveEdit(wrapper: HTMLDivElement, table: MarkdownTable) {
    const next = cloneMarkdownTable(table)
    const input = wrapper.querySelector<HTMLTextAreaElement>(".cm-md-table-cell-input")
    const cell = input?.closest<HTMLTableCellElement>("th, td")
    const rowIndex = Number(cell?.dataset.rowIndex)
    const columnIndex = Number(cell?.dataset.columnIndex)
    if (!input || !Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return next
    if (rowIndex < 0) next.header[columnIndex] = input.value
    else if (next.rows[rowIndex]) next.rows[rowIndex][columnIndex] = input.value
    return next
  }

  private tableWithActiveEdit(wrapper: HTMLDivElement, table: MarkdownTable) {
    return this.mergeActiveEdit(wrapper, table)
  }

  private selectCell(
    wrapper: HTMLDivElement,
    table: MarkdownTable,
    rowIndex: number,
    columnIndex: number,
  ) {
    // 选中状态只驱动工具栏操作，不添加边框或背景，避免表格在展示态和编辑态之间产生视觉抖动。
    wrapper.dataset.selectedRow = String(rowIndex)
    wrapper.dataset.selectedColumn = String(columnIndex)
    const selectionStatus = wrapper.querySelector<HTMLElement>(".cm-md-table-selection-status")
    if (selectionStatus) {
      selectionStatus.textContent = rowIndex < 0
        ? `表头 · 第 ${columnIndex + 1} 列`
        : `第 ${rowIndex + 1} 行 · 第 ${columnIndex + 1} 列`
    }
    const deleteRow = wrapper.querySelector<HTMLButtonElement>('[data-table-action="delete-row"]')
    const deleteColumn = wrapper.querySelector<HTMLButtonElement>('[data-table-action="delete-column"]')
    if (deleteRow) {
      deleteRow.disabled = rowIndex < 0 || table.rows.length === 0
      deleteRow.title = rowIndex < 0 ? "表头不能作为正文行删除" : `删除第 ${rowIndex + 1} 行`
    }
    if (deleteColumn) {
      deleteColumn.disabled = table.header.length <= 1
      deleteColumn.title = table.header.length <= 1 ? "表格至少需要保留一列" : `删除第 ${columnIndex + 1} 列`
    }
    for (const button of wrapper.querySelectorAll<HTMLButtonElement>('[data-table-action="align"]')) {
      button.disabled = false
    }
  }

  private replaceTable(table: MarkdownTable, focus?: CellTarget) {
    // 同步或撤销可能在交互期间替换正文；写回前核验原始范围，避免旧 Widget 覆盖新表格。
    if (this.view.state.sliceDoc(this.from, this.to) !== this.source) return false
    this.view.dispatch({ changes: { from: this.from, to: this.to, insert: serializeMarkdownTable(table) } })
    if (focus) this.focusCellAfterUpdate(focus)
    return true
  }

  private focusCellAfterUpdate(target: CellTarget) {
    window.setTimeout(() => {
      const wrapper = Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-wrap"))
        .find((candidate) => Number(candidate.dataset.tableFrom) === this.from)
      const cell = wrapper?.querySelectorAll("tr")?.[target.row]?.children[target.column]
      if (cell instanceof HTMLElement) cell.click()
    }, 0)
  }

  private enableCellEditing(
    cell: HTMLTableCellElement,
    wrapper: HTMLDivElement,
    table: MarkdownTable,
    rowIndex: number,
    columnIndex: number,
    originalValue: string,
  ) {
    if (this.view.state.readOnly) return
    cell.classList.add("cm-md-table-cell-editable")
    cell.dataset.rowIndex = String(rowIndex)
    cell.dataset.columnIndex = String(columnIndex)
    cell.tabIndex = 0
    cell.setAttribute("aria-label", `编辑表格${rowIndex < 0 ? "表头" : `第 ${rowIndex + 1} 行`}第 ${columnIndex + 1} 列`)

    const beginEditing = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      this.selectCell(wrapper, table, rowIndex, columnIndex)
      const activeInput = wrapper.querySelector<HTMLTextAreaElement>(".cm-md-table-cell-input")
      if (activeInput && !cell.contains(activeInput)) {
        // 切换单元格时先写回旧输入，再在重绘后的目标格继续编辑，避免残留多个输入框。
        this.replaceTable(this.tableWithActiveEdit(wrapper, table), { column: columnIndex, row: rowIndex + 1 })
        return
      }
      if (cell.querySelector("textarea")) return
      this.openCellInput(cell, table, rowIndex, columnIndex, originalValue)
    }
    cell.addEventListener("click", beginEditing)
    cell.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") beginEditing(event)
    })
  }

  private openCellInput(
    cell: HTMLTableCellElement,
    table: MarkdownTable,
    rowIndex: number,
    columnIndex: number,
    originalValue: string,
  ) {
    const contentStack = cell.querySelector<HTMLElement>(":scope > .cm-md-table-cell-stack")
    const display = contentStack?.querySelector<HTMLElement>(":scope > .cm-md-table-cell-display")
    if (!contentStack || !display) return
    const initialContentHeight = display.getBoundingClientRect().height
    const input = document.createElement("textarea")
    input.className = "cm-md-table-cell-input"
    input.value = originalValue
    input.rows = 1
    input.setAttribute("aria-label", cell.getAttribute("aria-label") ?? "编辑表格单元格")
    // 展示层继续留在网格中占位，输入层与其重叠；聚焦不会再替换 DOM 或触发表格重新布局。
    contentStack.appendChild(input)
    cell.classList.add("cm-md-table-cell-editing")
    const singleLineHeight = Number.parseFloat(window.getComputedStyle(display).lineHeight) || 24
    const stableHeight = Math.max(singleLineHeight, initialContentHeight)
    input.style.height = `${stableHeight}px`
    if (input.scrollHeight > stableHeight) input.style.overflowY = "auto"
    // 只有用户真正输入后才允许单元格按内容增长；单纯获得焦点不会改变表格几何尺寸。
    const resizeInput = () => {
      input.style.height = "0"
      const nextHeight = Math.max(singleLineHeight, initialContentHeight, input.scrollHeight)
      input.style.height = `${nextHeight}px`
      // 输入层绝对定位，不参与表格布局；只有内容真实增长时才同步扩大占位层。
      contentStack.style.minHeight = `${nextHeight}px`
      input.style.overflowY = "hidden"
    }
    input.addEventListener("input", resizeInput)
    // 单元格本身已经在视口内，禁止 focus 再次滚动页面，否则整张表会产生明显位移。
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)

    let finished = false
    const restoreCell = () => {
      input.remove()
      contentStack.style.removeProperty("min-height")
      cell.classList.remove("cm-md-table-cell-editing")
    }
    const commit = (navigation?: CellTarget & { appendRow?: boolean }) => {
      if (finished) return
      finished = true
      if (!navigation && input.value === originalValue) {
        restoreCell()
        return
      }
      const next = cloneMarkdownTable(table)
      if (rowIndex < 0) next.header[columnIndex] = input.value
      else next.rows[rowIndex][columnIndex] = input.value
      if (navigation?.appendRow) next.rows.push(Array(next.header.length).fill(""))
      this.replaceTable(next, navigation)
    }
    input.addEventListener("blur", () => commit(), { once: true })
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        finished = true
        restoreCell()
        cell.focus()
        return
      }
      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        const start = input.selectionStart ?? input.value.length
        const end = input.selectionEnd ?? start
        input.setRangeText("\n", start, end, "end")
        input.dispatchEvent(new Event("input", { bubbles: true }))
        return
      }
      if (event.key !== "Tab" && event.key !== "Enter") return
      event.preventDefault()
      commit(this.nextCellTarget(event, table, rowIndex, columnIndex))
    })
  }

  private nextCellTarget(
    event: KeyboardEvent,
    table: MarkdownTable,
    rowIndex: number,
    columnIndex: number,
  ): CellTarget & { appendRow?: boolean } {
    const visualRow = rowIndex + 1
    const lastColumn = table.header.length - 1
    const lastVisualRow = table.rows.length
    const next = { column: columnIndex, row: visualRow, appendRow: false }
    if (event.key === "Enter") {
      next.row = visualRow + 1
      next.appendRow = next.row > lastVisualRow
      return next
    }
    if (event.shiftKey) {
      next.column = columnIndex - 1
      if (next.column < 0) {
        next.column = lastColumn
        next.row = Math.max(0, visualRow - 1)
      }
      return next
    }
    next.column = columnIndex + 1
    if (next.column > lastColumn) {
      next.column = 0
      next.row = visualRow + 1
      next.appendRow = next.row > lastVisualRow
    }
    return next
  }

  ignoreEvent() {
    // 单元格输入完全由 Widget 接管，避免 CodeMirror 把点击重新映射到被替换的源码范围。
    return true
  }
}
