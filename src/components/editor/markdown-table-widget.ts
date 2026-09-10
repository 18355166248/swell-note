import { isolateHistory } from "@codemirror/commands"
import { EditorView, WidgetType } from "@codemirror/view"

import { writeClipboardText } from "@/services/clipboard/clipboard-text"

import { scrollElementIntoVisibleBand } from "./cursor-visibility"

import {
  alignTableColumn,
  appendTableColumn,
  appendTableRow,
  clampTableCellRange,
  clearTableCellRange,
  cloneMarkdownTable,
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
  tableColumnWidths,
  toggleTableCellRangeMark,
  type MarkdownTable,
  type TableAlignment,
  type TableCellRange,
} from "./markdown-table-model"
import { rawOffsetForDisplayOffset, renderTableInlineMarkdown, type TableInlineOptions } from "./markdown-table-inline"
import {
  loadTableColumnPreference,
  MIN_TABLE_COLUMN_WIDTH,
  resizeAdjacentColumnWidths,
  saveTableColumnPreference,
  tableColumnPercentages,
  type TableColumnPreference,
  type TableWidthMode,
} from "./markdown-table-width"

import { activeTableEdit, detectCellInlineMarks, inlineTableFormat, registerTableEdit } from "./table-edit-target"
import { registerTableWidgetApi, type TableWidgetApi, type TableWidgetMenuState } from "./table-widget-registry"

type TableVerticalMode = "bottom" | "middle" | "top"
// 聚焦目标：row 是 DOM tr 下标（0 = 表头）。
type CellTarget = { column: number; row: number }
// 选区坐标：row 与 data-row-index 一致（-1 = 表头，0 起为正文行）。
type CellPosition = { column: number; row: number }

type DragSession = {
  active: boolean
  anchor: CellPosition
  lastX: number
  lastY: number
  startX: number
  startY: number
}

// 矩形选区等交互状态不挂在 Widget 实例上：单元格提交、撤销都会重建 Widget，
// 状态按「编辑器 + 表格序号」存放，新实例从这里接管未完成的拖选和需要保留的选区。
type InteractionSession = {
  drag?: DragSession | null
  dragListeners?: (() => void) | null
  outsideListeners?: (() => void) | null
  // document 级监听由挂它的 Widget 实例持有：重建是先挂新实例再销毁旧实例，
  // 旧实例 destroy 若按会话盲卸，会把新实例刚挂好的监听一并卸掉。
  outsideListenersOwner?: TableWidget | null
  pendingPoint?: { x: number; y: number } | null
  pinnedRange?: TableCellRange | null
  range?: { anchor: CellPosition; focus: CellPosition } | null
  suppressClick?: boolean
  // 单个目标格（工具栏/右键菜单的操作对象）也随会话存续：语法树追平、同步合并等
  // 触发的重建会换掉 wrapper DOM，存在 dataset 里的目标会丢，重建时从这里恢复。
  target?: CellPosition | null
}

const TABLE_WIDTH_MODE_KEY = "swell-note:editor-table-width"
const TABLE_VERTICAL_MODE_KEY = "swell-note:editor-table-vertical-align"
const widthModeOrder: Array<Exclude<TableWidthMode, "manual">> = ["content", "full", "equal"]

// 触屏（主指针为 coarse）没有悬停，点按又会先触发 :hover/:focus-within：
// 若跟随选中自动展开工具条，展开推移单元格会让同一次点按的落点错位。
// 触屏因此只认显式展开（点按细条），选中单元格不再带开工具条。
function prefersExplicitTableToolbar() {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches
}
const sessionTableColumnPreferences = new WeakMap<EditorView, Map<number, TableColumnPreference>>()
const tableInteractionSessions = new WeakMap<EditorView, Map<number, InteractionSession>>()
// 右键菜单等外部入口可能拿到的是旧实例（提交触发重建后），经这张表找到当前存活的 Widget。
const liveTableWidgets = new WeakMap<EditorView, Map<number, TableWidget>>()

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

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// 复制选区时同时提供 HTML 表格：贴回单元格（pasteTableCells）和 Excel/Numbers 都能按原结构解析。
function tableRangeToHtml(table: MarkdownTable, range: TableCellRange) {
  const rows: string[] = []
  for (let row = range.rowFrom; row <= range.rowTo; row += 1) {
    const cells: string[] = []
    for (let column = range.columnFrom; column <= range.columnTo; column += 1) {
      cells.push(`<td>${escapeHtml(tableCellAt(table, row, column))}</td>`)
    }
    rows.push(`<tr>${cells.join("")}</tr>`)
  }
  return `<table>${rows.join("")}</table>`
}

// 计算 caretRangeFromPoint 命中的 DOM 位置在 root 纯文本里的偏移；root 之外的节点返回 null。
function textOffsetWithin(root: HTMLElement, container: Node, offset: number): number | null {
  if (!root.contains(container)) return null
  if (container === root) {
    let total = 0
    for (let index = 0; index < offset && index < root.childNodes.length; index += 1) {
      total += root.childNodes[index].textContent?.length ?? 0
    }
    return total
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let total = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === container) return total + offset
    total += node.textContent?.length ?? 0
  }
  return null
}

export class TableWidget extends WidgetType {
  readonly objectUrls = new Set<string>()
  readonly cleanupCallbacks = new Set<() => void>()
  private dragFrame = 0
  private floatingBar: HTMLElement | null = null
  private reportedFormatState = false

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

  // 交互状态按表格序号存续，Widget 重建（提交、撤销、同步合并）后新实例从这里恢复。
  private session(): InteractionSession {
    let sessions = tableInteractionSessions.get(this.view)
    if (!sessions) {
      sessions = new Map()
      tableInteractionSessions.set(this.view, sessions)
    }
    let session = sessions.get(this.tableIndex)
    if (!session) {
      session = {}
      sessions.set(this.tableIndex, session)
    }
    return session
  }

  // 外部入口（右键菜单）可能持有重建前的旧实例；操作一律转发给当前存活的实例。
  private liveWidget(): TableWidget {
    return liveTableWidgets.get(this.view)?.get(this.from) ?? this
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
    // 可聚焦但不进 Tab 序列：建立多格选区时焦点交给 wrapper，方向键扩展、复制、删除才有落点。
    wrapper.tabIndex = -1
    wrapper.dataset.tableFrom = String(this.from)
    wrapper.dataset.tableTo = String(this.to)
    if (!table) return wrapper

    const preference = this.loadColumnPreference(tableColumnWidths(table))
    const element = this.createTableElement(table, wrapper, preference.widths)
    const tableScroll = document.createElement("div")
    tableScroll.className = "cm-md-table-scroll"
    tableScroll.appendChild(element)
    wrapper.appendChild(tableScroll)
    applyTableWidthMode(wrapper, preference.mode, preference.widths)
    applyTableVerticalMode(wrapper, loadTableVerticalMode())
    this.trackHorizontalOverflow(wrapper, tableScroll)

    if (!this.view.state.readOnly) {
      wrapper.insertBefore(this.createToolbar(wrapper, table), tableScroll)
      applyTableWidthMode(wrapper, preference.mode, preference.widths)
      applyTableVerticalMode(wrapper, loadTableVerticalMode())
      this.attachTableInteraction(wrapper, table)
      let live = liveTableWidgets.get(this.view)
      if (!live) {
        live = new Map()
        liveTableWidgets.set(this.view, live)
      }
      live.set(this.from, this)
      this.cleanupCallbacks.add(registerTableWidgetApi(wrapper, this.createMenuApi()))
    }
    return wrapper
  }

  destroy() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url)
    this.objectUrls.clear()
    if (this.reportedFormatState) {
      this.reportedFormatState = false
      this.options.onTableFormatState?.(null)
    }
    if (this.dragFrame) {
      cancelAnimationFrame(this.dragFrame)
      this.dragFrame = 0
    }
    const live = liveTableWidgets.get(this.view)
    if (live?.get(this.from) === this) live.delete(this.from)
    this.hideFloatingBar()
    // 只释放自己挂的监听：重建后 document 级监听可能已由新实例接管。
    if (this.session().outsideListenersOwner === this) this.releaseRangeDocumentListeners()
    this.releaseDragListeners()
    for (const cleanup of this.cleanupCallbacks) cleanup()
    this.cleanupCallbacks.clear()
  }

  private createTableElement(table: MarkdownTable, wrapper: HTMLElement, configuredWidths: number[]) {
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
    wrapper: HTMLElement,
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

  // 插入/删除列后改写列宽偏好：新列沿用相邻列宽，删除列移除对应宽度，
  // 重建后的新 Widget 才能按同一组宽度渲染，而不是整表回到内容推导宽度。
  private adjustColumnPreference(wrapper: HTMLElement, mutate: (widths: number[]) => number[]) {
    const widths = (wrapper.dataset.columnWidths ?? "")
      .split(",")
      .map(Number)
      .filter((width) => Number.isFinite(width) && width > 0)
    if (widths.length === 0) return
    const mode = (wrapper.dataset.widthMode ?? "content") as TableWidthMode
    this.saveColumnPreference({ mode, widths: mutate(widths) })
  }

  private addColumnResizeHandles(headRow: HTMLTableRowElement, wrapper: HTMLElement) {
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

  // 列多的表格在编辑态会被容器直接切掉右边，看不出后面还有内容。阅读态本来就有边缘渐隐提示，
  // 这里补上同一套：溢出时两侧按滚动位置显示渐隐，滚到头就收起对应那侧。
  private trackHorizontalOverflow(wrapper: HTMLElement, scroller: HTMLDivElement) {
    const update = () => {
      const overflowing = scroller.scrollWidth - scroller.clientWidth > 2
      wrapper.dataset.overflow = String(overflowing)
      wrapper.dataset.atStart = String(!overflowing || scroller.scrollLeft <= 2)
      wrapper.dataset.atEnd = String(!overflowing || scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2)
    }
    update()
    scroller.addEventListener("scroll", update, { passive: true })
    // 字号、窗口宽度与列宽都可能在首帧之后变化，持续测量才不会显示错误的提示。
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    observer?.observe(scroller)
    const table = scroller.querySelector("table")
    if (table) observer?.observe(table)
    this.cleanupCallbacks.add(() => {
      scroller.removeEventListener("scroll", update)
      observer?.disconnect()
    })
  }

  private createToolbar(wrapper: HTMLElement, table: MarkdownTable) {
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
        this.createInsertButton("上方插入行", "insert-row-above", "先选择正文单元格", () => this.opInsertRow("above")),
        this.createInsertButton("下方插入行", "insert-row-below", "先选择单元格", () => this.opInsertRow("below")),
        this.createInsertButton("左侧插入列", "insert-column-left", "先选择单元格", () => this.opInsertColumn("left")),
        this.createInsertButton("右侧插入列", "insert-column-right", "先选择单元格", () => this.opInsertColumn("right")),
        this.createMutationButton("添加行", wrapper, () => appendTableRow(table)),
        this.createMutationButton("添加列", wrapper, () => appendTableColumn(table)),
        this.createDeleteButton("删除行", "row"),
        this.createDeleteButton("删除列", "column"),
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
    // 工具条默认收起为细条（悬停/聚焦/选中时经 CSS 展开）。触屏没有悬停，
    // 点击细条本身视为展开请求；点到里面的按钮或菜单则不算。
    toolbar.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button, summary")) return
      wrapper.dataset.tableActive = "true"
    })
    const clearActiveOnOutsidePress = (event: PointerEvent) => {
      if (!wrapper.contains(event.target as Node)) delete wrapper.dataset.tableActive
    }
    document.addEventListener("pointerdown", clearActiveOnOutsidePress)
    this.cleanupCallbacks.add(() => document.removeEventListener("pointerdown", clearActiveOnOutsidePress))
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
    const supportsPopover = typeof panel.showPopover === "function"
    if (supportsPopover) panel.setAttribute("popover", "manual")
    else panel.style.display = "none"
    panel.append(...buttons)
    panel.addEventListener("click", (event) => {
      if (event.target instanceof HTMLButtonElement && !event.target.disabled) menu.open = false
    })
    const position = () => {
      if (!menu.open) return
      const rect = trigger.getBoundingClientRect()
      const viewport = window.visualViewport
      const bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0)
      const width = panel.offsetWidth || 140
      const height = panel.offsetHeight || 190
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
      panel.style.top = `${Math.max(8, rect.bottom + height + 8 < bottom ? rect.bottom + 5 : rect.top - height - 5)}px`
    }
    menu.addEventListener("toggle", () => {
      if (!supportsPopover) {
        panel.style.display = menu.open ? "grid" : "none"
        if (menu.open) document.body.append(panel)
        else menu.append(panel)
      }
      if (!menu.open) { if ((typeof panel.showPopover === "function" && panel.matches(":popover-open"))) panel.hidePopover(); return }
      // 原生 top layer 可越过所有滚动祖先的裁切；定位按可视视口计算，软键盘升起后同样可用。
      if (panel.showPopover && !(typeof panel.showPopover === "function" && panel.matches(":popover-open"))) panel.showPopover()
      position()
      for (const sibling of menu.parentElement?.querySelectorAll<HTMLDetailsElement>(".cm-md-table-menu[open]") ?? []) {
        if (sibling !== menu) sibling.open = false
      }
    })
    const closeOnOutside = (event: PointerEvent) => {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target) && !panel.contains(event.target)) menu.open = false
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.open && !event.isComposing) { event.preventDefault(); event.stopPropagation(); menu.open = false; trigger.focus() }
    }
    document.addEventListener("keydown", closeOnEscape, true)
    window.addEventListener("scroll", position, true)
    window.addEventListener("resize", position)
    this.cleanupCallbacks.add(() => {
      document.removeEventListener("keydown", closeOnEscape, true)
      if (!supportsPopover) panel.remove()
      window.removeEventListener("scroll", position, true)
      window.removeEventListener("resize", position)
      if ((typeof panel.showPopover === "function" && panel.matches(":popover-open"))) panel.hidePopover()
    })
    document.addEventListener("pointerdown", closeOnOutside)
    this.cleanupCallbacks.add(() => document.removeEventListener("pointerdown", closeOnOutside))
    menu.append(trigger, panel)
    return menu
  }

  private createWidthButton(wrapper: HTMLElement, table: MarkdownTable) {
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

  private createMutationButton(label: string, wrapper: HTMLElement, update: () => MarkdownTable) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.dataset.tableAction = label === "添加行" ? "add-row" : "add-column"
    button.title = label
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      // 追加行/列不挪动既有单元格坐标，选区 pin 住跨重建保留并重新绘制；
      // 否则重建后高亮消失、隐藏选区却仍在响应清空/复制。
      const range = this.normalizedSessionRange()
      if (range) this.session().pinnedRange = range
      this.replaceTable(this.mergeActiveEdit(wrapper, update()))
    })
    return button
  }

  // 在指定位置插入行/列；初始禁用，选中单元格后由 selectCell 放开。
  private createInsertButton(label: string, action: string, disabledTitle: string, run: () => void) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.dataset.tableAction = action
    button.disabled = true
    button.title = disabledTitle
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      run()
    })
    return button
  }

  private createDeleteButton(label: string, kind: "column" | "row") {
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
      // 删除对矩形选区和单个目标格都生效，由操作内部判断。
      if (kind === "row") this.opDeleteRows()
      else this.opDeleteColumns()
    })
    return button
  }

  private createAlignButton(
    label: string,
    align: TableAlignment,
    wrapper: HTMLElement,
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
      const session = this.session()
      const range = session.range ? normalizeTableCellRange(session.range.anchor, session.range.focus) : null
      let next = this.tableWithActiveEdit(wrapper, table)
      if (range) {
        // 矩形选区：覆盖到的每一列都设为同一对齐，选区在操作后保留。
        for (let column = range.columnFrom; column <= range.columnTo; column += 1) {
          next = alignTableColumn(next, column, align) ?? next
        }
        session.pinnedRange = range
        this.replaceTable(next)
        return
      }
      const rowIndex = Number(wrapper.dataset.selectedRow)
      const columnIndex = Number(wrapper.dataset.selectedColumn)
      const aligned = alignTableColumn(next, columnIndex, align)
      if (!aligned) return
      this.replaceTable(aligned, { column: columnIndex, row: rowIndex < 0 ? 0 : rowIndex + 1 })
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

  private mergeActiveEdit(wrapper: HTMLElement, table: MarkdownTable) {
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

  private tableWithActiveEdit(wrapper: HTMLElement, table: MarkdownTable) {
    return this.mergeActiveEdit(wrapper, table)
  }

  private selectCell(
    wrapper: HTMLElement,
    table: MarkdownTable,
    rowIndex: number,
    columnIndex: number,
  ) {
    // 单个目标格只驱动工具栏操作，不添加边框或背景，避免表格在展示态和编辑态之间产生视觉抖动。
    wrapper.dataset.selectedRow = String(rowIndex)
    wrapper.dataset.selectedColumn = String(columnIndex)
    // 精确指针下选中期间保持工具条展开，鼠标移出表格也不收回去。
    // 触屏不跟随选中展开：展开会推移下方单元格，与键盘弹出叠加时点按落点会错，
    // 触屏改为点按细条显式展开（createToolbar 里的 click 监听同样置这个标记）。
    if (!prefersExplicitTableToolbar()) wrapper.dataset.tableActive = "true"
    this.session().target = { column: columnIndex, row: rowIndex }
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
    const insertRowAbove = wrapper.querySelector<HTMLButtonElement>('[data-table-action="insert-row-above"]')
    if (insertRowAbove) {
      // GFM 表头固定为首行，表头上方没有「行」的概念。
      insertRowAbove.disabled = rowIndex < 0
      insertRowAbove.title = rowIndex < 0 ? "表头上方不能插入行（Markdown 表格的表头固定为首行）" : `在第 ${rowIndex + 1} 行上方插入一行`
    }
    for (const [action, title] of [
      ["insert-row-below", rowIndex < 0 ? "在表头下方插入一行" : `在第 ${rowIndex + 1} 行下方插入一行`],
      ["insert-column-left", `在第 ${columnIndex + 1} 列左侧插入一列`],
      ["insert-column-right", `在第 ${columnIndex + 1} 列右侧插入一列`],
    ] as const) {
      const button = wrapper.querySelector<HTMLButtonElement>(`[data-table-action="${action}"]`)
      if (button) {
        button.disabled = false
        button.title = title
      }
    }
    for (const button of wrapper.querySelectorAll<HTMLButtonElement>('[data-table-action="align"]')) {
      button.disabled = false
    }
  }

  private replaceTable(table: MarkdownTable, focus?: CellTarget) {
    // 同步或撤销可能在交互期间替换正文；写回前核验原始范围，避免旧 Widget 覆盖新表格。
    if (this.view.state.sliceDoc(this.from, this.to) !== this.source) return false
    // 内容没变（切单元格时提交了未改动的输入等）：不能派发事务——与原文相同的替换
    // 会进撤销历史并扰乱后续撤销的位置映射（撤销一步看起来像失效/内容错乱）。
    // 但残留的输入框必须收掉，否则旧 textarea 一直挂在格子里。
    if (serializeMarkdownTable(table) === this.source) {
      activeTableEdit(this.view)?.cancel()
      if (focus) this.focusCellAfterUpdate(focus)
      return true
    }
    this.view.dispatch({ changes: { from: this.from, to: this.to, insert: serializeMarkdownTable(table) }, userEvent: "input.table", annotations: isolateHistory.of("full") })
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
    wrapper: HTMLElement,
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
      const session = this.session()
      if (session.suppressClick) {
        // 拖选或 Shift 扩展刚结束，紧随的 click 不能进入编辑把选区清掉。
        session.suppressClick = false
        return
      }
      // Shift+点击是扩展选区的手势，由 mousedown 处理，这里不再进入编辑。
      if (event instanceof MouseEvent && event.shiftKey) return
      this.clearCellRange(wrapper)
      this.selectCell(wrapper, table, rowIndex, columnIndex)
      const activeInput = wrapper.querySelector<HTMLTextAreaElement>(".cm-md-table-cell-input")
      if (activeInput && !cell.contains(activeInput)) {
        // 切换单元格时先写回旧输入，再在重绘后的目标格继续编辑，避免残留多个输入框。
        // 点击坐标随会话带给重建后的新实例，光标仍按原点击位置落点。
        if (event instanceof MouseEvent && (event.clientX || event.clientY)) {
          session.pendingPoint = { x: event.clientX, y: event.clientY }
        }
        this.replaceTable(this.tableWithActiveEdit(wrapper, table), { column: columnIndex, row: rowIndex + 1 })
        return
      }
      if (cell.querySelector("textarea")) return
      const storedPoint = session.pendingPoint
      session.pendingPoint = null
      const point = event instanceof MouseEvent && (event.clientX || event.clientY)
        ? { x: event.clientX, y: event.clientY }
        : storedPoint ?? undefined
      this.openCellInput(cell, table, rowIndex, columnIndex, originalValue, point)
    }
    cell.addEventListener("click", beginEditing)
    cell.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") beginEditing(event)
    })
  }

  // 把点击的屏幕坐标换算成 textarea 里的字符偏移：先在展示层按排版命中文字位置，
  // 再沿行内语法映射回原始 Markdown 偏移（**加粗** 这类被渲染吃掉的标记不会把光标顶偏）。
  private caretIndexFromPoint(display: HTMLElement, value: string, point: { x: number; y: number }) {
    if (!value) return 0
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offset: number; offsetNode: Node } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    try {
      let container: Node | null = null
      let offset = 0
      if (typeof doc.caretRangeFromPoint === "function") {
        const range = doc.caretRangeFromPoint(point.x, point.y)
        container = range?.startContainer ?? null
        offset = range?.startOffset ?? 0
      } else if (typeof doc.caretPositionFromPoint === "function") {
        const position = doc.caretPositionFromPoint(point.x, point.y)
        container = position?.offsetNode ?? null
        offset = position?.offset ?? 0
      }
      if (!container || !display.contains(container)) return value.length
      const shown = textOffsetWithin(display, container, offset)
      if (shown === null) return value.length
      return rawOffsetForDisplayOffset(value, shown)
    } catch {
      // jsdom 等无布局环境没有 caret API，退回原行为（光标置于末尾）。
      return value.length
    }
  }

  private openCellInput(
    cell: HTMLTableCellElement,
    table: MarkdownTable,
    rowIndex: number,
    columnIndex: number,
    originalValue: string,
    point?: { x: number; y: number },
  ) {
    const contentStack = cell.querySelector<HTMLElement>(":scope > .cm-md-table-cell-stack")
    const display = contentStack?.querySelector<HTMLElement>(":scope > .cm-md-table-cell-display")
    if (!contentStack || !display) return
    // 光标定位必须在输入层盖上去之前完成：textarea 与展示层重叠后会截获坐标命中，
    // caretRangeFromPoint 打不到展示层的文字，光标只能退回末尾。
    const caret = point ? this.caretIndexFromPoint(display, originalValue, point) : originalValue.length
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
    // 鼠标点入时按点击的文字位置定位（中文、英文、换行、空单元格都覆盖）；不全选，
    // 双击选词和方向键导航仍是 textarea 原生行为。键盘（Enter/空格）进入没有坐标，保持末尾续写。
    input.setSelectionRange(caret, caret)

    // 工具栏格式高亮：进入编辑与选区变化时汇报当前单元格的行内格式。
    const reportFormat = () => {
      this.reportedFormatState = true
      this.options.onTableFormatState?.(detectCellInlineMarks(input.value, input.selectionStart, input.selectionEnd))
    }
    reportFormat()
    for (const type of ["input", "keyup", "mouseup", "select"] as const) {
      input.addEventListener(type, reportFormat)
    }

    let finished = false
    let unregister = () => {}
    let detachKeyboardFollow = () => {}
    const restoreCell = () => {
      unregister()
      detachKeyboardFollow()
      input.remove()
      if (this.reportedFormatState) {
        this.reportedFormatState = false
        this.options.onTableFormatState?.(null)
      }
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
      // 内容未变时 replaceTable 不再派发事务（空替换会污染撤销历史），只负责收尾；
      // 这里必须显式收起输入框，否则残留的 textarea 会一直挂在格子里，
      // 把下一次点击的合并目标搞错，最终连续 Tab 时输入焦点会跌回 body。
      restoreCell()
      const next = cloneMarkdownTable(table)
      if (rowIndex < 0) next.header[columnIndex] = input.value
      else next.rows[rowIndex][columnIndex] = input.value
      if (navigation?.appendRow) next.rows.push(Array(next.header.length).fill(""))
      this.replaceTable(next, navigation)
    }
    unregister = registerTableEdit(this.view, {
      input,
      commit: () => commit(),
      cancel: () => { finished = true; restoreCell() },
      format: (template) => {
        const change = inlineTableFormat(template, input.value, input.selectionStart, input.selectionEnd)
        if (!change) return
        input.setRangeText(change.text, change.from, change.to, "select")
        commit({ row: rowIndex + 1, column: columnIndex })
      },
      replace: (from, to, text) => {
        input.setRangeText(text, from, to, "select")
        commit({ row: rowIndex + 1, column: columnIndex })
      },
    })
    // 键盘弹起会压掉下半屏：焦点在单元格 textarea 上时 CodeMirror 已失焦，
    // 编辑器自己的光标跟随不会触发，由这里把正在编辑的单元格送回可视带。
    // 键盘动画期间 resize 连续触发，合并到同一帧再量，避免来回滚动。
    let followFrame = 0
    const scheduleKeyboardFollow = () => {
      if (followFrame) return
      followFrame = requestAnimationFrame(() => {
        followFrame = 0
        if (finished || document.activeElement !== input) return
        scrollElementIntoVisibleBand(input)
      })
    }
    scheduleKeyboardFollow()
    window.visualViewport?.addEventListener("resize", scheduleKeyboardFollow)
    detachKeyboardFollow = () => {
      if (followFrame) cancelAnimationFrame(followFrame)
      followFrame = 0
      window.visualViewport?.removeEventListener("resize", scheduleKeyboardFollow)
    }
    input.addEventListener("paste", (event) => {
      const transfer = event.clipboardData
      if (!transfer) return
      const html = transfer.getData("text/html")
      // 只读取表格文本，不把剪贴板 HTML 的事件、样式或脚本带入笔记。
      const parsed = html ? new DOMParser().parseFromString(html, "text/html").querySelector("table") : null
      const cells = parsed ? Array.from(parsed.rows, (row) => Array.from(row.cells, (cell) => cell.textContent ?? ""))
        : parseTabularText(transfer.getData("text/plain"))
      if (!cells?.length || cells.every((row) => row.length === 0)) return
      event.preventDefault()
      event.stopPropagation()
      finished = true
      restoreCell()
      this.replaceTable(pasteTableCells(table, rowIndex + 1, columnIndex, cells), { row: rowIndex + 1, column: columnIndex })
    })
    input.addEventListener("blur", () => {
      // 自定义菜单暂时接过焦点，输入框和选区仍属于当前单元格；菜单关闭后再恢复或提交。
      if (input.dataset.contextMenuActive !== "true") commit()
    })
    input.addEventListener("keydown", (event) => {
      // 候选词确认不能被当作单元格提交或下移。
      if (event.isComposing || event.keyCode === 229) return
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const templates: Record<string, string> = { b: "**加粗文字**", i: "*斜体文字*", k: "[链接](https://)" }
        const template = templates[event.key.toLowerCase()]
        if (template) {
          event.preventDefault()
          event.stopPropagation()
          activeTableEdit(this.view)?.format(template)
          return
        }
      }
      if (event.key === "Escape") {
        finished = true
        restoreCell()
        cell.focus()
        this.view.dispatch({ selection: { anchor: this.to } })
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

  // ---------------------------------------------------------------------------
  // 矩形选区：拖选 / Shift 扩展 / 批量操作 / 就近浮层
  // ---------------------------------------------------------------------------

  private attachTableInteraction(wrapper: HTMLElement, table: MarkdownTable) {
    const mouseDown = (event: MouseEvent) => this.onTableMouseDown(wrapper, table, event)
    const keyDown = (event: KeyboardEvent) => this.onWrapperKeyDown(wrapper, table, event)
    wrapper.addEventListener("mousedown", mouseDown)
    wrapper.addEventListener("keydown", keyDown)
    this.cleanupCallbacks.add(() => {
      wrapper.removeEventListener("mousedown", mouseDown)
      wrapper.removeEventListener("keydown", keyDown)
    })
    const session = this.session()
    // 拖选途中发生的重建（例如开始拖选时写回了上一个单元格的输入）由新实例接管。
    if (session.drag) this.attachDragListeners(wrapper, table)
    // 清空、批量格式、对齐等操作要求选区跨重建保留：裁剪到新尺寸后重新绘制并恢复浮层。
    if (session.pinnedRange) {
      const range = clampTableCellRange(table, session.pinnedRange)
      session.pinnedRange = null
      if (range) {
        session.range = {
          anchor: { column: range.columnFrom, row: range.rowFrom },
          focus: { column: range.columnTo, row: range.rowTo },
        }
        this.paintCellRange(wrapper, range)
        this.selectCell(wrapper, table, range.rowTo, range.columnTo)
        this.updateFloatingBar(wrapper, table, range)
        this.ensureRangeDocumentListeners(wrapper, table)
        // 提交触发的重建会把焦点丢到 body，选区恢复时一并收回键盘落点；
        // toDOM 阶段 wrapper 还未挂载，延到挂载后再聚焦。
        window.setTimeout(() => {
          if (wrapper.isConnected && this.session().range) wrapper.focus({ preventScroll: true })
        }, 0)
      }
    } else {
      // 未 pin 的选区不跨重建保留：高亮依附的旧 DOM 已销毁，留着隐藏选区只会让
      // 后续清空/复制继续作用在看不见的范围上（视觉范围与操作范围必须一致）。
      session.range = null
      if (session.target) {
        // 无选区时恢复单个目标格：越界（结构已被删掉一部分）则丢弃。
        const { column, row } = session.target
        const valid = column >= 0 && column < table.header.length && row >= -1 && row < table.rows.length
        if (valid) this.selectCell(wrapper, table, row, column)
        else session.target = null
      }
    }
  }

  private normalizedSessionRange() {
    const range = this.session().range
    return range ? normalizeTableCellRange(range.anchor, range.focus) : null
  }

  private setCellRange(wrapper: HTMLElement, table: MarkdownTable, anchor: CellPosition, focus: CellPosition) {
    const clampPosition = (position: CellPosition): CellPosition => ({
      column: Math.max(0, Math.min(table.header.length - 1, position.column)),
      row: Math.max(-1, Math.min(table.rows.length - 1, position.row)),
    })
    const session = this.session()
    session.range = { anchor: clampPosition(anchor), focus: clampPosition(focus) }
    const range = normalizeTableCellRange(session.range.anchor, session.range.focus)
    this.paintCellRange(wrapper, range)
    this.selectCell(wrapper, table, session.range.focus.row, session.range.focus.column)
    const cells = (range.rowTo - range.rowFrom + 1) * (range.columnTo - range.columnFrom + 1)
    if (cells > 1) {
      const selectionStatus = wrapper.querySelector<HTMLElement>(".cm-md-table-selection-status")
      if (selectionStatus) selectionStatus.textContent = `已选 ${range.rowTo - range.rowFrom + 1} 行 × ${range.columnTo - range.columnFrom + 1} 列`
      // 多格选区接管键盘：先把编辑中的单元格写回（内容没变则只收起输入框），否则焦点留在
      // textarea 里，复制/删除/方向键仍作用于单元格文字而不是整个选区。
      const editing = activeTableEdit(this.view)
      if (editing && wrapper.contains(editing.input)) {
        if (serializeMarkdownTable(this.tableWithActiveEdit(wrapper, table)) !== this.source) {
          // 写回会重建表格：pin 住选区，由新实例恢复高亮、浮层与键盘监听。
          session.pinnedRange = range
          editing.commit()
          return
        }
        editing.commit()
      }
      // 焦点明确交给 wrapper：焦点落在 body 时 Shift+方向键无法扩展选区，
      // 留在正文 CodeMirror 时复制的是正文而不是表格选区。
      wrapper.focus({ preventScroll: true })
    }
    this.updateFloatingBar(wrapper, table, range)
    this.ensureRangeDocumentListeners(wrapper, table)
  }

  private clearCellRange(wrapper: HTMLElement) {
    const session = this.session()
    if (!session.range) return
    session.range = null
    this.paintCellRange(wrapper, null)
    this.hideFloatingBar()
    this.releaseRangeDocumentListeners()
  }

  // 只更新选中样式，差量增删 class，长表格拖选也不会每帧全量改写。
  private paintCellRange(wrapper: HTMLElement, range: TableCellRange | null) {
    const painted = Array.from(wrapper.querySelectorAll<HTMLElement>(".cm-md-table-cell-in-range"))
    if (!range) {
      for (const cell of painted) cell.classList.remove("cm-md-table-cell-in-range")
      delete wrapper.dataset.rangeActive
      return
    }
    wrapper.dataset.rangeActive = "true"
    const keep = new Set<HTMLElement>()
    const rows = Array.from(wrapper.querySelectorAll<HTMLTableRowElement>(".cm-md-table tr"))
    for (let row = range.rowFrom; row <= range.rowTo; row += 1) {
      const tr = rows[row + 1]
      if (!tr) continue
      for (let column = range.columnFrom; column <= range.columnTo; column += 1) {
        const cell = tr.children[column]
        if (cell instanceof HTMLElement) {
          keep.add(cell)
          cell.classList.add("cm-md-table-cell-in-range")
        }
      }
    }
    for (const cell of painted) {
      if (!keep.has(cell)) cell.classList.remove("cm-md-table-cell-in-range")
    }
  }

  private onTableMouseDown(wrapper: HTMLElement, table: MarkdownTable, event: MouseEvent) {
    if (event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    const cell = target?.closest<HTMLElement>("th, td")
    if (!cell || !wrapper.contains(cell)) return
    // 编辑中的 textarea 保持原生文字选择；列宽手柄有自己的拖拽。
    if (target?.closest(".cm-md-table-cell-input")) return
    if (target?.closest(".cm-md-table-resize-handle")) return
    // 阻止默认的文字选择与焦点转移：拖选由这里接管，点击进入编辑仍走 click 事件，
    // 未提交的输入也不会因为 mousedown 抢焦点而提前提交。
    event.preventDefault()
    const position: CellPosition = { column: Number(cell.dataset.columnIndex), row: Number(cell.dataset.rowIndex) }
    if (!Number.isInteger(position.row) || !Number.isInteger(position.column)) return
    const session = this.session()
    if (event.shiftKey) {
      // Shift+点击：从锚点（已有选区或当前目标格）扩展到落点。
      const anchor = session.range?.anchor ?? this.targetCell(wrapper) ?? position
      this.setCellRange(wrapper, table, anchor, position)
      session.suppressClick = true
      return
    }
    session.drag = { active: false, anchor: position, lastX: event.clientX, lastY: event.clientY, startX: event.clientX, startY: event.clientY }
    this.attachDragListeners(wrapper, table)
  }

  private attachDragListeners(wrapper: HTMLElement, table: MarkdownTable) {
    this.releaseDragListeners()
    const move = (event: MouseEvent) => this.onDragMove(wrapper, table, event)
    const up = (event: MouseEvent) => this.onDragUp(wrapper, table, event)
    document.addEventListener("mousemove", move)
    document.addEventListener("mouseup", up)
    const dispose = () => {
      document.removeEventListener("mousemove", move)
      document.removeEventListener("mouseup", up)
    }
    this.session().dragListeners = dispose
  }

  private releaseDragListeners() {
    const session = this.session()
    const dispose = session.dragListeners
    session.dragListeners = null
    dispose?.()
  }

  private onDragMove(wrapper: HTMLElement, table: MarkdownTable, event: MouseEvent) {
    const session = this.session()
    const drag = session.drag
    if (!drag) return
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    if (!drag.active) {
      // 阈值之内仍按单击处理，不影响点击进编辑和双击选词。
      if (Math.hypot(drag.lastX - drag.startX, drag.lastY - drag.startY) < 5) return
      drag.active = true
      window.getSelection()?.removeAllRanges()
      wrapper.dataset.rangeSelecting = "true"
      this.clearFloatingBarOnly()
    }
    event.preventDefault()
    this.scheduleDragFrame(wrapper, table)
  }

  // 拖选期间用 rAF 循环驱动绘制与自动滚动：指针停在边缘不动时也能持续滚动。
  private scheduleDragFrame(wrapper: HTMLElement, table: MarkdownTable) {
    if (this.dragFrame) return
    this.dragFrame = requestAnimationFrame(() => {
      this.dragFrame = 0
      const session = this.session()
      const drag = session.drag
      if (!drag?.active) return
      this.autoScrollDuringDrag(wrapper, drag.lastX, drag.lastY)
      const cell = this.cellFromPoint(wrapper, drag.lastX, drag.lastY)
      if (cell) this.setCellRange(wrapper, table, drag.anchor, cell)
      if (this.session().drag?.active) this.scheduleDragFrame(wrapper, table)
    })
  }

  private autoScrollDuringDrag(wrapper: HTMLElement, x: number, y: number) {
    const EDGE = 40
    const MAX_STEP = 18
    const viewport = wrapper.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (viewport) {
      const rect = viewport.getBoundingClientRect()
      if (y < rect.top + EDGE) viewport.scrollTop -= Math.min(MAX_STEP, (rect.top + EDGE - y) / 2)
      else if (y > rect.bottom - EDGE) viewport.scrollTop += Math.min(MAX_STEP, (y - (rect.bottom - EDGE)) / 2)
    }
    const scroller = wrapper.querySelector<HTMLElement>(".cm-md-table-scroll")
    if (scroller) {
      const rect = scroller.getBoundingClientRect()
      if (x < rect.left + EDGE) scroller.scrollLeft -= Math.min(MAX_STEP, (rect.left + EDGE - x) / 2)
      else if (x > rect.right - EDGE) scroller.scrollLeft += Math.min(MAX_STEP, (x - (rect.right - EDGE)) / 2)
    }
  }

  private cellFromPoint(wrapper: HTMLElement, x: number, y: number): CellPosition | null {
    const element = document.elementFromPoint(x, y)
    const cell = element?.closest<HTMLElement>("th, td")
    if (!cell || !wrapper.contains(cell)) return null
    const row = Number(cell.dataset.rowIndex)
    const column = Number(cell.dataset.columnIndex)
    return Number.isInteger(row) && Number.isInteger(column) ? { column, row } : null
  }

  private onDragUp(wrapper: HTMLElement, table: MarkdownTable, _event: MouseEvent) {
    const session = this.session()
    const drag = session.drag
    session.drag = null
    this.releaseDragListeners()
    delete wrapper.dataset.rangeSelecting
    if (this.dragFrame) {
      cancelAnimationFrame(this.dragFrame)
      this.dragFrame = 0
    }
    if (!drag?.active) return
    // 拖选落定：紧随的 click 必须吞掉，否则又会进入编辑并清掉选区。
    session.suppressClick = true
    const cell = this.cellFromPoint(wrapper, drag.lastX, drag.lastY)
    if (cell) this.setCellRange(wrapper, table, drag.anchor, cell)
    else this.updateFloatingBar(wrapper, table, this.normalizedSessionRange())
  }

  private onWrapperKeyDown(wrapper: HTMLElement, table: MarkdownTable, event: KeyboardEvent) {
    const target = event.target instanceof HTMLElement ? event.target : null
    // 单元格输入框的按键（含 Escape 取消编辑）由输入框自己处理。
    if (target?.closest(".cm-md-table-cell-input")) return
    if (event.isComposing || event.keyCode === 229) return
    const session = this.session()
    if (!session.range) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      this.clearCellRange(wrapper)
      return
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      event.stopPropagation()
      this.opClearContents()
      return
    }
    const delta: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0] }
    const [dRow, dColumn] = delta[event.key] ?? []
    if (event.shiftKey && dRow !== undefined && dColumn !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      const focus = session.range.focus
      this.setCellRange(wrapper, table, session.range.anchor, { column: focus.column + dColumn, row: focus.row + dRow })
    }
  }

  // 选区存在期间挂 document 级监听：点击表格外清除选区、Escape/Delete 键盘操作、
  // 复制/剪切导出 TSV。焦点可能落在 wrapper 之外（拖选后焦点不动），单靠 wrapper 监听不够。
  private ensureRangeDocumentListeners(wrapper: HTMLElement, table: MarkdownTable) {
    const session = this.session()
    if (session.outsideListeners) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (target && (wrapper.contains(target) || this.floatingBar?.contains(target))) return
      // 右键菜单面板在 Portal 里，不属于 wrapper；菜单打开时保留选区。
      if (target instanceof Element && target.closest('[data-slot="context-menu-content"]')) return
      this.clearCellRange(wrapper)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      const current = this.session()
      if (!current.range) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (event.key === "Escape") {
        // 右键菜单打开时让位给菜单自己的 Escape。
        if (document.querySelector('[data-slot="context-menu-content"]')) return
        event.preventDefault()
        event.stopPropagation()
        this.clearCellRange(wrapper)
        return
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        // 其他输入框（搜索、标题等）里的删除键不受表格选区影响；
        // wrapper 虽在 CodeMirror 的 contenteditable 内部，但选区持焦时删除应作用于选区。
        if (target?.closest(".cm-md-table-cell-input")) return
        if (!wrapper.contains(target) && target?.closest("input, textarea, [contenteditable]")) return
        event.preventDefault()
        this.opClearContents()
      }
    }
    const onClipboard = (event: ClipboardEvent) => {
      const current = this.session()
      if (!current.range || !event.clipboardData) return
      const target = event.target instanceof HTMLElement ? event.target : null
      // 单元格输入框、其他输入控件内的复制/剪切保持原生行为；
      // wrapper 虽在 CodeMirror 的 contenteditable 内部，但选区持焦时剪贴板归选区。
      if (target?.closest(".cm-md-table-cell-input")) return
      if (!wrapper.contains(target) && target?.closest("input, textarea, [contenteditable]")) return
      // 正文 CodeMirror 持有焦点且有文字选区时，正文优先。
      if (this.view.hasFocus && !this.view.state.selection.main.empty) return
      const range = normalizeTableCellRange(current.range.anchor, current.range.focus)
      const model = this.tableWithActiveEdit(wrapper, table)
      event.preventDefault()
      event.clipboardData.setData("text/plain", tableCellRangeToTsv(model, range))
      event.clipboardData.setData("text/html", tableRangeToHtml(model, range))
      if (event.type === "cut") this.opClearContents()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("copy", onClipboard)
    document.addEventListener("cut", onClipboard)
    const dispose = () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("copy", onClipboard)
      document.removeEventListener("cut", onClipboard)
    }
    session.outsideListeners = dispose
    session.outsideListenersOwner = this
  }

  private releaseRangeDocumentListeners() {
    const session = this.session()
    const dispose = session.outsideListeners
    session.outsideListeners = null
    session.outsideListenersOwner = null
    dispose?.()
  }

  // ---------------------------------------------------------------------------
  // 选区操作（工具栏按钮、浮层、右键菜单共用；一律作用于当前存活的 DOM 与文档）
  // ---------------------------------------------------------------------------

  private currentDom(): { table: MarkdownTable; wrapper: HTMLElement } | null {
    const table = parseMarkdownTable(this.source)
    if (!table) return null
    const wrapper = Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-wrap"))
      .find((candidate) => Number(candidate.dataset.tableFrom) === this.from && candidate.isConnected)
    return wrapper ? { table, wrapper } : null
  }

  private targetCell(wrapper: HTMLElement): CellPosition | null {
    const row = Number(wrapper.dataset.selectedRow)
    const column = Number(wrapper.dataset.selectedColumn)
    return Number.isInteger(row) && Number.isInteger(column) ? { column, row } : null
  }

  opInsertRow(position: "above" | "below") {
    const dom = this.currentDom()
    if (!dom) return
    const range = this.normalizedSessionRange()
    const target = this.targetCell(dom.wrapper)
    if (!range && !target) return
    let rowIndex: number
    if (range) {
      rowIndex = position === "above" ? Math.max(0, range.rowFrom) : range.rowTo + 1
    } else if (target!.row < 0) {
      // 表头上方不能插入行（GFM 表头固定为首行）；下方等价于首行正文。
      if (position === "above") return
      rowIndex = 0
    } else {
      rowIndex = position === "above" ? target!.row : target!.row + 1
    }
    const next = insertTableRow(this.tableWithActiveEdit(dom.wrapper, dom.table), rowIndex)
    if (!next) return
    this.session().range = null
    this.replaceTable(next, { column: range ? range.columnFrom : target!.column, row: rowIndex + 1 })
  }

  opInsertColumn(side: "left" | "right") {
    const dom = this.currentDom()
    if (!dom) return
    const range = this.normalizedSessionRange()
    const target = this.targetCell(dom.wrapper)
    if (!range && !target) return
    const columnIndex = range
      ? side === "left" ? range.columnFrom : range.columnTo + 1
      : target!.column + (side === "right" ? 1 : 0)
    const next = insertTableColumn(this.tableWithActiveEdit(dom.wrapper, dom.table), columnIndex)
    if (!next) return
    // 新列沿用相邻列宽，保持既有的内容/铺满/自定义布局不被重置。
    this.adjustColumnPreference(dom.wrapper, (widths) => {
      widths.splice(columnIndex, 0, widths[Math.min(columnIndex, widths.length - 1)] ?? MIN_TABLE_COLUMN_WIDTH)
      return widths
    })
    this.session().range = null
    const focusRow = range ? range.rowFrom : target!.row
    this.replaceTable(next, { column: columnIndex, row: focusRow + 1 })
  }

  opDeleteRows() {
    const dom = this.currentDom()
    if (!dom) return
    const range = this.normalizedSessionRange()
    const current = this.tableWithActiveEdit(dom.wrapper, dom.table)
    if (range) {
      const next = deleteTableRowRange(current, range)
      if (!next) return
      this.session().range = null
      const focusRow = next.rows.length === 0 ? 0 : Math.min(Math.max(0, range.rowFrom), next.rows.length - 1) + 1
      this.replaceTable(next, { column: range.columnFrom, row: focusRow })
      return
    }
    const target = this.targetCell(dom.wrapper)
    if (!target || target.row < 0) return
    const next = deleteTableRow(current, target.row)
    if (!next) return
    const focusRow = next.rows.length === 0 ? 0 : Math.min(target.row, next.rows.length - 1) + 1
    this.replaceTable(next, { column: target.column, row: focusRow })
  }

  opDeleteColumns() {
    const dom = this.currentDom()
    if (!dom) return
    const range = this.normalizedSessionRange()
    const target = this.targetCell(dom.wrapper)
    if (!range && !target) return
    const current = this.tableWithActiveEdit(dom.wrapper, dom.table)
    const next = range
      ? deleteTableColumnRange(current, range)
      : deleteTableColumnRange(current, { columnFrom: target!.column, columnTo: target!.column, rowFrom: -1, rowTo: current.rows.length - 1 })
    if (!next) return
    const removedFrom = range ? range.columnFrom : target!.column
    const removedTo = range ? range.columnTo : target!.column
    this.adjustColumnPreference(dom.wrapper, (widths) => {
      widths.splice(removedFrom, removedTo - removedFrom + 1)
      return widths
    })
    this.session().range = null
    const rowIndex = range ? range.rowFrom : target!.row
    const focusColumn = Math.min(removedFrom, next.header.length - 1)
    const focusRow = rowIndex < 0 ? 0 : Math.min(rowIndex, Math.max(0, next.rows.length - 1)) + 1
    this.replaceTable(next, { column: focusColumn, row: focusRow })
  }

  opClearContents() {
    const dom = this.currentDom()
    if (!dom || this.view.state.readOnly) return
    const session = this.session()
    const range = this.normalizedSessionRange()
    const current = this.tableWithActiveEdit(dom.wrapper, dom.table)
    if (range) {
      session.pinnedRange = range
      this.replaceTable(clearTableCellRange(current, range))
      return
    }
    const target = this.targetCell(dom.wrapper)
    if (!target) return
    const next = cloneMarkdownTable(current)
    if (target.row < 0) next.header[target.column] = ""
    else if (next.rows[target.row]) next.rows[target.row][target.column] = ""
    this.replaceTable(next, { column: target.column, row: target.row + 1 })
  }

  async opCopySelection() {
    const dom = this.currentDom()
    if (!dom) return false
    const range = this.normalizedSessionRange()
    const current = this.tableWithActiveEdit(dom.wrapper, dom.table)
    const target = this.targetCell(dom.wrapper)
    const text = range
      ? tableCellRangeToTsv(current, range)
      : target
        ? tableCellAt(current, target.row, target.column)
        : ""
    if (!text) return false
    return writeClipboardText(text)
  }

  private opToggleRangeMark(mark: "**" | "*" | "~~" | "`") {
    const dom = this.currentDom()
    if (!dom || this.view.state.readOnly) return
    const range = this.normalizedSessionRange()
    if (!range) return
    const next = toggleTableCellRangeMark(this.tableWithActiveEdit(dom.wrapper, dom.table), range, mark)
    if (!next) return
    this.session().pinnedRange = range
    this.replaceTable(next)
  }

  private opDeleteWholeTable() {
    if (this.view.state.readOnly) return
    // 与 replaceTable 相同的核验：同步/撤销改写过的范围拒绝被旧实例覆盖。
    if (this.view.state.sliceDoc(this.from, this.to) !== this.source) return
    this.session().range = null
    this.view.dispatch({ changes: { from: this.from, to: this.to, insert: "" }, userEvent: "input.table", annotations: isolateHistory.of("full") })
  }

  private opRetarget(cell: CellPosition) {
    const dom = this.currentDom()
    if (!dom) return
    const session = this.session()
    const range = this.normalizedSessionRange()
    if (range && cell.row >= range.rowFrom && cell.row <= range.rowTo && cell.column >= range.columnFrom && cell.column <= range.columnTo) {
      // 右键落在已有选区内：保留选区，操作作用于整个选区。
      return
    }
    if (session.range) this.clearCellRange(dom.wrapper)
    this.selectCell(dom.wrapper, dom.table, cell.row, cell.column)
  }

  // ---------------------------------------------------------------------------
  // 选区浮层：就近提供常用操作。只在多格选区时出现，与顶部常驻工具栏分工——
  // 顶部工具栏服务单元格编辑与整表结构，浮层服务一次性的批量动作，用完随选区消失。
  // ---------------------------------------------------------------------------

  private clearFloatingBarOnly() {
    this.hideFloatingBar()
  }

  private updateFloatingBar(wrapper: HTMLElement, table: MarkdownTable, range: TableCellRange | null) {
    const cells = range ? (range.rowTo - range.rowFrom + 1) * (range.columnTo - range.columnFrom + 1) : 0
    if (!range || cells < 2 || this.session().drag?.active || this.view.state.readOnly) {
      this.hideFloatingBar()
      return
    }
    const bar = this.floatingBar ?? this.createFloatingBar()
    const deleteRows = bar.querySelector<HTMLButtonElement>('[data-float-action="delete-rows"]')
    if (deleteRows) deleteRows.disabled = range.rowTo < 0 || table.rows.length === 0
    const deleteColumns = bar.querySelector<HTMLButtonElement>('[data-float-action="delete-columns"]')
    if (deleteColumns) deleteColumns.disabled = table.header.length - (range.columnTo - range.columnFrom + 1) < 1
    this.positionFloatingBar(wrapper, range)
  }

  private createFloatingBar() {
    const bar = document.createElement("div")
    bar.className = "cm-md-table-floatbar"
    bar.setAttribute("role", "toolbar")
    bar.setAttribute("aria-label", "表格选区操作")
    const addButton = (label: string, action: string, run: () => void, title = label) => {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = label
      button.title = title
      button.dataset.floatAction = action
      // 不抢焦点：单元格编辑与正文选区都不因点击浮层而丢失。
      button.addEventListener("mousedown", (event) => event.preventDefault())
      button.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        run()
      })
      bar.append(button)
      return button
    }
    addButton("复制", "copy", () => void this.opCopySelection(), "复制选中单元格（⌘/Ctrl+C）")
    addButton("清空", "clear", () => this.opClearContents(), "清空选中单元格内容（Delete）")
    addButton("加粗", "bold", () => this.opToggleRangeMark("**"))
    addButton("斜体", "italic", () => this.opToggleRangeMark("*"))
    addButton("删除线", "strike", () => this.opToggleRangeMark("~~"))
    addButton("删除行", "delete-rows", () => this.opDeleteRows())
    addButton("删除列", "delete-columns", () => this.opDeleteColumns())
    document.body.append(bar)
    this.floatingBar = bar
    this.cleanupCallbacks.add(() => this.hideFloatingBar())
    // 滚动与窗口变化时跟随选区重新定位。
    const reposition = () => {
      const dom = this.currentDom()
      const range = this.normalizedSessionRange()
      if (dom && range) this.positionFloatingBar(dom.wrapper, range)
    }
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    this.cleanupCallbacks.add(() => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
    })
    return bar
  }

  // 浮层放在选区上方，空间不足时改到下方；横向限制在可视窗口内，窄窗口也不会飘出屏幕。
  private positionFloatingBar(wrapper: HTMLElement, range: TableCellRange) {
    const bar = this.floatingBar
    if (!bar) return
    const rows = Array.from(wrapper.querySelectorAll<HTMLTableRowElement>(".cm-md-table tr"))
    let top = Number.POSITIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    let left = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    for (let row = range.rowFrom; row <= range.rowTo; row += 1) {
      const tr = rows[row + 1]
      if (!tr) continue
      for (let column = range.columnFrom; column <= range.columnTo; column += 1) {
        const cell = tr.children[column]
        if (!(cell instanceof HTMLElement)) continue
        const rect = cell.getBoundingClientRect()
        top = Math.min(top, rect.top)
        bottom = Math.max(bottom, rect.bottom)
        left = Math.min(left, rect.left)
        right = Math.max(right, rect.right)
      }
    }
    if (!Number.isFinite(top)) return
    const width = bar.offsetWidth || 320
    const height = bar.offsetHeight || 36
    const viewport = window.visualViewport
    const viewportBottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0)
    const x = Math.max(8, Math.min(left + (right - left) / 2 - width / 2, window.innerWidth - width - 8))
    const y = top - height - 8 >= 8 ? top - height - 8 : Math.min(bottom + 8, viewportBottom - height - 8)
    bar.style.left = `${x}px`
    bar.style.top = `${y}px`
  }

  private hideFloatingBar() {
    this.floatingBar?.remove()
    this.floatingBar = null
  }

  // ---------------------------------------------------------------------------
  // 右键菜单 API（React 侧的 shadcn 菜单经注册表调用）
  // ---------------------------------------------------------------------------

  private createMenuApi(): TableWidgetApi {
    return {
      clearContents: () => this.liveWidget().opClearContents(),
      commitActiveEdit: () => {
        const target = activeTableEdit(this.view)
        // 只提交属于本表格的输入，其他表格的编辑状态不受影响。
        if (target?.input.closest(`[data-table-from="${this.from}"]`)) target.commit()
      },
      copySelection: () => this.liveWidget().opCopySelection(),
      deleteColumns: () => this.liveWidget().opDeleteColumns(),
      deleteRows: () => this.liveWidget().opDeleteRows(),
      deleteWholeTable: () => this.liveWidget().opDeleteWholeTable(),
      getMenuState: () => this.liveWidget().menuState(),
      insertColumn: (side) => this.liveWidget().opInsertColumn(side),
      insertRow: (position) => this.liveWidget().opInsertRow(position),
      retarget: (cell) => this.liveWidget().opRetarget(cell),
      targetInRange: (cell) => {
        const range = this.normalizedSessionRange()
        return Boolean(range && cell.row >= range.rowFrom && cell.row <= range.rowTo && cell.column >= range.columnFrom && cell.column <= range.columnTo)
      },
    }
  }

  private menuState(): TableWidgetMenuState {
    const dom = this.currentDom()
    const range = this.normalizedSessionRange()
    const target = this.session().range?.focus ?? (dom ? this.targetCell(dom.wrapper) : null) ?? { column: 0, row: -1 }
    const table = dom?.table ?? parseMarkdownTable(this.source)
    const selectedColumns = range ? range.columnTo - range.columnFrom + 1 : 1
    return {
      canClear: Boolean(table) && !this.view.state.readOnly,
      canDeleteColumn: Boolean(table && table.header.length - selectedColumns >= 1),
      canDeleteRow: Boolean(table && table.rows.length > 0 && (range ? range.rowTo >= 0 : target.row >= 0)),
      canInsertRowAbove: Boolean(range) || target.row >= 0,
      hasRangeSelection: Boolean(range && (range.rowTo - range.rowFrom + 1) * (range.columnTo - range.columnFrom + 1) > 1),
      readOnly: this.view.state.readOnly,
      target,
    }
  }

  ignoreEvent() {
    // 单元格输入完全由 Widget 接管，避免 CodeMirror 把点击重新映射到被替换的源码范围。
    return true
  }
}
