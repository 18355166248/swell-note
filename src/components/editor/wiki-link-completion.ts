import type { Extension } from "@codemirror/state"
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"

export type WikiLinkSuggestion = {
  detail?: string
  markdown: string
  target: string
  title: string
}

export type WikiLinkQuery = {
  from: number
  query: string
  to: number
}

export function getWikiLinkQuery(lineText: string, lineFrom: number, cursor: number): WikiLinkQuery | null {
  const beforeCursor = lineText.slice(0, cursor - lineFrom)
  const match = beforeCursor.match(/\[\[([^\]|#]*)$/)
  if (!match) return null
  return { from: cursor - match[1].length - 2, query: match[1], to: cursor }
}

export function filterWikiLinkSuggestions(items: WikiLinkSuggestion[], query: string, limit = 8) {
  const normalized = query.trim().toLocaleLowerCase()
  return items
    .filter((item, index, source) => source.findIndex((candidate) => candidate.target === item.target) === index)
    .filter((item) => !normalized || `${item.title}\n${item.detail ?? ""}`.toLocaleLowerCase().includes(normalized))
    .sort((left, right) => {
      const leftStarts = left.title.toLocaleLowerCase().startsWith(normalized)
      const rightStarts = right.title.toLocaleLowerCase().startsWith(normalized)
      return Number(rightStarts) - Number(leftStarts) || left.title.localeCompare(right.title, "zh-CN")
    })
    .slice(0, limit)
}

export function wikiLinkCompletion(getSuggestions: () => WikiLinkSuggestion[]): Extension {
  const plugin = ViewPlugin.fromClass(class {
    private activeQuery: WikiLinkQuery | null = null
    private dismissedSignature = ""
    private matches: WikiLinkSuggestion[] = []
    private selected = 0
    readonly dom: HTMLDivElement

    constructor(readonly view: EditorView) {
      this.dom = document.createElement("div")
      this.dom.className = "cm-wiki-completion"
      this.dom.setAttribute("role", "listbox")
      this.dom.hidden = true
      view.dom.append(this.dom)
      this.refresh()
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.geometryChanged) this.refresh()
    }

    destroy() { this.dom.remove() }

    move(delta: number) {
      if (this.dom.hidden || this.matches.length === 0) return false
      this.selected = (this.selected + delta + this.matches.length) % this.matches.length
      this.render()
      return true
    }

    accept() {
      const suggestion = this.matches[this.selected]
      const query = this.activeQuery
      if (!suggestion || !query || this.dom.hidden) return false
      // `[[` 只作为快速唤出手势，确认后落盘为跨应用可读的标准 Markdown 链接。
      const insert = suggestion.markdown
      this.view.dispatch({
        changes: { from: query.from, insert, to: query.to },
        selection: { anchor: query.from + insert.length },
      })
      this.hide()
      return true
    }

    close() {
      if (this.dom.hidden || !this.activeQuery) return false
      this.dismissedSignature = this.signature(this.activeQuery)
      this.hide()
      return true
    }

    private refresh() {
      const selection = this.view.state.selection.main
      if (!selection.empty) return this.hide()
      const line = this.view.state.doc.lineAt(selection.head)
      const query = getWikiLinkQuery(line.text, line.from, selection.head)
      if (!query || this.signature(query) === this.dismissedSignature) return this.hide()
      this.dismissedSignature = ""
      this.activeQuery = query
      this.matches = filterWikiLinkSuggestions(getSuggestions(), query.query)
      this.selected = Math.min(this.selected, Math.max(0, this.matches.length - 1))
      if (this.matches.length === 0) return this.hide()

      const cursor = this.view.coordsAtPos(selection.head)
      const editorRect = this.view.dom.getBoundingClientRect()
      if (cursor) {
        this.dom.style.left = `${Math.max(0, Math.min(cursor.left - editorRect.left, editorRect.width - 320))}px`
        this.dom.style.top = `${cursor.bottom - editorRect.top + 6}px`
      }
      this.render()
      this.dom.hidden = false
      // 光标靠近视口底部时向上展开，避免候选列表被编辑区滚动容器裁掉。
      if (cursor && cursor.bottom + this.dom.offsetHeight + 8 > window.innerHeight) {
        this.dom.style.top = `${Math.max(0, cursor.top - editorRect.top - this.dom.offsetHeight - 6)}px`
      }
    }

    private render() {
      this.dom.replaceChildren(...this.matches.map((suggestion, index) => {
        const button = document.createElement("button")
        button.type = "button"
        button.setAttribute("role", "option")
        button.setAttribute("aria-selected", String(index === this.selected))
        button.innerHTML = `<strong></strong><small></small>`
        button.querySelector("strong")!.textContent = suggestion.title
        button.querySelector("small")!.textContent = suggestion.detail ?? suggestion.target
        button.addEventListener("mouseenter", () => { this.selected = index; this.render() })
        button.addEventListener("mousedown", (event) => {
          event.preventDefault()
          this.selected = index
          this.accept()
        })
        return button
      }))
      this.dom.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
    }

    private hide() {
      this.dom.hidden = true
      this.matches = []
      this.activeQuery = null
    }

    private signature(query: WikiLinkQuery) { return `${query.from}:${query.to}:${query.query}` }
  })

  return [
    plugin,
    EditorView.domEventHandlers({
      keydown(event, view) {
        const completion = view.plugin(plugin)
        if (!completion) return false
        if (event.key === "ArrowDown" && completion.move(1)) { event.preventDefault(); return true }
        if (event.key === "ArrowUp" && completion.move(-1)) { event.preventDefault(); return true }
        if ((event.key === "Enter" || event.key === "Tab") && completion.accept()) { event.preventDefault(); return true }
        if (event.key === "Escape" && completion.close()) { event.preventDefault(); return true }
        return false
      },
    }),
  ]
}
