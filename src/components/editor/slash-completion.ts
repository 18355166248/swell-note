import { Prec } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import { INSERTABLE_BLOCKS, insertBlock, type InsertableBlockId } from "./block-insertion"

export function slashQuery(view: EditorView) {
  const selection = view.state.selection.main
  if (!selection.empty || view.composing || view.state.readOnly) return null
  const line = view.state.doc.lineAt(selection.head)
  const match = /^\s*\/([^\s/]*)$/.exec(view.state.sliceDoc(line.from, selection.head))
  if (!match) return null
  for (let node = syntaxTree(view.state).resolveInner(selection.head, -1); node; node = node.parent!) {
    if (["FencedCode", "CodeBlock", "InlineCode", "Link", "Image"].includes(node.name)) return null
  }
  // YAML 属性中的路径/日期不是命令；未闭合属性同样不唤出菜单。
  if (/^---\s*$/.test(view.state.doc.line(1).text)) {
    let end = view.state.doc.length
    for (let number = 2; number <= view.state.doc.lines; number++) if (/^(---|\.\.\.)\s*$/.test(view.state.doc.line(number).text)) { end = view.state.doc.line(number).to; break }
    if (selection.head <= end) return null
  }
  return { from: line.from, to: selection.head, query: match[1].toLocaleLowerCase() }
}

export const slashCompletion = Prec.highest(ViewPlugin.fromClass(class {
  private query: ReturnType<typeof slashQuery> = null
  private matches: typeof INSERTABLE_BLOCKS[number][] = []
  private selected = 0
  private dismissed = ""
  private disposed = false
  readonly dom: HTMLDivElement
  constructor(private view: EditorView) {
    this.dom = document.createElement("div")
    this.dom.className = "cm-block-completion"; this.dom.setAttribute("role", "listbox"); this.dom.setAttribute("aria-label", "插入内容"); this.dom.hidden = true
    view.dom.append(this.dom)
    this.refresh()
  }
  update(update: ViewUpdate) { if (update.docChanged || update.selectionSet || update.geometryChanged) this.refresh() }
  private signature(query: NonNullable<ReturnType<typeof slashQuery>>) { return `${query.from}:${query.to}:${query.query}` }
  refresh() {
    if (this.disposed) return
    const query = slashQuery(this.view)
    if (!query || this.signature(query) === this.dismissed) { this.dom.hidden = true; return }
    this.query = query
    this.matches = INSERTABLE_BLOCKS.filter((block) => block.keywords.toLocaleLowerCase().includes(query.query))
    this.selected = Math.min(this.selected, Math.max(0, this.matches.length - 1))
    this.dom.hidden = this.matches.length === 0
    if (this.dom.hidden) return
    this.render()
    // ViewPlugin 更新阶段不能读取 CodeMirror 布局；在测量阶段定位，避免菜单插件被异常停用。
    this.view.requestMeasure({
      key: this,
      read: (view) => ({ cursor: view.coordsAtPos(query.to), rect: view.dom.getBoundingClientRect(), height: this.dom.offsetHeight }),
      write: ({ cursor, rect, height }) => {
        if (!cursor || this.disposed || this.dom.hidden) return
        this.dom.style.left = `${Math.max(0, Math.min(cursor.left - rect.left, rect.width - 260))}px`
        this.dom.style.top = `${cursor.bottom + height + 8 > window.innerHeight ? Math.max(0, cursor.top - rect.top - height - 6) : cursor.bottom - rect.top + 6}px`
      },
    })
  }
  private render() {
    this.dom.replaceChildren(...this.matches.map((block, index) => {
      const button = document.createElement("button")
      button.type = "button"; button.textContent = block.label; button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(this.selected === index))
      button.addEventListener("pointerdown", (event) => event.preventDefault())
      button.addEventListener("click", () => this.accept(block.id))
      return button
    }))
    this.dom.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }
  accept(id = this.matches[this.selected]?.id as InsertableBlockId | undefined) {
    if (!id || !this.query || this.dom.hidden || this.view.composing) return false
    const current = slashQuery(this.view)
    if (!current || this.signature(current) !== this.signature(this.query)) return false
    this.dom.hidden = true
    return insertBlock(this.view, id, this.query)
  }
  keydown(event: KeyboardEvent) {
    // 中文候选确认不能同时确认菜单，保持输入法与普通 Markdown 输入的优先级。
    if (event.isComposing || event.keyCode === 229 || this.view.composing || this.dom.hidden) return false
    if (event.key === "Escape") { this.dismissed = this.query ? this.signature(this.query) : ""; this.dom.hidden = true; return true }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      this.selected = (this.selected + (event.key === "ArrowDown" ? 1 : -1) + this.matches.length) % this.matches.length
      this.render(); return true
    }
    return (event.key === "Enter" || event.key === "Tab") && this.accept()
  }
  destroy() { this.disposed = true; this.dom.remove() }
}, { eventHandlers: { keydown(event) { if (!this.keydown(event)) return false; event.preventDefault(); return true }, compositionstart() { this.dom.hidden = true; return false }, compositionend() { requestAnimationFrame(() => this.refresh()); return false } } }))
