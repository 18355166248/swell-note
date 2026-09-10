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

// 加粗 / 斜体 / 删除线 / 行内代码共用一套「按语义作用范围」的规则，正文 CodeMirror
// 与表格单元格 textarea 走同一份实现（单元格走 inlineMarkEditInText，用同一解析器）：
// · 空光标：落在标记里就整段取消；否则插入占位文字并选中占位，直接输入即可覆盖。
// · 选区罩住标记内全部内容：整段取消；只选中一部分：把这部分从标记里拆出来，
//   左右两侧保持原格式（「**甲乙丙丁**」选中「乙丙」取消 →「**甲**乙丙**丁**」）。
// · 选区跨段落：按语法树把每个可格式化的块（段落、标题文字、列表项正文、引用行）
//   独立包裹；空行、列表编号、代码块围栏、表格不当普通正文，保证写出的源码仍是合法
//   Markdown（在首尾只套一组星号会被空行打断配对，渲染不出来）。
// · 选区碰到半截同种标记：先把旧标记剥掉再整体包裹，避免拼出断裂的星号串。
const INLINE_MARK_NODE_NAMES = { code: "InlineCode", emphasis: "Emphasis", strike: "Strikethrough", strong: "StrongEmphasis" } as const
const INLINE_MARK_TOKENS = { code: "`", emphasis: "*", strike: "~~", strong: "**" } as const
export type InlineMarkKind = keyof typeof INLINE_MARK_TOKENS

// 一次行内格式操作的结果：一组按文档顺序的替换 + 操作后的选区（新文档坐标）。
export type InlineMarkEdit = {
  changes: { from: number; to: number; insert: string }[]
  selection: { anchor: number; head: number }
}

// 语法树的最小结构约定：正文用 syntaxTree(state)，单元格用 markdownLanguage.parser.parse(text)，
// 两者都是 lezer 树，节点名与结构一致。
type MdTree = {
  resolveInner: (position: number, side?: -1 | 0 | 1) => MdSyntaxNode
  topNode: MdSyntaxNode
}

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

// 行内代码的围栏长度取自真实的 CodeMark 子节点：合法代码跨度可以用多个反引号
// （如 ``a`b``），不能用固定常量 1 去切片，否则取消格式时会残留半个分隔符。
function markLengths(node: MdSyntaxNode, kind: InlineMarkKind): { open: number; close: number } {
  const marker = INLINE_MARK_TOKENS[kind]
  if (kind !== "code") return { open: marker.length, close: marker.length }
  let open = marker.length
  let close = marker.length
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== "CodeMark") continue
    if (child.from === node.from) open = child.to - child.from
    if (child.to === node.to) close = child.to - child.from
  }
  return { open, close }
}

// 新标记的包裹符：行内代码按正文里最长的反引号串决定围栏长度；正文以反引号开头或
// 结尾时按 CommonMark 规则补一个空格，保证渲染回去可见内容不变。
function wrapPair(kind: InlineMarkKind, content: string): { open: string; close: string } {
  const marker = INLINE_MARK_TOKENS[kind]
  if (kind !== "code") return { open: marker, close: marker }
  let longest = 0
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  const fence = "`".repeat(longest + 1)
  const pad = content.startsWith("`") || content.endsWith("`") ? " " : ""
  return { open: fence + pad, close: pad + fence }
}

// 节点的「内容区间」：去掉首尾的标记子节点（EmphasisMark / StrikethroughMark /
// CodeMark 等，名字都以 Mark 结尾）。
function contentBounds(node: MdSyntaxNode): { from: number; to: number } {
  const children: MdSyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child)
  let from = node.from
  let to = node.to
  for (const child of children) {
    if (child.from === from && child.name.endsWith("Mark")) from = child.to
    else break
  }
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index]
    if (child.to === to && child.name.endsWith("Mark")) to = child.from
    else break
  }
  return { from, to }
}

// 链接/图片的「标签内容区间」：开始标记（[ 或 ![）之后、结束方括号 ] 之前。
// 链接在语法树上 ]( 、URL 、) 是独立子节点，用 contentBounds 会把 ](url 也算进
// 标签，格式标记就插进了 URL——标签只能到 ] 为止。
function labelBounds(node: MdSyntaxNode): { from: number; to: number } {
  let from = node.from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from === node.from && child.name.endsWith("Mark")) { from = child.to; continue }
    if (child.name.endsWith("Mark")) return { from, to: child.from }
  }
  return { from, to: node.to }
}

// 可以安全拆开再重开的嵌套节点；行内代码、自动链接等原子的内容是字面量，拆不开。
const SPLITTABLE_NESTED_NAMES = new Set(["Emphasis", "Strikethrough", "StrongEmphasis"])

// 链接/图片的标签内容可以携带格式，拆分点落在标签里时标记推进标签内部即可，
// 结构部分（[、](url)、![）由 serializeInlineRange 原样保留。
const LABEL_CONTAINER_NAMES = new Set(["Link", "Image"])

// 拆分点穿过的「字面量原子」（行内代码、自动链接、转义、实体等）：内容不能只在
// 一部分上加减格式，切点落在内部时要整颗原子一起参与。链接/图片的标签内容可切，
// 不算原子。返回 null 表示切点不在任何原子内部。
function atomAt(node: MdSyntaxNode, position: number): MdSyntaxNode | null {
  let found: MdSyntaxNode | null = null
  const visit = (current: MdSyntaxNode) => {
    if (found) return
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (position <= child.from || position >= child.to) continue
      if (child.name.endsWith("Mark") || child.name === "CodeText") continue
      if (LABEL_CONTAINER_NAMES.has(child.name) || SPLITTABLE_NESTED_NAMES.has(child.name)) { visit(child); return }
      found = child
      return
    }
  }
  visit(node)
  return found
}

// 收集拆分点穿过「内容区」的嵌套格式节点（外层在前），用于在一侧闭合、另一侧重开。
// 标记节点与代码正文是透明的；链接/图片只穿过标签内容，本身不闭合重开。
function nestedCutAt(node: MdSyntaxNode, position: number): MdSyntaxNode[] {
  const nodes: MdSyntaxNode[] = []
  const visit = (current: MdSyntaxNode) => {
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (position <= child.from || position >= child.to) continue
      if (child.name.endsWith("Mark") || child.name === "CodeText") continue
      if (LABEL_CONTAINER_NAMES.has(child.name)) { visit(child); continue }
      if (!SPLITTABLE_NESTED_NAMES.has(child.name)) continue
      const inner = contentBounds(child)
      if (position > inner.from && position < inner.to) nodes.push(child)
      visit(child)
    }
  }
  visit(node)
  return nodes
}

// 把 node 内容区的 [a,b) 重建为可独立存在的文本：open/close 包住每段连续内容，
// 边界空白留在标记外侧（标记贴空格无法形成合法分隔符，见复核 R5）；链接/图片被
// 部分覆盖时结构标记保持原文、标记推进标签内容区（见复核 R4）。
function serializeInlineRange(text: string, node: MdSyntaxNode, a: number, b: number, open: string, close: string): string {
  const wrapRun = (from: number, to: number): string => {
    const raw = text.slice(from, to)
    // 空白含软换行；换行后的引用结构前缀（> ）同样留在标记外侧，不能包进格式
    // （复核 R7：只处理空格/Tab 会让换行留在标记内侧，分隔符无法配对）。
    const lead = /^(?:[ \t]+|[ \t]*\n[ \t]*(?:>[ \t]?)*[ \t]*)/.exec(raw)?.[0] ?? ""
    const rest = raw.slice(lead.length)
    const trail = /(?:[ \t]+|[ \t]*\n[ \t]*(?:>[ \t]?)*[ \t]*)$/.exec(rest)?.[0] ?? ""
    const core = rest.slice(0, rest.length - trail.length)
    if (!core) return raw
    return lead + open + core + close + trail
  }
  const build = (container: MdSyntaxNode, from: number, to: number): string => {
    let out = ""
    let runFrom = from
    const walk = (parent: MdSyntaxNode) => {
      for (let child = parent.firstChild; child && child.from < to; child = child.nextSibling) {
        if (child.to <= runFrom) continue
        const coveredFrom = Math.max(child.from, from)
        const coveredTo = Math.min(child.to, to)
        if (coveredFrom <= child.from && coveredTo >= child.to) continue // 完整覆盖：留在原文段里
        if (LABEL_CONTAINER_NAMES.has(child.name)) {
          if (runFrom < coveredFrom) out += wrapRun(runFrom, coveredFrom)
          const label = labelBounds(child)
          const prefixTo = Math.min(Math.max(label.from, coveredFrom), coveredTo)
          out += text.slice(coveredFrom, prefixTo)
          const labelFrom = Math.max(label.from, coveredFrom)
          const labelTo = Math.min(label.to, coveredTo)
          if (labelFrom < labelTo) out += build(child, labelFrom, labelTo)
          const suffixFrom = Math.max(label.to, coveredFrom)
          if (suffixFrom < coveredTo) out += text.slice(suffixFrom, coveredTo)
          runFrom = coveredTo
          if (coveredTo >= to) return
        } else if (SPLITTABLE_NESTED_NAMES.has(child.name)) {
          walk(child) // 部分覆盖的可拆嵌套节点：深入找被部分覆盖的链接/图片
        }
        // 其余（原子、标记子节点）：留在原文段里
      }
    }
    walk(container)
    if (runFrom < to) out += wrapRun(runFrom, to)
    return out
  }
  return build(node, a, b)
}

// 收集 node 后代里所有标记子节点（各层 Mark）的区间。
function collectMarkRanges(node: MdSyntaxNode, out: { from: number; to: number }[] = []): { from: number; to: number }[] {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name.endsWith("Mark")) out.push({ from: child.from, to: child.to })
    else collectMarkRanges(child, out)
  }
  return out
}

// [from,to) 这段文字是否完全由标记字符（各层 Mark 子节点）构成、没有真实正文。
// 比如 ***加粗文字*** 里取消斜体时，中间选区两侧的「文字」其实只剩加粗标记，
// 这时拆分出来的左右片段只是空壳标记对，整段取消才是干净的结果。
function onlyMarksBetween(node: MdSyntaxNode, from: number, to: number): boolean {
  const marks = collectMarkRanges(node)
  let position = from
  for (const mark of marks) {
    if (mark.from <= position && mark.to > position) position = mark.to
  }
  return position >= to
}

// 代码块、表格、水平线等块的内容不是普通正文，行内格式不能穿进去。
const SKIP_BLOCK_NAMES = new Set(["CodeBlock", "FencedCode", "HTMLBlock", "HorizontalRule", "Table"])

// 把选区拆成一组「可格式化正文段」：段落与标题的正文部分；引用、列表等容器递归到
// 其中的段落。空行、列表编号、引用符号、标题的 # 前缀都被排除在段外。
function collectSegments(root: MdSyntaxNode, text: string, from: number, to: number, out: { from: number; to: number }[]) {
  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.to <= from || node.from >= to) continue
    if (SKIP_BLOCK_NAMES.has(node.name)) continue
    if (node.name === "Paragraph" || node.name.startsWith("SetextHeading")) {
      let contentTo = node.to
      if (node.name.startsWith("SetextHeading")) {
        // Setext 标题（实际节点名是 SetextHeading1/2）的下划线行是标记不是正文。
        const breakAt = text.lastIndexOf("\n", node.to - 1)
        if (breakAt >= node.from && /^\s*(=+|-+)\s*$/.test(text.slice(breakAt + 1, node.to))) contentTo = breakAt
      }
      pushSegment(out, text, Math.max(from, node.from), Math.min(to, contentTo))
      continue
    }
    if (/^ATXHeading/.test(node.name)) {
      const headingText = text.slice(node.from, node.to)
      // 起始的 # 前缀是块标记；结尾的闭合 # 序列（前面有空格）同样是标记，都不是正文。
      const prefix = /^ {0,3}#{1,6}\s+/.exec(headingText)?.[0].length ?? 0
      const closing = /\s+#+\s*$/.exec(headingText)?.[0].length ?? 0
      pushSegment(out, text, Math.max(from, node.from + prefix), Math.min(to, node.to - closing))
      continue
    }
    collectSegments(node, text, from, to, out)
  }
}

function pushSegment(out: { from: number; to: number }[], text: string, from: number, to: number) {
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  if (from < to) out.push({ from, to })
}

// 收集与区间相交的同种标记节点，供「先剥旧标记再整体包裹」使用。
function collectIntersecting(root: MdSyntaxNode, from: number, to: number, name: string, out: MdSyntaxNode[]) {
  if (root.name === name && root.from < to && root.to > from) { out.push(root); return }
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue
    collectIntersecting(child, from, to, name, out)
  }
}

// 手动映射选区端点（单元格 textarea 场景没有 ChangeDesc 可用）。
// assoc -1 站在替换内容之前，+1 站到替换内容之后。
function mapPosition(changes: { from: number; to: number; insert: string }[], position: number, assoc: -1 | 1): number {
  let offset = 0
  for (const change of changes) {
    if (position < change.from) break
    const delta = change.insert.length - (change.to - change.from)
    if (position > change.to) { offset += delta; continue }
    if (assoc < 0) return change.from + offset
    return change.to + offset + delta
  }
  return position + offset
}

// 行内格式操作的核心：输入（文本、语法树、选区、格式种类），输出替换与选区。
// 返回 null 表示选区内没有任何可格式化的正文段（比如只框住了代码块），不做改动。
function computeInlineMarkEdit(
  tree: MdTree,
  text: string,
  anchorPos: number,
  headPos: number,
  kind: InlineMarkKind,
  placeholder: string,
): InlineMarkEdit | null {
  const nodeName = INLINE_MARK_NODE_NAMES[kind]
  const from = Math.min(anchorPos, headPos)
  const to = Math.max(anchorPos, headPos)
  const backward = anchorPos > headPos
  const directed = (anchor: number, head: number) => (backward ? { anchor: head, head: anchor } : { anchor, head })
  const findNode = (segFrom: number, segTo: number) =>
    findEnclosingNode(tree.resolveInner(segFrom, segFrom === segTo ? -1 : 1), segFrom, segTo, nodeName)

  // 整段取消：选区（或光标）映射到还原出的纯文本上。
  const fullUnwrap = (node: MdSyntaxNode, selFrom: number, selTo: number): InlineMarkEdit => {
    const lens = markLengths(node, kind)
    const innerFrom = node.from + lens.open
    const innerTo = node.to - lens.close
    const inner = text.slice(innerFrom, innerTo)
    const unwrap = (position: number) => Math.min(Math.max(position, innerFrom), innerTo) - lens.open
    return { changes: [{ from: node.from, to: node.to, insert: inner }], selection: directed(unwrap(selFrom), unwrap(selTo)) }
  }

  // 空光标：在标记里就整段取消；否则插入占位文字并选中占位，直接输入即可覆盖。
  if (from === to) {
    const node = findNode(from, to)
    if (node) return fullUnwrap(node, from, to)
    const { open, close } = wrapPair(kind, placeholder)
    return {
      changes: [{ from, to, insert: open + placeholder + close }],
      selection: { anchor: from + open.length, head: from + open.length + placeholder.length },
    }
  }

  const segments: { from: number; to: number }[] = []
  collectSegments(tree.topNode, text, from, to, segments)
  if (segments.length === 0) return null

  // 包裹一段：选区碰到（但没完全包住）的同种标记先剥掉再整体包裹。
  // 返回替换范围与新内容里「正文部分」的区间（供选区保留用）。
  const wrapRange = (segFrom: number, segTo: number) => {
    const nodes: MdSyntaxNode[] = []
    collectIntersecting(tree.topNode, segFrom, segTo, nodeName, nodes)
    let expFrom = segFrom
    let expTo = segTo
    for (const node of nodes) {
      expFrom = Math.min(expFrom, node.from)
      expTo = Math.max(expTo, node.to)
    }
    let inner = ""
    let cursor = expFrom
    for (const node of nodes) {
      const lens = markLengths(node, kind)
      inner += text.slice(cursor, node.from) + text.slice(node.from + lens.open, node.to - lens.close)
      cursor = node.to
    }
    inner += text.slice(cursor, expTo)
    const { open, close } = wrapPair(kind, inner)
    return {
      change: { from: expFrom, to: expTo, insert: open + inner + close },
      innerFrom: expFrom + open.length,
      innerTo: expFrom + open.length + inner.length,
    }
  }

  if (segments.length === 1) {
    const segment = segments[0]
    const node = findNode(segment.from, segment.to)
    if (node) {
      const lens = markLengths(node, kind)
      const innerFrom = node.from + lens.open
      const innerTo = node.to - lens.close
      if (segment.from <= innerFrom && segment.to >= innerTo) return fullUnwrap(node, segment.from, segment.to)
      // 只选中一部分：把这部分从标记里拆出来，左右两侧保持原格式。
      let f = Math.max(segment.from, innerFrom)
      let t = Math.min(segment.to, innerTo)
      // 切点落在行内代码/自动链接等原子内部时推到原子边界：原子内容是字面量，
      // 只能整颗参与格式增减（链接/图片的标签内容可切，不在此列）。
      const atomF = atomAt(node, f)
      if (atomF) f = atomF.from
      const atomT = atomAt(node, t)
      if (atomT) t = atomT.to
      // CommonMark 分隔符规则：闭合标记「前面是标点、后面是文字」不能闭合，
      // 开始标记「后面是标点、前面是文字」不能开始（**甲，**乙**。丙** 这类写法
      // 会让操作静默失效，见复核 R5）。切点落在这种位置时没有合法写法能让边界
      // 标点保持原格式，只能把标点并进中间段一起取消。标点分类与解析器一致——
      // @lezer/markdown 用 /[\p{S}|\p{P}]/u，$ + = 等符号同样算标点（复核 R6）；
      // 格式标记字符（*、] 等）不算——它们相邻时分隔符会自然合并，不需要挪动。
      const isPunct = (ch: string | undefined) => !!ch && /^[\p{S}\p{P}]$/u.test(ch)
      const isWord = (ch: string | undefined) => !!ch && !/\s/.test(ch) && !isPunct(ch)
      const markRanges = collectMarkRanges(node)
      const inMark = (position: number) => markRanges.some((range) => position >= range.from && position < range.to)
      while (f > innerFrom && !inMark(f - 1) && isPunct(text[f - 1]) && isWord(text[f])) f--
      while (t < innerTo && !inMark(t) && isPunct(text[t]) && isWord(text[t - 1])) t++
      if (f >= t) return fullUnwrap(node, segment.from, segment.to)
      // 选区两侧剩下的只有其他格式的标记字符、没有真实正文（典型：***加粗文字***
      // 选中全部文字取消斜体）时，拆分只会产出空壳标记对；整段取消更干净，
      // 嵌套的加粗等格式原样保留。
      if (onlyMarksBetween(node, innerFrom, f) && onlyMarksBetween(node, t, innerTo)) {
        return fullUnwrap(node, segment.from, segment.to)
      }
      // 拆分点穿过嵌套格式时，被穿过的嵌套节点在一侧闭合、另一侧重开，选区外的
      // 嵌套格式原样保留；链接/图片不闭合重开，标记推进标签内容区。
      const cutAtF = nestedCutAt(node, f)
      const cutAtT = nestedCutAt(node, t)
      const nodeOpen = text.slice(node.from, innerFrom)
      const nodeClose = text.slice(innerTo, node.to)
      const opens = (nodes: MdSyntaxNode[]) => nodes.map((n) => text.slice(n.from, contentBounds(n).from)).join("")
      const closes = (nodes: MdSyntaxNode[]) => nodes.map((n) => text.slice(contentBounds(n).to, n.to)).reverse().join("")
      const left = serializeInlineRange(text, node, innerFrom, f, nodeOpen, closes(cutAtF) + nodeClose)
      const middle = serializeInlineRange(text, node, f, t, opens(cutAtF), closes(cutAtT))
      const right = serializeInlineRange(text, node, t, innerTo, nodeOpen + opens(cutAtT), nodeClose)
      const insert = left + middle + right
      // 选区映射到中间段的正文上（边界空白与软换行被挪到了标记外侧，要跳过）。
      const middleText = text.slice(f, t)
      const middleLead = /^(?:[ \t]+|[ \t]*\n[ \t]*(?:>[ \t]?)*[ \t]*)/.exec(middleText)?.[0].length ?? 0
      const middleTrail = /(?:[ \t]+|[ \t]*\n[ \t]*(?:>[ \t]?)*[ \t]*)$/.exec(middleText.slice(middleLead))?.[0].length ?? 0
      const middleFrom = node.from + left.length + opens(cutAtF).length + middleLead
      const middleLen = Math.max(0, middleText.length - middleLead - middleTrail)
      return {
        changes: [{ from: node.from, to: node.to, insert }],
        selection: directed(middleFrom, middleFrom + middleLen),
      }
    }
    const wrapped = wrapRange(segment.from, segment.to)
    return { changes: [wrapped.change], selection: directed(wrapped.innerFrom, wrapped.innerTo) }
  }

  // 跨段落：每段独立处理。每段都已被同种标记完整覆盖 → 全部取消；否则给未覆盖的段补标记。
  const covered = segments.map((segment) => {
    const node = findNode(segment.from, segment.to)
    if (!node) return null
    const lens = markLengths(node, kind)
    return segment.from <= node.from + lens.open && segment.to >= node.to - lens.close ? node : null
  })
  if (covered.every((node) => node !== null)) {
    const changes = (covered as MdSyntaxNode[]).map((node) => {
      const lens = markLengths(node, kind)
      return { from: node.from, to: node.to, insert: text.slice(node.from + lens.open, node.to - lens.close) }
    })
    return { changes, selection: directed(mapPosition(changes, from, -1), mapPosition(changes, to, 1)) }
  }
  const changes = segments
    .map((segment, index) => (covered[index] ? null : wrapRange(segment.from, segment.to).change))
    .filter((change): change is { from: number; to: number; insert: string } => change !== null)
  return { changes, selection: directed(mapPosition(changes, from, -1), mapPosition(changes, to, 1)) }
}

// Cmd+B 等快捷键与工具栏按钮：非空选区操作完成后选区保留在内容上（连续点第二个
// 按钮仍作用于同一段文字），空光标行为见 computeInlineMarkEdit 的光标分支。
export function toggleInlineMark(view: EditorView, kind: InlineMarkKind, placeholder: string): boolean {
  const { state } = view
  if (state.readOnly) return false
  const selection = state.selection.main
  const edit = computeInlineMarkEdit(syntaxTree(state), state.doc.toString(), selection.anchor, selection.head, kind, placeholder)
  if (!edit) return false
  view.dispatch({ changes: edit.changes, selection: edit.selection, scrollIntoView: true })
  view.focus()
  return true
}

// 单元格 textarea 是纯文本、没有现成语法树：用同一解析器解析后走同一份规则，
// 正文与表格对同样的输入、选区和操作给出同样的结果（linkTargetInText 也是这条路）。
export function inlineMarkEditInText(text: string, from: number, to: number, kind: InlineMarkKind, placeholder: string): InlineMarkEdit | null {
  return computeInlineMarkEdit(markdownLanguage.parser.parse(text), text, from, to, kind, placeholder)
}

// 单元格工具栏高亮：与正文 detectFormatState 同一套语义判断，
// 不再靠「左右紧邻字符」猜——加粗的两个星号不会再被误判成斜体。
export function detectInlineMarksInText(text: string, from: number, to: number): { code: boolean; emphasis: boolean; strike: boolean; strong: boolean } {
  const tree = markdownLanguage.parser.parse(text)
  const active = (name: string) => findEnclosingNode(tree.resolveInner(from, from === to ? -1 : 1), from, to, name) !== null
  return {
    code: active(INLINE_MARK_NODE_NAMES.code),
    emphasis: active(INLINE_MARK_NODE_NAMES.emphasis),
    strike: active(INLINE_MARK_NODE_NAMES.strike),
    strong: active(INLINE_MARK_NODE_NAMES.strong),
  }
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
