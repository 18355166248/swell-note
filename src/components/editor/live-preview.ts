import { syntaxTree } from "@codemirror/language"
import type { EditorState, Range } from "@codemirror/state"
import { Facet, StateEffect, StateField } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"

import { parseMarkdownNoteHref } from "@/services/markdown/markdown-preview-utils"
import type { VaultAsset } from "@/services/vault/vault-adapter"

// Markdown 即时预览：
// 非光标行隐藏语法标记并直接呈现最终样式，光标进入该行时还原原始 Markdown 文本，源文件始终保持纯文本。

// 只用到语法节点的结构信息；这里按结构声明，避免为类型引入 @lezer/common 显式依赖。
type MdSyntaxNode = {
  firstChild: MdSyntaxNode | null
  from: number
  getChild(name: string): MdSyntaxNode | null
  name: string
  nextSibling: MdSyntaxNode | null
  parent: MdSyntaxNode | null
  prevSibling: MdSyntaxNode | null
  to: number
}

// 打开链接是宿主行为：笔记内链交给工作区路由，外部链接默认走浏览器新窗口。
export type LivePreviewOptions = {
  onOpenExternalLink?: (href: string) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
}

const livePreviewOptions = Facet.define<LivePreviewOptions, LivePreviewOptions>({
  combine: (values) => values[0] ?? {},
})

const LINK_HINT = "点击打开链接"
const WIKI_HINT = "点击打开笔记"

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
    readonly view: EditorView,
  ) {
    super()
  }

  eq(other: TaskCheckboxWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }

  toDOM() {
    const box = document.createElement("input")
    box.type = "checkbox"
    box.checked = this.checked
    box.className = "cm-md-task-checkbox"
    box.setAttribute("aria-label", "切换任务状态")
    if (this.view.state.readOnly) {
      box.disabled = true
      return box
    }
    // 阻止 mousedown 默认行为，点击勾选框不会让编辑器失焦。
    box.addEventListener("mousedown", (event) => event.preventDefault())
    box.addEventListener("click", (event) => {
      event.preventDefault()
      this.view.dispatch({ changes: { from: this.from, to: this.to, insert: this.checked ? "[ ]" : "[x]" } })
    })
    return box
  }

  ignoreEvent() {
    return false
  }
}

type ParsedTable = {
  aligns: Array<"center" | "left" | "right" | "">
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

// GFM 语法树只对含分隔行的表格生成 Table 节点，这里做轻量二次解析供 Widget 直接建 DOM。
export function parseMarkdownTable(source: string): ParsedTable | null {
  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const header = splitTableRow(lines[0])
  const delimiter = splitTableRow(lines[1])
  if (!delimiter.length || !delimiter.every((cell) => /^:?-{1,}:?$/.test(cell))) return null
  const aligns = delimiter.map((cell) => {
    const start = cell.startsWith(":")
    const end = cell.endsWith(":")
    if (start && end) return "center" as const
    if (end) return "right" as const
    return "left" as const
  })
  return { aligns, header, rows: lines.slice(2).map(splitTableRow) }
}

function serializeTableCell(value: string) {
  return value.trim().replace(/(?<!\\)\|/g, "\\|")
}

function serializeMarkdownTable(table: ParsedTable) {
  const row = (cells: string[]) => `| ${cells.map(serializeTableCell).join(" | ")} |`
  const delimiter = table.aligns.map((align) => align === "center" ? ":---:" : align === "right" ? "---:" : "---")
  return [row(table.header), row(delimiter), ...table.rows.map(row)].join("\n")
}

type TableWidthMode = "content" | "full"

const TABLE_WIDTH_MODE_KEY = "swell-note:editor-table-width"

function loadTableWidthMode(): TableWidthMode {
  try {
    return window.localStorage.getItem(TABLE_WIDTH_MODE_KEY) === "full" ? "full" : "content"
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

function textDisplayUnits(value: string) {
  return Array.from(value).reduce((total, character) => total + (/^[\x00-\xff]$/.test(character) ? 1 : 2), 0)
}

function tableColumnWidths(table: ParsedTable) {
  return table.header.map((header, column) => {
    const maxUnits = Math.max(textDisplayUnits(header), ...table.rows.map((row) => textDisplayUnits(row[column] ?? "")))
    return Math.min(360, Math.max(96, maxUnits * 7 + 28))
  })
}

function applyTableWidthMode(wrapper: HTMLElement, mode: TableWidthMode) {
  const table = wrapper.querySelector<HTMLTableElement>(".cm-md-table")
  const columns = Array.from(table?.querySelectorAll<HTMLTableColElement>("col[data-content-width]") ?? [])
  if (!table || columns.length === 0) return
  const widths = columns.map((column) => Number(column.dataset.contentWidth) || 96)
  const totalWidth = widths.reduce((total, width) => total + width, 0)

  wrapper.dataset.widthMode = mode
  table.style.tableLayout = "fixed"
  table.style.width = mode === "full" ? "100%" : `${totalWidth}px`
  columns.forEach((column, index) => {
    column.style.width = mode === "full" ? `${(widths[index] / totalWidth) * 100}%` : `${widths[index]}px`
  })
  const button = wrapper.querySelector<HTMLButtonElement>(".cm-md-table-width-toggle")
  if (button) {
    button.textContent = mode === "full" ? "宽度：铺满" : "宽度：适应"
    button.title = mode === "full" ? "切换为适应内容" : "切换为铺满正文"
    button.setAttribute("aria-pressed", String(mode === "full"))
  }
}

// 单元格行内内容始终使用 DOM API 和 textContent 装配，不解析原始 HTML，避免把云端笔记内容变成注入面。
// 下划线形式要求两侧是非字母数字，否则 snake_case_name 这类标识符会被当成强调吞掉下划线。
const tableInlinePattern
  = /!\[([^\]\n]*)\]\((\S+?)(?:\s+["'][^"']*["'])?\)|\[([^\]\n]+)\]\((\S+?)(?:\s+["'][^"']*["'])?\)|~~(.+?)~~|\*\*(.+?)\*\*|(?<![\p{L}\p{N}])__(.+?)__(?![\p{L}\p{N}])|\*(.+?)\*|(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])|`([^`]+)`|(https?:\/\/[^\s<>]+)/gu

function appendInlineMarkdown(
  parent: HTMLElement,
  text: string,
  options: LivePreviewOptions = {},
  registerObjectUrl?: (url: string) => void,
) {
  let cursor = 0
  for (const match of text.matchAll(tableInlinePattern)) {
    const index = match.index ?? 0
    if (index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, index)))
    const imageAlt = match[1]
    const imageSource = match[2]
    const linkLabel = match[3]
    const linkHref = match[4]
    const strikeText = match[5]
    const strongText = match[6] ?? match[7]
    const emphasisText = match[8] ?? match[9]
    const codeText = match[10]
    const bareHref = match[11]
    if (imageSource !== undefined) {
      const image = document.createElement("img")
      image.alt = imageAlt ?? ""
      image.className = "cm-md-table-image"
      image.decoding = "async"
      image.loading = "lazy"
      if (/^(?:https?:|data:|blob:)/i.test(imageSource)) {
        image.src = imageSource
        parent.appendChild(image)
      } else if (options.onResolveAsset) {
        const loading = document.createElement("span")
        loading.className = "cm-md-table-asset-state"
        loading.textContent = image.alt ? `正在读取图片：${image.alt}` : "正在读取图片…"
        parent.appendChild(loading)
        void options.onResolveAsset(imageSource).then((asset) => {
          if (!asset || !loading.isConnected) {
            if (loading.isConnected) loading.textContent = image.alt ? `无法读取图片：${image.alt}` : "无法读取图片"
            return
          }
          const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(asset.data).buffer], { type: asset.mimeType }))
          registerObjectUrl?.(objectUrl)
          image.src = objectUrl
          loading.replaceWith(image)
        }).catch(() => {
          if (loading.isConnected) loading.textContent = image.alt ? `无法读取图片：${image.alt}` : "无法读取图片"
        })
      } else {
        const fallback = document.createElement("span")
        fallback.className = "cm-md-table-asset-state"
        fallback.textContent = image.alt || imageSource
        parent.appendChild(fallback)
      }
    } else if (linkHref !== undefined || bareHref !== undefined) {
      const href = linkHref ?? bareHref ?? ""
      const link = document.createElement("a")
      link.className = "cm-md-table-link"
      link.textContent = linkLabel ?? href
      const noteTarget = parseMarkdownNoteHref(href)
      if (noteTarget) link.dataset.mdNoteTarget = noteTarget
      else if (/^(?:https?|mailto):/i.test(href)) link.dataset.mdHref = href
      link.title = noteTarget ? WIKI_HINT : link.dataset.mdHref ? LINK_HINT : href
      link.addEventListener("click", (event) => {
        event.preventDefault()
        event.stopPropagation()
        openActionableLink(link, options)
      })
      parent.appendChild(link)
    } else if (strikeText !== undefined) {
      const del = document.createElement("del")
      del.textContent = strikeText
      parent.appendChild(del)
    } else if (strongText !== undefined) {
      const strong = document.createElement("strong")
      strong.textContent = strongText
      parent.appendChild(strong)
    } else if (emphasisText !== undefined) {
      const em = document.createElement("em")
      em.textContent = emphasisText
      parent.appendChild(em)
    } else {
      const code = document.createElement("code")
      code.textContent = codeText ?? ""
      parent.appendChild(code)
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)))
}

export class TableWidget extends WidgetType {
  readonly objectUrls = new Set<string>()

  constructor(
    readonly source: string,
    readonly view: EditorView,
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }

  eq(other: TableWidget) {
    return other.source === this.source && other.from === this.from && other.to === this.to
  }

  toDOM() {
    const table = parseMarkdownTable(this.source)
    const options = this.view.state.facet(livePreviewOptions)
    const wrapper = document.createElement("div")
    wrapper.className = "cm-md-table-wrap"
    wrapper.dataset.tableFrom = String(this.from)
    if (!table) return wrapper

    const element = document.createElement("table")
    element.className = "cm-md-table"
    const colgroup = document.createElement("colgroup")
    for (const width of tableColumnWidths(table)) {
      const column = document.createElement("col")
      column.dataset.contentWidth = String(width)
      colgroup.appendChild(column)
    }
    element.appendChild(colgroup)
    wrapper.appendChild(element)
    applyTableWidthMode(wrapper, loadTableWidthMode())

    if (!this.view.state.readOnly) {
      const toolbar = document.createElement("div")
      toolbar.className = "cm-md-table-toolbar"
      toolbar.setAttribute("aria-label", "表格操作")
      toolbar.append(
        this.createWidthButton(wrapper),
        this.createTableButton("添加行", wrapper, () => ({
          ...table,
          header: [...table.header],
          aligns: [...table.aligns],
          rows: [...table.rows.map((row) => [...row]), Array(table.header.length).fill("")],
        })),
        this.createTableButton("添加列", wrapper, () => ({
          header: [...table.header, "新列"],
          aligns: [...table.aligns, "left"],
          rows: table.rows.map((row) => [...row, ""]),
        })),
        this.createDeleteButton("删除行", "row", wrapper, table),
        this.createDeleteButton("删除列", "column", wrapper, table),
        this.createAlignButton("左对齐", "left", wrapper, table),
        this.createAlignButton("居中", "center", wrapper, table),
        this.createAlignButton("右对齐", "right", wrapper, table),
      )
      wrapper.insertBefore(toolbar, element)
      applyTableWidthMode(wrapper, loadTableWidthMode())
    }

    const headRow = document.createElement("tr")
    table.header.forEach((cell, index) => {
      const th = document.createElement("th")
      th.style.textAlign = table.aligns[index] ?? "left"
      appendInlineMarkdown(th, cell, options, (url) => this.objectUrls.add(url))
      this.enableCellEditing(th, wrapper, table, -1, index, cell)
      headRow.appendChild(th)
    })
    const thead = document.createElement("thead")
    thead.appendChild(headRow)
    element.appendChild(thead)

    const tbody = document.createElement("tbody")
    table.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr")
      row.forEach((cell, index) => {
        const td = document.createElement("td")
        td.style.textAlign = table.aligns[index] ?? "left"
        appendInlineMarkdown(td, cell, options, (url) => this.objectUrls.add(url))
        this.enableCellEditing(td, wrapper, table, rowIndex, index, cell)
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
    element.appendChild(tbody)
    return wrapper
  }

  destroy() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url)
    this.objectUrls.clear()
  }

  private createWidthButton(wrapper: HTMLDivElement) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "cm-md-table-width-toggle"
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      const mode: TableWidthMode = wrapper.dataset.widthMode === "full" ? "content" : "full"
      saveTableWidthMode(mode)
      // 宽度是编辑器级显示偏好，同一篇笔记中的表格同步切换，且不改写 Markdown。
      for (const candidate of this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-wrap")) {
        applyTableWidthMode(candidate, mode)
      }
    })
    return button
  }

  private createTableButton(
    label: string,
    wrapper: HTMLDivElement,
    update: () => ParsedTable,
  ) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.title = label
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      const nextTable = update()
      const input = wrapper.querySelector<HTMLInputElement>(".cm-md-table-cell-input")
      const editingCell = input?.closest<HTMLTableCellElement>("th, td")
      const rowIndex = Number(editingCell?.dataset.rowIndex)
      const columnIndex = Number(editingCell?.dataset.columnIndex)

      // 工具栏的 mousedown 会保留单元格焦点；结构变更前合并尚未失焦的输入，避免按钮看似失效或丢字。
      if (input && Number.isInteger(rowIndex) && Number.isInteger(columnIndex)) {
        if (rowIndex < 0) nextTable.header[columnIndex] = input.value
        else if (nextTable.rows[rowIndex]) nextTable.rows[rowIndex][columnIndex] = input.value
      }
      this.replaceTable(wrapper, nextTable)
    })
    return button
  }

  private createDeleteButton(
    label: string,
    kind: "column" | "row",
    wrapper: HTMLDivElement,
    table: ParsedTable,
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

      const nextTable = this.tableWithActiveEdit(wrapper, table)
      if (kind === "row") {
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || !nextTable.rows[rowIndex]) return
        nextTable.rows.splice(rowIndex, 1)
        const focusRow = nextTable.rows.length === 0 ? 0 : Math.min(rowIndex, nextTable.rows.length - 1) + 1
        this.replaceTable(wrapper, nextTable, { column: Math.min(columnIndex, nextTable.header.length - 1), row: focusRow })
        return
      }

      // Markdown 表格至少保留一列；否则分隔行不再构成有效表格，用户会突然看到源码。
      if (nextTable.header.length <= 1 || columnIndex < 0 || columnIndex >= nextTable.header.length) return
      nextTable.header.splice(columnIndex, 1)
      nextTable.aligns.splice(columnIndex, 1)
      nextTable.rows.forEach((row) => row.splice(columnIndex, 1))
      const focusColumn = Math.min(columnIndex, nextTable.header.length - 1)
      const focusRow = rowIndex < 0 ? 0 : Math.min(rowIndex, Math.max(0, nextTable.rows.length - 1)) + 1
      this.replaceTable(wrapper, nextTable, { column: focusColumn, row: focusRow })
    })
    return button
  }

  private createAlignButton(
    label: string,
    align: "center" | "left" | "right",
    wrapper: HTMLDivElement,
    table: ParsedTable,
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
      if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= table.header.length) return
      const nextTable = this.tableWithActiveEdit(wrapper, table)
      nextTable.aligns[columnIndex] = align
      this.replaceTable(wrapper, nextTable, { column: columnIndex, row: rowIndex < 0 ? 0 : rowIndex + 1 })
    })
    return button
  }

  private tableWithActiveEdit(wrapper: HTMLDivElement, table: ParsedTable) {
    const nextTable: ParsedTable = {
      aligns: [...table.aligns],
      header: [...table.header],
      rows: table.rows.map((row) => [...row]),
    }
    const input = wrapper.querySelector<HTMLInputElement>(".cm-md-table-cell-input")
    const editingCell = input?.closest<HTMLTableCellElement>("th, td")
    const rowIndex = Number(editingCell?.dataset.rowIndex)
    const columnIndex = Number(editingCell?.dataset.columnIndex)
    if (!input || !Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) return nextTable
    if (rowIndex < 0) nextTable.header[columnIndex] = input.value
    else if (nextTable.rows[rowIndex]) nextTable.rows[rowIndex][columnIndex] = input.value
    return nextTable
  }

  private selectCell(
    cellElement: HTMLTableCellElement,
    wrapper: HTMLDivElement,
    table: ParsedTable,
    rowIndex: number,
    columnIndex: number,
  ) {
    wrapper.querySelector(".cm-md-table-cell-selected")?.classList.remove("cm-md-table-cell-selected")
    cellElement.classList.add("cm-md-table-cell-selected")
    wrapper.dataset.selectedRow = String(rowIndex)
    wrapper.dataset.selectedColumn = String(columnIndex)
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

  private replaceTable(
    _wrapper: HTMLDivElement,
    table: ParsedTable,
    focus?: { column: number; row: number },
  ) {
    const from = this.from
    // 同步或撤销可能在交互期间替换正文；写回前核验原始范围，避免旧 Widget 覆盖新表格。
    if (this.view.state.sliceDoc(from, this.to) !== this.source) return false
    this.view.dispatch({
      changes: { from, to: this.to, insert: serializeMarkdownTable(table) },
    })
    if (focus) this.focusCellAfterUpdate(from, focus)
    return true
  }

  private focusCellAfterUpdate(tableFrom: number, target: { column: number; row: number }) {
    window.setTimeout(() => {
      const wrapper = Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-wrap"))
        .find((candidate) => Number(candidate.dataset.tableFrom) === tableFrom)
      const rows = wrapper?.querySelectorAll("tr")
      const cell = rows?.[target.row]?.children[target.column]
      if (cell instanceof HTMLElement) cell.click()
    }, 0)
  }

  private enableCellEditing(
    cellElement: HTMLTableCellElement,
    wrapper: HTMLDivElement,
    table: ParsedTable,
    rowIndex: number,
    columnIndex: number,
    originalValue: string,
  ) {
    if (this.view.state.readOnly) return
    cellElement.classList.add("cm-md-table-cell-editable")
    cellElement.dataset.rowIndex = String(rowIndex)
    cellElement.dataset.columnIndex = String(columnIndex)
    cellElement.tabIndex = 0
    cellElement.setAttribute("aria-label", `编辑表格${rowIndex < 0 ? "表头" : `第 ${rowIndex + 1} 行`}第 ${columnIndex + 1} 列`)

    const beginEditing = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      this.selectCell(cellElement, wrapper, table, rowIndex, columnIndex)
      const activeInput = wrapper.querySelector<HTMLInputElement>(".cm-md-table-cell-input")
      if (activeInput && !cellElement.contains(activeInput)) {
        // 直接点击另一个单元格时先写回旧输入，再在重绘后的目标格继续编辑，避免残留多个输入框。
        this.replaceTable(wrapper, this.tableWithActiveEdit(wrapper, table), { column: columnIndex, row: rowIndex + 1 })
        return
      }
      if (cellElement.querySelector("input")) return

      const input = document.createElement("input")
      input.className = "cm-md-table-cell-input"
      input.value = originalValue
      input.setAttribute("aria-label", cellElement.getAttribute("aria-label") ?? "编辑表格单元格")
      cellElement.replaceChildren(input)
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)

      let finished = false
      const restoreCell = () => {
        cellElement.replaceChildren()
        appendInlineMarkdown(
          cellElement,
          originalValue,
          this.view.state.facet(livePreviewOptions),
          (url) => this.objectUrls.add(url),
        )
      }
      const commit = (navigation?: { appendRow?: boolean; column: number; row: number }) => {
        if (finished) return
        finished = true
        if (!navigation && input.value === originalValue) {
          restoreCell()
          return
        }
        const nextTable: ParsedTable = {
          aligns: [...table.aligns],
          header: [...table.header],
          rows: table.rows.map((row) => [...row]),
        }
        if (rowIndex < 0) nextTable.header[columnIndex] = input.value
        else nextTable.rows[rowIndex][columnIndex] = input.value
        if (navigation?.appendRow) nextTable.rows.push(Array(nextTable.header.length).fill(""))
        this.replaceTable(wrapper, nextTable, navigation)
      }
      input.addEventListener("blur", () => commit(), { once: true })
      input.addEventListener("keydown", (keyboardEvent) => {
        if (keyboardEvent.key === "Escape") {
          finished = true
          restoreCell()
          cellElement.focus()
          return
        }
        if (keyboardEvent.key !== "Tab" && keyboardEvent.key !== "Enter") return
        keyboardEvent.preventDefault()
        const visualRow = rowIndex + 1
        const lastColumn = table.header.length - 1
        const lastVisualRow = table.rows.length
        let next = { column: columnIndex, row: visualRow }
        let appendRow = false
        if (keyboardEvent.key === "Enter") {
          next.row = visualRow + 1
          if (next.row > lastVisualRow) appendRow = true
        } else if (keyboardEvent.shiftKey) {
          next.column = columnIndex - 1
          if (next.column < 0) {
            next.column = lastColumn
            next.row = Math.max(0, visualRow - 1)
          }
        } else {
          next.column = columnIndex + 1
          if (next.column > lastColumn) {
            next.column = 0
            next.row = visualRow + 1
            if (next.row > lastVisualRow) appendRow = true
          }
        }
        commit({ ...next, appendRow })
      })
    }
    cellElement.addEventListener("click", beginEditing)
    cellElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") beginEditing(event)
    })
  }

  ignoreEvent() {
    // 单元格输入完全由 Widget 接管，避免 CodeMirror 把点击重新映射到被替换的源码范围。
    return true
  }
}

function collectCursorLines(state: EditorState) {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(Math.min(range.from, range.to)).number
    const to = state.doc.lineAt(Math.max(range.from, range.to)).number
    for (let number = from; number <= to; number += 1) lines.add(number)
  }
  return lines
}

function cursorLineChecker(state: EditorState) {
  const cursorLines = collectCursorLines(state)
  // 节点跨多行时，只要任一行处于选区就保持原样，避免只隐藏一半标记。
  return (from: number, to: number) => {
    const fromLine = state.doc.lineAt(from).number
    const toLine = state.doc.lineAt(to).number
    for (let number = fromLine; number <= toLine; number += 1) {
      if (cursorLines.has(number)) return true
    }
    return false
  }
}

type DocRange = { from: number; to: number }

// frontmatter 在 CommonMark 里没有对应节点：首行 --- 被解析成分割线，其余属性行被并入 SetextHeading2。
// 先单独识别整段范围，避免属性区被放大成标题、分隔线被隐藏，同时保持纯文本可编辑。
const frontmatterFencePattern = /^---\s*$/

function findFrontmatterRange(state: EditorState): DocRange | null {
  if (state.doc.lines < 2) return null
  const first = state.doc.line(1)
  if (!frontmatterFencePattern.test(first.text)) return null
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    if (frontmatterFencePattern.test(line.text)) return { from: first.from, to: line.to }
  }
  // 没有闭合分隔行时不算 frontmatter，按普通正文渲染。
  return null
}

// 以下双链逻辑只服务旧 Vault 的编辑显示；围栏代码块与行内代码必须保持原文，避免改变代码语义。
function isInsideCode(state: EditorState, position: number) {
  for (let node: MdSyntaxNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name.includes("Code")) return true
  }
  return false
}

function isInsideParsedLinkOrCode(state: EditorState, position: number) {
  for (let node: MdSyntaxNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name.includes("Code") || node.name === "Link" || node.name === "Autolink") return true
  }
  return false
}

// [[笔记|别名]] 不属于 CommonMark，语法树只会拆成普通文本与不带 URL 的 Link 节点，
// 因此按可见范围做正则扫描，跳过代码与 frontmatter 后单独装饰。
const wikiLinkPattern = /(!?)\[\[([^\[\]\n]+)\]\]/g

function decorateWikiLinks(
  state: EditorState,
  from: number,
  to: number,
  isCursorActive: (from: number, to: number) => boolean,
  frontmatter: DocRange | null,
  push: (decoration: Range<Decoration>) => void,
) {
  for (const match of state.sliceDoc(from, to).matchAll(wikiLinkPattern)) {
    const start = from + (match.index ?? 0)
    const end = start + match[0].length
    if (frontmatter && start < frontmatter.to && end > frontmatter.from) continue
    if (isInsideCode(state, start + match[1].length + 2)) continue

    // 嵌入（![[...]]）在编辑器里没有等价的渲染形态，只上色不隐藏标记，避免与普通链接混淆。
    if (match[1]) {
      push(Decoration.mark({ class: "cm-md-wiki-embed" }).range(start, end))
      continue
    }

    const value = match[2]
    const pipe = value.indexOf("|")
    const target = (pipe < 0 ? value : value.slice(0, pipe)).trim()
    if (!target) continue
    const active = isCursorActive(start, end)
    push(Decoration.mark({ class: "cm-md-wiki-link" }).range(start, end))

    const labelStart = pipe < 0 ? start + 2 : start + 2 + pipe + 1
    const labelEnd = end - 2
    if (labelStart >= labelEnd) continue
    // 只把可见文字设为跳转热区；编辑态仍可点击括号或目标源码定位修改。
    push(Decoration.mark({
      attributes: { "data-wiki-target": target, title: WIKI_HINT },
      class: "cm-md-link-actionable",
    }).range(labelStart, labelEnd))

    if (active) continue
    // 有别名时连同目标与竖线一起隐藏，只留别名。
    push(Decoration.replace({}).range(start, labelStart))
    push(Decoration.replace({}).range(end - 2, end))
  }
}

// 只有明确的外链协议才挂可点击属性，相对路径与自定义协议留给源码编辑。
const externalHrefPattern = /^(?:https?|mailto):/i
const bareUrlPattern = /https?:\/\/[^\s<>]+/gi
const bareUrlTrailingPunctuation = /[.,;!?，。；！？、]+$/

function decorateBareUrls(
  state: EditorState,
  from: number,
  to: number,
  frontmatter: DocRange | null,
  push: (decoration: Range<Decoration>) => void,
) {
  for (const match of state.sliceDoc(from, to).matchAll(bareUrlPattern)) {
    const rawHref = match[0]
    const href = rawHref.replace(bareUrlTrailingPunctuation, "")
    if (!href) continue
    const start = from + (match.index ?? 0)
    const end = start + href.length
    if (frontmatter && start < frontmatter.to && end > frontmatter.from) continue
    // 正式 Markdown 链接和代码区域由语法树处理，裸 URL 扫描只补齐 GFM 自动链接。
    if (isInsideParsedLinkOrCode(state, start + 1)) continue
    push(Decoration.mark({
      attributes: { "data-md-href": href, title: LINK_HINT },
      class: "cm-md-link cm-md-link-actionable",
    }).range(start, end))
  }
}

function openExternalLink(href: string, options: LivePreviewOptions) {
  if (options.onOpenExternalLink) {
    options.onOpenExternalLink(href)
    return
  }
  window.open(href, "_blank", "noopener,noreferrer")
}

function openActionableLink(element: Element, options: LivePreviewOptions) {
  const noteTarget = element.closest("[data-wiki-target]")?.getAttribute("data-wiki-target")
    || element.closest("[data-md-note-target]")?.getAttribute("data-md-note-target")
  if (noteTarget) {
    options.onOpenWikiLink?.(noteTarget)
    return true
  }

  const href = element.closest("[data-md-href]")?.getAttribute("data-md-href")
  if (!href) return false
  openExternalLink(href, options)
  return true
}

// 表格整块替换属于块级装饰，CodeMirror 要求块级装饰由 StateField 提供，插件只能携带行内装饰。
type TableBlock = { from: number; source: string; to: number }

function collectTableBlocks(state: EditorState): TableBlock[] {
  const blocks: TableBlock[] = []

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return
      // 块替换必须覆盖整行，范围取首行行首到末行行尾。
      const firstLine = state.doc.lineAt(node.from)
      const lastLine = state.doc.lineAt(node.to)
      const source = state.sliceDoc(firstLine.from, lastLine.to)
      if (!parseMarkdownTable(source)) return
      blocks.push({ from: firstLine.from, source, to: lastLine.to })
      return false
    },
  })

  return blocks
}

// RangeSet 没有值相等接口，用位置加原文构成轻量 key；只比长度会漏掉同步合并、
// 撤销等带来的等长改写，导致表格继续渲染旧内容。
function tableBlocksKey(blocks: TableBlock[]) {
  return blocks.map((block) => `${block.from}:${block.to}:${block.source.length}:${block.source}`).join("|")
}

function tableBlocksDecorations(blocks: TableBlock[], view: EditorView): DecorationSet {
  return Decoration.set(
    blocks.map((block) =>
      Decoration.replace({
        block: true,
        // 块级替换节点在不同浏览器中通过 posAtDOM 可能映射到范围末端，直接传递解析得到的源码起点。
        widget: new TableWidget(block.source, view, block.from, block.to),
      }).range(block.from, block.to),
    ),
    true,
  )
}

const setTableDecorations = StateEffect.define<DecorationSet>()

const tableDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    const effect = transaction.effects.find((candidate) => candidate.is(setTableDecorations))
    return effect ? effect.value : value.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const isCursorActive = cursorLineChecker(view.state)
  const frontmatter = findFrontmatterRange(view.state)

  const decorations: Range<Decoration>[] = []
  const hide = (node: MdSyntaxNode) => {
    decorations.push(Decoration.replace({}).range(node.from, node.to))
  }
  const hideMarkChildren = (node: MdSyntaxNode, active: boolean, ...markNames: string[]) => {
    if (active) return
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (markNames.includes(child.name)) hide(child)
    }
  }
  const decorateLines = (from: number, to: number, className: string) => {
    const first = view.state.doc.lineAt(from).number
    const last = view.state.doc.lineAt(to).number
    for (let number = first; number <= last; number += 1) {
      const line = view.state.doc.line(number)
      decorations.push(Decoration.line({ class: className }).range(line.from))
    }
  }

  // frontmatter 很短，只要与视口有交集就整段装饰，不必按可见范围切分。
  if (frontmatter && view.visibleRanges.some((range) => range.from <= frontmatter.to && range.to >= frontmatter.from)) {
    const firstLine = view.state.doc.lineAt(frontmatter.from).number
    const lastLine = view.state.doc.lineAt(frontmatter.to).number
    for (let number = firstLine; number <= lastLine; number += 1) {
      const fence = number === firstLine || number === lastLine
      decorations.push(
        Decoration.line({ class: fence ? "cm-md-frontmatter cm-md-frontmatter-fence" : "cm-md-frontmatter" })
          .range(view.state.doc.line(number).from),
      )
    }
  }

  for (const { from, to } of view.visibleRanges) {
    decorateWikiLinks(view.state, from, to, isCursorActive, frontmatter, (decoration) => decorations.push(decoration))
    decorateBareUrls(view.state, from, to, frontmatter, (decoration) => decorations.push(decoration))

    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // frontmatter 内部不再套用正文规则（否则属性行会被当成 SetextHeading2 放大）。
        if (frontmatter && node.from >= frontmatter.from && node.to <= frontmatter.to) return false
        const active = isCursorActive(node.from, node.to)
        // 标题节点名带级别后缀（ATXHeading1..6 / SetextHeading1..2）。
        const heading = node.name.match(/^(?:ATX|Setext)Heading([1-6])$/)
        if (heading) {
          decorations.push(Decoration.line({ class: `cm-md-heading cm-md-h${heading[1]}` }).range(node.from))
          if (!active) {
            const headerMark = node.node.getChild("HeaderMark")
            if (headerMark) hide(headerMark)
          }
          return
        }
        switch (node.name) {
          case "StrongEmphasis": {
            decorations.push(Decoration.mark({ class: "cm-md-strong" }).range(node.from, node.to))
            hideMarkChildren(node.node, active, "EmphasisMark")
            break
          }
          case "Emphasis": {
            decorations.push(Decoration.mark({ class: "cm-md-em" }).range(node.from, node.to))
            hideMarkChildren(node.node, active, "EmphasisMark")
            break
          }
          case "Strikethrough": {
            decorations.push(Decoration.mark({ class: "cm-md-strike" }).range(node.from, node.to))
            hideMarkChildren(node.node, active, "StrikethroughMark")
            break
          }
          case "InlineCode": {
            decorations.push(Decoration.mark({ class: "cm-md-inline-code" }).range(node.from, node.to))
            hideMarkChildren(node.node, active, "CodeMark")
            break
          }
          case "FencedCode": {
            decorateLines(node.from, node.to, "cm-md-codeblock")
            if (!active) {
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === "CodeMark" || child.name === "CodeInfo") hide(child)
              }
            }
            break
          }
          case "Blockquote": {
            decorateLines(node.from, node.to, "cm-md-quote")
            if (!active) {
              for (let child = node.node.firstChild; child; child = child.nextSibling) {
                if (child.name === "QuoteMark") hide(child)
              }
            }
            break
          }
          case "TaskMarker": {
            if (active) break
            const checked = view.state.sliceDoc(node.from, node.to).toLocaleLowerCase().includes("x")
            decorations.push(
              Decoration.replace({
                widget: new TaskCheckboxWidget(checked, node.from, node.to, view),
              }).range(node.from, node.to),
            )
            const listMark = node.node.prevSibling
            if (listMark?.name === "ListMark") hide(listMark)
            break
          }
          case "Link":
          case "Autolink": {
            // 引用式链接与 [[wiki]] 内层节点都没有 URL 子节点，跳过后由各自逻辑处理。
            const url = node.node.getChild("URL")
            if (!url) break
            const href = view.state.sliceDoc(url.from, url.to)
            const noteTarget = parseMarkdownNoteHref(href)
            const linkAttributes: Record<string, string> | undefined = noteTarget
              ? { "data-md-note-target": noteTarget, title: WIKI_HINT }
              : externalHrefPattern.test(href)
                ? { "data-md-href": href, title: LINK_HINT }
                : undefined
            const marks: MdSyntaxNode[] = []
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === "LinkMark") marks.push(child)
            }
            const open = marks[0]
            const close = marks.find((mark) => view.state.sliceDoc(mark.from, mark.to) === "]")
            decorations.push(
              Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to),
            )
            const actionFrom = node.name === "Autolink" ? url.from : open?.to
            const actionTo = node.name === "Autolink" ? url.to : close?.from
            if (linkAttributes && actionFrom !== undefined && actionTo !== undefined && actionFrom < actionTo) {
              decorations.push(Decoration.mark({
                attributes: linkAttributes,
                class: "cm-md-link-actionable",
              }).range(actionFrom, actionTo))
            }
            if (active) break
            if (node.name === "Autolink") {
              hideMarkChildren(node.node, active, "LinkMark")
              break
            }
            // 链接文本为空时隐藏会让整行看不见内容，保持原样。
            if (!open || !close || close.from <= open.to) break
            decorations.push(Decoration.replace({}).range(open.from, open.to))
            decorations.push(Decoration.replace({}).range(close.from, node.to))
            break
          }
          case "HorizontalRule": {
            decorateLines(node.from, node.to, "cm-md-hr")
            if (!active) hide(node.node)
            break
          }
          case "Table": {
            // 表格由可编辑 Widget 始终接管，避免光标进入后整块退回 Markdown 源码。
            return false
          }
        }
      },
    })
  }

  return Decoration.set(decorations, true)
}

const markdownLivePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    destroyed = false
    tableBlocksKey = ""

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view)
      // 初次构建即提交表格装饰（构造期 dispatch 延迟到挂载后执行）。
      this.syncTableDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLivePreviewDecorations(update.view)
        this.syncTableDecorations(update.view)
      }
    }

    destroy() {
      this.destroyed = true
    }

    // 表格装饰变化时经 effect 写入 StateField，内容不变则跳过，避免无意义的重绘。
    // 插件 update 期间不允许同步 dispatch，延迟到当前更新结束后提交。
    syncTableDecorations(view: EditorView) {
      if (tableBlocksKey(collectTableBlocks(view.state)) === this.tableBlocksKey) return
      window.setTimeout(() => {
        if (this.destroyed) return
        // 等待期间文档可能已被同步合并或撤销改写，必须按当前状态重算，
        // 否则会把基于旧文档的位置派发到新文档上。
        const blocks = collectTableBlocks(view.state)
        this.tableBlocksKey = tableBlocksKey(blocks)
        view.dispatch({ effects: setTableDecorations.of(tableBlocksDecorations(blocks, view)) })
      }, 0)
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // 编辑态也允许单击链接文字跳转；括号和 URL 区域仍用于源码定位与修改。
    eventHandlers: {
      keydown(event: KeyboardEvent, view: EditorView) {
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.altKey) return false
        const dom = view.domAtPos(view.state.selection.main.head).node
        const element = dom instanceof Element ? dom : dom.parentElement
        if (!element || !openActionableLink(element, view.state.facet(livePreviewOptions))) return false
        event.preventDefault()
        return true
      },
      mousedown(event: MouseEvent, view: EditorView) {
        const element = event.target instanceof Element ? event.target : null
        if (!element) return false
        if (!openActionableLink(element, view.state.facet(livePreviewOptions))) return false
        event.preventDefault()
        return true
      },
    },
  },
)

export { markdownLivePreviewPlugin, tableDecorationsField }

// 表格块替换必须经 StateField 提供，与行内装饰插件一起注册。
export function markdownLivePreview(options: LivePreviewOptions = {}) {
  return [livePreviewOptions.of(options), markdownLivePreviewPlugin, tableDecorationsField]
}
