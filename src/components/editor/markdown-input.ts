import { indentLess, indentMore } from "@codemirror/commands"
import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown"
import { EditorSelection, Prec } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"

// 选中文字后直接敲这些成对标记，就用它包裹选区而不是把选中的文字替换掉。
// 括号 / 引号已由 closeBrackets 处理，这里只补单字符即生效的 Markdown 标记：
// * 与 _ 是斜体、` 是行内代码。删除线要 ~~ 成对，单个 ~ 无意义，交给工具栏按钮。
const WRAP_MARKERS = new Set(["*", "_", "`"])

// 行首像「- 」「* 」「1. 」「> 」这类结构，Tab 才接管缩进；普通段落把 Tab 让给焦点移动。
const STRUCTURE_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s|>\s?)/

function wrapSelection(view: EditorView, marker: string) {
  const { state } = view
  if (state.readOnly || state.selection.ranges.every((range) => range.empty)) return false
  const transaction = state.changeByRange((range) => {
    if (range.empty) return { range }
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
    }
  })
  view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input.type.wrap" }))
  return true
}

// 光标在列表 / 引用行，或存在跨行选区时，Tab 缩进结构；否则不拦截，保留 Tab 的默认行为。
function shouldHandleIndent(view: EditorView) {
  const { state } = view
  const range = state.selection.main
  if (!range.empty) return true
  return STRUCTURE_LINE.test(state.doc.lineAt(range.head).text)
}

const markdownInputKeymap = Prec.high(
  keymap.of([
    // 官方命令：在列表 / 引用 / 任务项里回车续写标记，空项回车则删标记退出；普通段落回退到默认换行。
    { key: "Enter", run: insertNewlineContinueMarkup },
    // 删除续写出来的标记时一次退掉整段，而不是逐字符。
    { key: "Backspace", run: deleteMarkupBackward },
    {
      key: "Tab",
      run: (view) => (shouldHandleIndent(view) ? indentMore(view) : false),
      shift: (view) => (shouldHandleIndent(view) ? indentLess(view) : false),
    },
  ]),
)

const markdownWrapInput = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (text.length !== 1 || !WRAP_MARKERS.has(text)) return false
  return wrapSelection(view, text)
})

// 把 Markdown 手感相关的按键增强打包：列表续写、结构缩进、选区包裹。
export function markdownInputEnhancements() {
  return [markdownInputKeymap, markdownWrapInput]
}

// 单个 URL 粘到非空选区上时，包成 [选中文字](URL)。返回 true 表示已接管这次粘贴。
export function wrapSelectionAsLink(view: EditorView, url: string) {
  const trimmed = url.trim()
  if (view.state.readOnly || !/^(https?|mailto):\S+$/i.test(trimmed) || /\s/.test(trimmed)) return false
  const range = view.state.selection.main
  if (range.empty) return false
  const label = view.state.sliceDoc(range.from, range.to)
  if (/[\n\]]/.test(label)) return false
  const inserted = `[${label}](${trimmed})`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: inserted },
    selection: { anchor: range.from + inserted.length },
    scrollIntoView: true,
    userEvent: "input.paste",
  })
  return true
}
