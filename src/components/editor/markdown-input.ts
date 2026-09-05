import { copyLineDown, copyLineUp, indentLess, indentMore, moveLineDown, moveLineUp } from "@codemirror/commands"
import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown"
import { syntaxTree } from "@codemirror/language"
import { type ChangeSpec, EditorSelection, type EditorState, Prec, type Transaction } from "@codemirror/state"
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

// 只用到语法节点的结构信息，按结构声明以避免为类型引入 @lezer/common 显式依赖。
type MdSyntaxNode = {
  firstChild: MdSyntaxNode | null
  from: number
  name: string
  nextSibling: MdSyntaxNode | null
  parent: MdSyntaxNode | null
  to: number
}

function findOrderedList(state: EditorState, position: number): MdSyntaxNode | null {
  let node: MdSyntaxNode | null = syntaxTree(state).resolveInner(position, 1)
  while (node && node.name !== "OrderedList") node = node.parent
  return node
}

function firstListItemNumber(list: MdSyntaxNode, state: EditorState): number | null {
  for (let item = list.firstChild; item; item = item.nextSibling) {
    if (item.name !== "ListItem") continue
    const match = /^(\s*)(\d+)(?=[.)])/.exec(state.doc.sliceString(item.from, item.from + 12))
    return match ? Number(match[2]) : null
  }
  return null
}

// Alt+↑/↓ 移动、Shift+Alt+↑/↓ 复制整行是 CodeMirror 默认键位（basicSetup 自带，未在工具栏出现），
// 但它们只是逐行搬文本：有序列表项挪了位置或被复制一份，编号仍留在原处，读起来像「1. 2. 1.」错位。
// 命令跑完之后，从移动前记下的起始号开始，把同一个有序列表重新连续编号——
// 不能以移动后排在最前的那一项的号码为准，它未必是原来的首项。
function renumberChangesInOrderedList(state: EditorState, position: number, start: number): ChangeSpec[] {
  const node = findOrderedList(state, position)
  if (!node) return []

  const changes: ChangeSpec[] = []
  let expected = start
  for (let item = node.firstChild; item; item = item.nextSibling) {
    if (item.name !== "ListItem") continue
    const match = /^(\s*)(\d+)(?=[.)])/.exec(state.doc.sliceString(item.from, item.from + 12))
    if (!match) continue
    const [whole, leading, digits] = match
    if (Number(digits) !== expected) {
      changes.push({ from: item.from + leading.length, insert: String(expected), to: item.from + whole.length })
    }
    expected += 1
  }
  return changes
}

// 借官方命令算出的搬运/复制结果，再在同一个事务里追加编号修正，撤销时两步一起退回。
function withOrderedListRenumber(
  command: (target: { dispatch: (transaction: Transaction) => void; state: EditorState }) => boolean,
) {
  return (view: EditorView) => {
    const list = findOrderedList(view.state, view.state.selection.main.head)
    const start = list && firstListItemNumber(list, view.state)

    let moved: Transaction | null = null
    if (!command({ dispatch: (transaction) => { moved = transaction }, state: view.state })) return false
    if (!moved) return false
    const applied: Transaction = moved
    const fix = start === null ? [] : renumberChangesInOrderedList(applied.state, applied.state.selection.main.head, start)
    const moveSpec = { changes: applied.changes, scrollIntoView: true, selection: applied.state.selection, userEvent: "move.line" }
    // sequential: true 让第二个 spec 的 changes 按第一个 spec 生效后的文档坐标解释，否则会按原文档校验，位置全错。
    view.dispatch(view.state.update(...(fix.length ? [moveSpec, { changes: fix, sequential: true }] : [moveSpec])))
    return true
  }
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
    { key: "Alt-ArrowUp", run: withOrderedListRenumber(moveLineUp) },
    { key: "Alt-ArrowDown", run: withOrderedListRenumber(moveLineDown) },
    { key: "Shift-Alt-ArrowUp", run: withOrderedListRenumber(copyLineUp) },
    { key: "Shift-Alt-ArrowDown", run: withOrderedListRenumber(copyLineDown) },
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

// 加粗 / 斜体 / 删除线 / 行内代码：标记长度固定，节点范围一定包含标记本身（如 StrongEmphasis
// 首尾就是两个 EmphasisMark），换算「去掉标记后的位置」不用另外找标记子节点。
const INLINE_MARK_NODE_NAMES = { code: "InlineCode", emphasis: "Emphasis", strike: "Strikethrough", strong: "StrongEmphasis" } as const
const INLINE_MARK_TOKENS = { code: "`", emphasis: "*", strike: "~~", strong: "**" } as const
export type InlineMarkKind = keyof typeof INLINE_MARK_TOKENS

function findEnclosingMark(state: EditorState, from: number, to: number, name: string): MdSyntaxNode | null {
  let node: MdSyntaxNode | null = syntaxTree(state).resolveInner(from, from === to ? -1 : 1)
  while (node) {
    if (node.name === name && node.from <= from && node.to >= to) return node
    node = node.parent
  }
  return null
}

// 选区（或光标）已经落在对应的行内标记节点里时，Cmd+B 等快捷键与工具栏按钮应当「再点一次就取消」，
// 而不是在外面再套一层标记，否则连续按会越叠越多层。找不到对应节点时退回普通包裹。
export function toggleInlineMark(view: EditorView, kind: InlineMarkKind, placeholder: string): boolean {
  const { state } = view
  if (state.readOnly) return false
  const selection = state.selection.main
  const marker = INLINE_MARK_TOKENS[kind]
  const node = findEnclosingMark(state, selection.from, selection.to, INLINE_MARK_NODE_NAMES[kind])

  if (node) {
    const inner = state.sliceDoc(node.from + marker.length, node.to - marker.length)
    // 选区哪怕连标记本身都框进去了，取消后也统一选中还原出来的纯文本，而不是留在标记消失后错位的位置。
    const unwrap = (position: number) => {
      const bounded = Math.min(Math.max(position, node.from + marker.length), node.to - marker.length)
      return bounded - marker.length
    }
    view.dispatch({
      changes: { from: node.from, to: node.to, insert: inner },
      selection: { anchor: unwrap(selection.from), head: unwrap(selection.to) },
      scrollIntoView: true,
    })
    view.focus()
    return true
  }

  const selected = state.sliceDoc(selection.from, selection.to)
  const inserted = `${marker}${selected || placeholder}${marker}`
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: inserted },
    selection: { anchor: selection.from + inserted.length },
    scrollIntoView: true,
  })
  view.focus()
  return true
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
