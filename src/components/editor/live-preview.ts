import { syntaxTree } from "@codemirror/language"
import type { EditorState, Range } from "@codemirror/state"
import { Facet, StateEffect, StateField } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"

import { parseMarkdownNoteHref } from "@/services/markdown/markdown-preview-utils"

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
}

const livePreviewOptions = Facet.define<LivePreviewOptions, LivePreviewOptions>({
  combine: (values) => values[0] ?? {},
})

const LINK_HINT = "\u2318 / Ctrl + \u70b9\u51fb\u6253\u5f00\u94fe\u63a5"
const WIKI_HINT = "\u2318 / Ctrl + \u70b9\u51fb\u6253\u5f00\u7b14\u8bb0"

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

// 单元格内只保留加粗/斜体/行内代码三类高频行内语法，全部用 textContent 装配，不引入 HTML 注入面。
// 下划线形式要求两侧是非字母数字，否则 snake_case_name 这类标识符会被当成强调吞掉下划线。
const tableInlinePattern
  = /\*\*(.+?)\*\*|(?<![\p{L}\p{N}])__(.+?)__(?![\p{L}\p{N}])|\*(.+?)\*|(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])|`([^`]+)`/gu

function appendInlineMarkdown(parent: HTMLElement, text: string) {
  let cursor = 0
  for (const match of text.matchAll(tableInlinePattern)) {
    const index = match.index ?? 0
    if (index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, index)))
    const strongText = match[1] ?? match[2]
    const emphasisText = match[3] ?? match[4]
    if (strongText !== undefined) {
      const strong = document.createElement("strong")
      strong.textContent = strongText
      parent.appendChild(strong)
    } else if (emphasisText !== undefined) {
      const em = document.createElement("em")
      em.textContent = emphasisText
      parent.appendChild(em)
    } else {
      const code = document.createElement("code")
      code.textContent = match[5] ?? ""
      parent.appendChild(code)
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)))
}

export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly view: EditorView,
  ) {
    super()
  }

  eq(other: TableWidget) {
    return other.source === this.source
  }

  toDOM() {
    const table = parseMarkdownTable(this.source)
    const wrapper = document.createElement("div")
    wrapper.className = "cm-md-table-wrap"
    if (!table) return wrapper

    const element = document.createElement("table")
    element.className = "cm-md-table"
    const headRow = document.createElement("tr")
    table.header.forEach((cell, index) => {
      const th = document.createElement("th")
      th.style.textAlign = table.aligns[index] ?? "left"
      appendInlineMarkdown(th, cell)
      this.enableCellEditing(th, wrapper, table, -1, index, cell)
      headRow.appendChild(th)
    })
    const thead = document.createElement("thead")
    thead.appendChild(headRow)
    element.appendChild(thead)

    const tbody = document.createElement("tbody")
    for (const row of table.rows) {
      const tr = document.createElement("tr")
      row.forEach((cell, index) => {
        const td = document.createElement("td")
        td.style.textAlign = table.aligns[index] ?? "left"
        appendInlineMarkdown(td, cell)
        this.enableCellEditing(td, wrapper, table, table.rows.indexOf(row), index, cell)
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }
    element.appendChild(tbody)
    wrapper.appendChild(element)

    return wrapper
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
    cellElement.tabIndex = 0
    cellElement.setAttribute("aria-label", `编辑表格${rowIndex < 0 ? "表头" : `第 ${rowIndex + 1} 行`}第 ${columnIndex + 1} 列`)

    const beginEditing = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      if (cellElement.querySelector("input")) return

      const input = document.createElement("input")
      input.className = "cm-md-table-cell-input"
      input.value = originalValue
      input.setAttribute("aria-label", cellElement.getAttribute("aria-label") ?? "编辑表格单元格")
      cellElement.replaceChildren(input)
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)

      let cancelled = false
      const restoreCell = () => {
        cellElement.replaceChildren()
        appendInlineMarkdown(cellElement, originalValue)
      }
      const commit = () => {
        if (cancelled || input.value === originalValue) {
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

        // Widget 可能在同步合并后短暂复用；提交前核对原文，避免把旧表格覆盖到新版本。
        const from = this.view.posAtDOM(wrapper)
        if (this.view.state.sliceDoc(from, from + this.source.length) !== this.source) {
          restoreCell()
          return
        }
        this.view.dispatch({
          changes: { from, to: from + this.source.length, insert: serializeMarkdownTable(nextTable) },
        })
      }
      input.addEventListener("blur", commit, { once: true })
      input.addEventListener("keydown", (keyboardEvent) => {
        if (keyboardEvent.key === "Escape") {
          cancelled = true
          input.blur()
          return
        }
        if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey) {
          keyboardEvent.preventDefault()
          input.blur()
        }
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
    push(Decoration.mark({
      attributes: { "data-wiki-target": target, title: WIKI_HINT },
      class: "cm-md-wiki-link",
    }).range(start, end))

    if (isCursorActive(start, end)) continue
    // 有别名时连同目标与竖线一起隐藏，只留别名；别名为空则保持原样，避免整段消失。
    const labelStart = pipe < 0 ? start + 2 : start + 2 + pipe + 1
    if (labelStart >= end - 2) continue
    push(Decoration.replace({}).range(start, labelStart))
    push(Decoration.replace({}).range(end - 2, end))
  }
}

// 只有明确的外链协议才挂可点击属性，相对路径与自定义协议留给源码编辑。
const externalHrefPattern = /^(?:https?|mailto):/i

function openExternalLink(href: string, options: LivePreviewOptions) {
  if (options.onOpenExternalLink) {
    options.onOpenExternalLink(href)
    return
  }
  window.open(href, "_blank", "noopener,noreferrer")
}

// 表格整块替换属于块级装饰，CodeMirror 要求块级装饰由 StateField 提供，插件只能携带行内装饰。
type TableBlock = { from: number; source: string; to: number }

function collectTableBlocks(state: EditorState): TableBlock[] {
  const blocks: TableBlock[] = []

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return
      const source = state.sliceDoc(node.from, node.to)
      if (!parseMarkdownTable(source)) return
      // 块替换必须覆盖整行，范围取首行行首到末行行尾。
      const firstLine = state.doc.lineAt(node.from)
      const lastLine = state.doc.lineAt(node.to)
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
        widget: new TableWidget(block.source, view),
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
            decorations.push(
              Decoration.mark({
                attributes: noteTarget
                  ? { "data-md-note-target": noteTarget, title: WIKI_HINT }
                  : externalHrefPattern.test(href) ? { "data-md-href": href, title: LINK_HINT } : undefined,
                class: "cm-md-link",
              }).range(node.from, node.to),
            )
            if (active) break
            if (node.name === "Autolink") {
              hideMarkChildren(node.node, active, "LinkMark")
              break
            }
            const marks: MdSyntaxNode[] = []
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === "LinkMark") marks.push(child)
            }
            const open = marks[0]
            const close = marks.find((mark) => view.state.sliceDoc(mark.from, mark.to) === "]")
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
    // 普通点击仍然只是把光标放进链接、还原源码；修饰键点击才跳转，避免链接行无法编辑。
    eventHandlers: {
      mousedown(event: MouseEvent, view: EditorView) {
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return false
        const element = event.target instanceof Element ? event.target : null
        if (!element) return false
        const options = view.state.facet(livePreviewOptions)

        const wikiTarget = element.closest("[data-wiki-target]")?.getAttribute("data-wiki-target")
        const markdownNoteTarget = element.closest("[data-md-note-target]")?.getAttribute("data-md-note-target")
        const noteTarget = wikiTarget || markdownNoteTarget
        if (noteTarget) {
          event.preventDefault()
          options.onOpenWikiLink?.(noteTarget)
          return true
        }

        const href = element.closest("[data-md-href]")?.getAttribute("data-md-href")
        if (!href) return false
        event.preventDefault()
        openExternalLink(href, options)
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
