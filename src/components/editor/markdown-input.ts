import { copyLineDown, copyLineUp, indentLess, indentMore, moveLineDown, moveLineUp } from "@codemirror/commands"
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdownLanguage } from "@codemirror/lang-markdown"
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

function findEnclosingNode(node: MdSyntaxNode | null, from: number, to: number, name: string): MdSyntaxNode | null {
  while (node) {
    if (node.name === name && node.from <= from && node.to >= to) return node
    node = node.parent
  }
  return null
}

function findEnclosingMark(state: EditorState, from: number, to: number, name: string): MdSyntaxNode | null {
  return findEnclosingNode(syntaxTree(state).resolveInner(from, from === to ? -1 : 1), from, to, name)
}

// 三击选中「一行」时，浏览器给出的选区会带上行首的列表/引用标记和结尾的换行符——
// 照单包裹的话，标记会插进列表编号内部（"**1. 文字**" 变成 "**1. 文字\n**"，编号被劈开）。
// 这里把选区收缩到「这一行真正的内容」：掐掉尾随换行，跳过行首的结构前缀。
function shrinkToLineContent(state: EditorState, from: number, to: number) {
  while (to > from && state.doc.sliceString(to - 1, to) === "\n") to--
  const line = state.doc.lineAt(from)
  if (from === line.from) {
    const match = STRUCTURE_LINE.exec(line.text)
    if (match) from = Math.min(line.from + match[0].length, to)
  }
  return { from, to }
}

// 选区（或光标）已经落在对应的行内标记节点里时，Cmd+B 等快捷键与工具栏按钮应当「再点一次就取消」，
// 而不是在外面再套一层标记，否则连续按会越叠越多层。找不到对应节点时退回普通包裹。
export function toggleInlineMark(view: EditorView, kind: InlineMarkKind, placeholder: string): boolean {
  const { state } = view
  if (state.readOnly) return false
  const marker = INLINE_MARK_TOKENS[kind]
  const rawSelection = state.selection.main
  const node = findEnclosingMark(state, rawSelection.from, rawSelection.to, INLINE_MARK_NODE_NAMES[kind])

  if (node) {
    const inner = state.sliceDoc(node.from + marker.length, node.to - marker.length)
    // 选区哪怕连标记本身都框进去了，取消后也统一选中还原出来的纯文本，而不是留在标记消失后错位的位置。
    const unwrap = (position: number) => {
      const bounded = Math.min(Math.max(position, node.from + marker.length), node.to - marker.length)
      return bounded - marker.length
    }
    view.dispatch({
      changes: { from: node.from, to: node.to, insert: inner },
      selection: { anchor: unwrap(rawSelection.from), head: unwrap(rawSelection.to) },
      scrollIntoView: true,
    })
    view.focus()
    return true
  }

  const { from, to } = rawSelection.empty ? rawSelection : shrinkToLineContent(state, rawSelection.from, rawSelection.to)
  const selected = state.sliceDoc(from, to)
  const inserted = `${marker}${selected || placeholder}${marker}`
  view.dispatch({
    changes: { from, to, insert: inserted },
    selection: { anchor: from + inserted.length },
    scrollIntoView: true,
  })
  view.focus()
  return true
}

// Cmd+K 在空光标（没有选区）落在已有链接文字里时，此前会在光标处硬插一段新的
// [链接文字](https://)，把原链接的文字从中间劈开，拼出一段嵌套错乱的 Markdown。
// 这里改成直接把已有链接的 URL 部分选中，方便就地改地址；有选区时维持原来的包裹行为不变。
export function focusExistingLinkUrl(view: EditorView): boolean {
  const { state } = view
  const selection = state.selection.main
  if (!selection.empty) return false
  const link = findEnclosingMark(state, selection.from, selection.to, "Link")
  if (!link) return false
  for (let child = link.firstChild; child; child = child.nextSibling) {
    if (child.name !== "URL") continue
    view.dispatch({ selection: { anchor: child.from, head: child.to }, scrollIntoView: true })
    view.focus()
    return true
  }
  return false
}

// 链接面板读取 / 改写 [文字](地址) 共用的结构提取。source 记录原文，面板打开期间
// 正文若被改动，保存前先比对、对不上就拒绝覆盖；[[双链]]、引用式链接与图片都没有
// 可用的 URL 子节点或独立文字区间，统一返回 null 走各自原有路径。
// bracketed 记住原地址包在 <> 里（这种写法允许空格），title 记住原始提示段（含引号）——
// 面板不暴露这两个细节，但保存时必须原样补回，否则编辑一次就丢格式。
export type EditorLinkTarget = {
  bracketed?: boolean
  from: number
  label: string
  source: string
  title?: string
  to: number
  url: string
}

// 由 Link 语法节点提取面板所需的结构；slice 抽象掉「正文文档 / 单元格纯文本」两种来源。
// 图片（Image 节点）、行内代码、[[双链]] 与引用式链接都没有可编辑的 URL 子节点或
// 独立文字区间，返回 null 走各自原有路径。
function linkTargetFromNode(link: MdSyntaxNode, slice: (from: number, to: number) => string): EditorLinkTarget | null {
  let url: MdSyntaxNode | null = null
  let open: MdSyntaxNode | null = null
  let close: MdSyntaxNode | null = null
  let title: MdSyntaxNode | null = null
  for (let child = link.firstChild; child; child = child.nextSibling) {
    if (child.name === "URL") { url = child; continue }
    if (child.name === "LinkTitle") { title = child; continue }
    if (child.name !== "LinkMark") continue
    const text = slice(child.from, child.to)
    if (text === "[" && !open) open = child
    else if (text === "]") close = child
  }
  if (!url || !open || !close || close.from <= open.to) return null
  const rawUrl = slice(url.from, url.to)
  const bracketed = rawUrl.startsWith("<") && rawUrl.endsWith(">")
  return {
    bracketed: bracketed || undefined,
    from: link.from,
    label: slice(open.to, close.from),
    source: slice(link.from, link.to),
    title: title ? slice(title.from, title.to) : undefined,
    to: link.to,
    url: bracketed ? rawUrl.slice(1, -1) : rawUrl,
  }
}

export function linkTargetAt(state: EditorState, from: number, to: number): EditorLinkTarget | null {
  const link = findEnclosingMark(state, from, to, "Link")
  return link ? linkTargetFromNode(link, (a, b) => state.sliceDoc(a, b)) : null
}

// 移动端点按链接时上抛给宿主菜单的信息：target 供编辑/移除，href/noteTarget 供「打开」，
// hadFocus 记录点按瞬间编辑器是否持有焦点（菜单取消后据此决定是否归还焦点与键盘）。
export type EditorLinkTap = {
  hadFocus: boolean
  href?: string
  noteTarget?: string
  target: EditorLinkTarget
}

// 面板输入的地址原样进 Markdown：换行与尖括号直接破坏语法，空格与括号转义后才能稳定解析
// （与图片「更换」浮层的地址处理保持一致）。
export function sanitizeLinkUrl(url: string) {
  return url.trim().replace(/[ ()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function isValidLinkLabel(label: string) {
  return Boolean(label.trim()) && !/[[\]\n\r]/.test(label)
}

// 由面板输入构造 [文字](地址) 源码：原有 <> 写法与 title 段原样保留；
// 尖括号内空格合法所以不再转义，普通写法仍把空格/括号转义成稳定可解析的形式。
// 返回 null 表示输入不合法，调用方保留面板让用户修正。
export function linkInsertion(target: Pick<EditorLinkTarget, "bracketed" | "title"> | null, label: string, url: string): string | null {
  if (!isValidLinkLabel(label)) return null
  const trimmed = url.trim()
  if (!trimmed || /[\n\r<>]/.test(trimmed)) return null
  const href = target?.bracketed ? `<${trimmed}>` : sanitizeLinkUrl(trimmed)
  const title = target?.title ? ` ${target.title}` : ""
  return `[${label.trim()}](${href}${title})`
}

// 单元格 textarea 是纯文本、没有现成语法树，但解析规则必须与正文一致——
// 正则不认平衡括号（a_(b) 合法却解析失败）、分不清图片与行内代码里的链接文本，
// 所以直接用 Markdown 解析器解析单元格内容，限定真正的 Link 节点，与 linkTargetAt
// 返回同一种结构（from/to 相对于传入文本）。
export function linkTargetInText(text: string, from: number, to: number): EditorLinkTarget | null {
  const tree = markdownLanguage.parser.parse(text)
  const link = findEnclosingNode(tree.resolveInner(from, from === to ? -1 : 1), from, to, "Link")
  return link ? linkTargetFromNode(link, (a, b) => text.slice(a, b)) : null
}

// 保存链接：target 为 null 时在选区（或光标）处新建，否则校验原文未变后原位改写。
// 原选区（含光标）经变更映射保留下来——手机上从面板返回时不丢位置；
// 不请求 scrollIntoView：选区本来就在可视区里，多一次滚动请求反而可能让页面跳动。
export function applyLinkTarget(view: EditorView, target: EditorLinkTarget | null, label: string, url: string): boolean {
  const { state } = view
  if (state.readOnly) return false
  const inserted = linkInsertion(target, label, url)
  if (!inserted) return false
  if (target && state.sliceDoc(target.from, target.to) !== target.source) return false
  const range = target ?? state.selection.main
  const changes = state.changes({ from: range.from, to: range.to, insert: inserted })
  view.dispatch({
    changes,
    selection: state.selection.map(changes),
    userEvent: "input.link",
  })
  view.focus()
  return true
}

// 移除链接、保留文字；同样先校验原文，选区映射保留。
export function removeLinkTarget(view: EditorView, target: EditorLinkTarget): boolean {
  const { state } = view
  if (state.readOnly) return false
  if (state.sliceDoc(target.from, target.to) !== target.source) return false
  const changes = state.changes({ from: target.from, to: target.to, insert: target.label })
  view.dispatch({
    changes,
    selection: state.selection.map(changes),
    userEvent: "input.link",
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

// 块格式作用于完整行，不能从光标中间插入换行把一句话切断；选区恰好结束于下一行行首时不改那一行。
export function toggleBlockFormat(view: EditorView, template: string) {
  const prefix = /^\n(#{1,3} |> |- |- \[ \] )$/.exec(template)?.[1]
  if (!prefix) return false
  const { state } = view
  if (state.readOnly) return true
  const range = state.selection.main
  const first = state.doc.lineAt(range.from)
  const last = state.doc.lineAt(range.empty ? range.to : Math.max(range.from, range.to - 1))
  const lines = []
  for (let number = first.number; number <= last.number; number += 1) {
    const line = state.doc.line(number)
    // 代码与表格内的行首符号是内容，不能当作普通段落批量改写。
    let node: MdSyntaxNode | null = syntaxTree(state).resolveInner(line.from + line.text.search(/\S|$/), 1)
    let protectedLine = false
    for (; node; node = node.parent) {
      if (["FencedCode", "CodeBlock", "Table"].includes(node.name)) protectedLine = true
    }
    if (protectedLine || (!range.empty && !line.text.trim())) continue
    const indent = /^\s*/.exec(line.text)![0]
    const body = line.text.slice(indent.length)
    const mark = prefix.startsWith("#") ? /^#{1,6}\s+/.exec(body)?.[0] ?? ""
      : prefix === "> " ? /^> ?/.exec(body)?.[0] ?? ""
      : /^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.exec(body)?.[0] ?? ""
    const active = prefix === "- [ ] " ? /\[[ xX]\]/.test(mark)
      : prefix === "- " ? Boolean(mark) && !/\[[ xX]\]/.test(mark)
      : mark.trim() === prefix.trim()
    lines.push({ from: line.from + indent.length, mark, active })
  }
  const remove = lines.length > 0 && lines.every((line) => line.active)
  const changes = state.changes(lines.map(({ from, mark, active }) => ({
    from, to: from + mark.length,
    // 混合选区补齐格式时保留已完成任务的勾选状态和已有列表符号。
    insert: remove ? "" : active ? mark : prefix,
  })))
  view.dispatch({ changes, selection: state.selection.map(changes, 1), scrollIntoView: true, userEvent: "input.format" })
  view.focus()
  return true
}

export type EditorFormatState = {
  code: boolean
  emphasis: boolean
  heading: 0 | 1 | 2 | 3
  strike: boolean
  strong: boolean
}

// 工具栏高亮：汇报光标或选区当前的格式。行内格式要求选区被同一标记节点完整覆盖——
// 混合格式的选区（只有一部分文字加粗）判定为未激活，点击按钮再统一补齐；
// 标题要求选区覆盖的每个内容行都是同级 ATX 标题，代码块与表格行不参与判定。
export function detectFormatState(state: EditorState): EditorFormatState {
  const range = state.selection.main
  const markActive = (name: string) => findEnclosingMark(state, range.from, range.to, name) !== null

  const first = state.doc.lineAt(range.from)
  // 选区恰好结束于下一行行首时，该行不算入选区（与 toggleBlockFormat 的行范围一致）。
  const last = state.doc.lineAt(range.empty ? range.to : Math.max(range.from, range.to - 1))
  let heading: 0 | 1 | 2 | 3 = 0
  let checked = false
  for (let number = first.number; number <= last.number; number += 1) {
    const line = state.doc.line(number)
    if (!line.text.trim()) continue
    let node: MdSyntaxNode | null = syntaxTree(state).resolveInner(line.from + line.text.search(/\S|$/), 1)
    let protectedLine = false
    for (; node; node = node.parent) {
      if (["FencedCode", "CodeBlock", "Table"].includes(node.name)) protectedLine = true
    }
    const level = (protectedLine ? 0 : /^(#{1,3})\s/.exec(line.text)?.[1].length ?? 0) as 0 | 1 | 2 | 3
    if (!checked) {
      heading = level
      checked = true
    } else if (level !== heading) {
      heading = 0
      break
    }
  }

  return {
    code: markActive(INLINE_MARK_NODE_NAMES.code),
    emphasis: markActive(INLINE_MARK_NODE_NAMES.emphasis),
    heading: checked ? heading : 0,
    strike: markActive(INLINE_MARK_NODE_NAMES.strike),
    strong: markActive(INLINE_MARK_NODE_NAMES.strong),
  }
}
