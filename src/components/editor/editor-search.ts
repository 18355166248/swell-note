import { StateEffect, StateField, type EditorState } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import { findTextMatches, type TextSearchOptions, type TextSearchRange } from "@/services/markdown/text-search"
import { externalDocumentChange } from "./core/editor-control"

export type EditorSearchConfig = { query: string; caseSensitive?: boolean; wholeWord?: boolean; inSelection?: boolean }
export const beginEditorSearch = StateEffect.define<TextSearchRange | null>()
export const configureEditorSearch = StateEffect.define<EditorSearchConfig>()
export const endEditorSearch = StateEffect.define<void>()

type SearchState = { config: EditorSearchConfig; selectionRange: TextSearchRange | null; decorations: DecorationSet }

function searchDecorations(state: EditorState, config: EditorSearchConfig, selectionRange: TextSearchRange | null) {
  if (!config.query) return Decoration.none
  if (config.inSelection && !selectionRange) return Decoration.none
  const selection = state.selection.main
  return Decoration.set(findTextMatches(state.doc.toString(), config.query, {
    ...config, range: config.inSelection ? selectionRange ?? undefined : undefined,
  }).map((match) => Decoration.mark({ class: match.from === selection.from && match.to === selection.to ? "cm-note-find-current" : "cm-note-find-match" }).range(match.from, match.to)))
}

export const editorSearchState = StateField.define<SearchState>({
  create: () => ({ config: { query: "" }, selectionRange: null, decorations: Decoration.none }),
  update(value, transaction) {
    let { config, selectionRange } = value
    if (transaction.annotation(externalDocumentChange)) {
      // 历史恢复/远端整篇回写后的偏移已失去原选区含义，不能扩大成整篇替换。
      selectionRange = null
    } else if (transaction.docChanged && selectionRange) {
      // 固定最初的正文选区，随后随事务映射边界；查找自己的命中选区不能扩大替换范围。
      selectionRange = { from: transaction.changes.mapPos(selectionRange.from, -1), to: transaction.changes.mapPos(selectionRange.to, 1) }
    }
    for (const effect of transaction.effects) {
      if (effect.is(beginEditorSearch)) { selectionRange = effect.value; config = { query: "" } }
      if (effect.is(configureEditorSearch)) config = effect.value
      if (effect.is(endEditorSearch)) { selectionRange = null; config = { query: "" } }
    }
    if (!transaction.docChanged && !transaction.selection && config === value.config && selectionRange === value.selectionRange) return value
    return { config, selectionRange, decorations: searchDecorations(transaction.state, config, selectionRange) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export function editorSearchOptions(state: EditorState): TextSearchOptions {
  const search = state.field(editorSearchState, false)
  return search ? { ...search.config, range: search.config.inSelection ? search.selectionRange ?? { from: 0, to: 0 } : undefined } : {}
}

export function editorMatches(state: EditorState, query: string) {
  return findTextMatches(state.doc.toString(), query, editorSearchOptions(state))
}

// 网格 Widget 替换了整段源码，普通行内装饰画不到单元格。按源码范围标记匹配格，
// 只改独立属性与背景，不包裹文字、不抢表格选区；重绘/虚拟化后重新定位。
export const tableSearchHighlights = ViewPlugin.fromClass(class {
  private frame = 0
  private observer: MutationObserver
  constructor(private view: EditorView) {
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(view.contentDOM, { childList: true, subtree: true })
    this.schedule()
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.startState.field(editorSearchState) !== update.state.field(editorSearchState)) this.schedule()
  }
  private schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      const state = this.view.state, config = state.field(editorSearchState).config
      const matches = config.query ? editorMatches(state, config.query) : []
      const selected = state.selection.main
      const selectedMatch = matches.some((match) => match.from === selected.from && match.to === selected.to)
      for (const cell of this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-cell-display")) {
        const from = Number(cell.dataset.sourceFrom), to = Number(cell.dataset.sourceTo)
        // 命中按偏移排序，二分定位避免大表格每格都扫描整篇的全部命中。
        let low = 0, high = matches.length
        while (low < high) { const middle = (low + high) >>> 1; if (matches[middle].from < from) low = middle + 1; else high = middle }
        if (!matches[low] || matches[low].to > to) delete cell.dataset.noteFind
        else cell.dataset.noteFind = selectedMatch && selected.from >= from && selected.to <= to ? "current" : "match"
      }
    })
  }
  destroy() { this.observer.disconnect(); cancelAnimationFrame(this.frame) }
})
