import { syntaxTree } from "@codemirror/language"
import type { Range } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"

// Typora / Obsidian Live Preview 风格的即时渲染：
// 非光标行隐藏语法标记并直接呈现最终样式，光标进入该行时还原原始 Markdown 文本，源文件始终保持纯文本。

// 只用到语法节点的结构信息；这里按结构声明，避免为类型引入 @lezer/common 显式依赖。
type MdSyntaxNode = {
  firstChild: MdSyntaxNode | null
  from: number
  getChild(name: string): MdSyntaxNode | null
  name: string
  nextSibling: MdSyntaxNode | null
  prevSibling: MdSyntaxNode | null
  to: number
}

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

function collectCursorLines(view: EditorView) {
  const lines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const from = view.state.doc.lineAt(Math.min(range.from, range.to)).number
    const to = view.state.doc.lineAt(Math.max(range.from, range.to)).number
    for (let number = from; number <= to; number += 1) lines.add(number)
  }
  return lines
}

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const cursorLines = collectCursorLines(view)
  // 节点跨多行时，只要任一行处于选区就保持原样，避免只隐藏一半标记。
  const isCursorActive = (from: number, to: number) => {
    const fromLine = view.state.doc.lineAt(from).number
    const toLine = view.state.doc.lineAt(to).number
    for (let number = fromLine; number <= toLine; number += 1) {
      if (cursorLines.has(number)) return true
    }
    return false
  }

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

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
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
        }
      },
    })
  }

  return Decoration.set(decorations, true)
}

export const markdownLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLivePreviewDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
