import { syntaxTree } from "@codemirror/language"
import type { EditorState, Range } from "@codemirror/state"
import { Facet, StateEffect, StateField } from "@codemirror/state"
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view"

import { parseMarkdownNoteHref } from "@/services/markdown/markdown-preview-utils"

import { parseMarkdownTable } from "./markdown-table-model"
import type { TableInlineOptions } from "./markdown-table-inline"
import { TableWidget } from "./markdown-table-widget"

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
// keepRenderedOnRangeSelection 服务触摸端：见 collectCursorLines 的说明。
export type LivePreviewOptions = TableInlineOptions & {
  keepRenderedOnRangeSelection?: boolean
}

export { TableWidget }

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

function collectCursorLines(state: EditorState) {
  const keepRendered = state.facet(livePreviewOptions).keepRenderedOnRangeSelection === true
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    // 触摸端长按选词会一次覆盖整段：展开这些行的源码等于在选中瞬间改变行高，
    // 选区和贴着选区的操作条都会跟着跳。非空选区因此保持渲染态，光标态仍还原原始 Markdown。
    if (keepRendered && !range.empty) continue
    const from = state.doc.lineAt(Math.min(range.from, range.to)).number
    const to = state.doc.lineAt(Math.max(range.from, range.to)).number
    for (let number = from; number <= to; number += 1) lines.add(number)
  }
  return lines
}

// 装饰只关心「哪些行处于光标/选区内」；同一行内左右移动光标不会改变任何一条装饰，
// 拿它当签名就能把长笔记里最常见的光标移动挡在整篇重算之外。
function cursorLinesKey(state: EditorState) {
  return [...collectCursorLines(state)].join(",")
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

// 隐藏标记时把紧随其后的空格一起收进去，行首才不会留下一个孤零零的缩进。
function skipSpacesAfter(state: EditorState, position: number) {
  const line = state.doc.lineAt(position)
  let end = position
  while (end < line.to && state.sliceDoc(end, end + 1) === " ") end += 1
  return end
}

// 逐层下探收集引用块里的全部 QuoteMark；嵌套的引用块留给它自己那一轮处理，
// 否则内层的标记会被隐藏两次，也会绕开内层自己的光标判断。
function hideQuoteMarks(blockquote: MdSyntaxNode, hide: (node: MdSyntaxNode) => void) {
  for (let child = blockquote.firstChild; child; child = child.nextSibling) {
    if (child.name === "QuoteMark") hide(child)
    else if (child.name !== "Blockquote") hideQuoteMarks(child, hide)
  }
}

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

    // 后接 Markdown 目标的是历史混合图片语法，由图片装饰器统一接管。
    if (match[1] && state.sliceDoc(end, end + 1) === "(") continue
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

// 块级替换会把紧贴它两端的插入并进自己的范围：在表格末尾换行或补空行后，
// 新起的一行会被留在 Widget 里，既看不见也落不下光标。原文没变时 key 是相同的，
// 因此还要比对装饰的实际范围，错位就重建。
function tableDecorationsDrifted(state: EditorState, blocks: TableBlock[]) {
  const ranges: DocRange[] = []
  state.field(tableDecorationsField).between(0, state.doc.length, (from, to) => {
    ranges.push({ from, to })
  })
  if (ranges.length !== blocks.length) return true
  return blocks.some((block, index) => ranges[index].from !== block.from || ranges[index].to !== block.to)
}

function tableBlocksDecorations(blocks: TableBlock[], view: EditorView): DecorationSet {
  return Decoration.set(
    blocks.map((block, tableIndex) =>
      Decoration.replace({
        block: true,
        // 块级替换节点在不同浏览器中通过 posAtDOM 可能映射到范围末端，直接传递解析得到的源码起点。
        widget: new TableWidget(block.source, view, block.from, block.to, view.state.facet(livePreviewOptions), tableIndex),
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

// 装饰只在渲染出来的行上才有意义，但范围贴着视口切会让滚动时露出未渲染的源码。
// 上下各留一屏左右的缓冲，滚动落到缓冲区内时装饰已经就位，viewportChanged 再补下一批。
const DECORATION_BUFFER = 4000

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const isCursorActive = cursorLineChecker(view.state)
  const frontmatter = findFrontmatterRange(view.state)
  // 早期这里按整篇文档计算，33KB 的笔记每敲一个字就要重建整篇装饰集，
  // 连带 CodeMirror 重新套用 RangeSet 与重算行高，实测占掉按键开销的九成。
  // 编辑器自身不滚动，但 CodeMirror 会跟着外层 ScrollArea 更新 viewport，
  // 因此按可见范围加缓冲计算即可，滚动时由 viewportChanged 续算。
  const doc = view.state.doc
  const decorationRanges = view.visibleRanges.length > 0
    ? view.visibleRanges.map((range) => ({
        from: Math.max(0, range.from - DECORATION_BUFFER),
        to: Math.min(doc.length, range.to + DECORATION_BUFFER),
      }))
    : [{ from: 0, to: doc.length }]

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
  if (frontmatter) {
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

  for (const { from, to } of decorationRanges) {
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
            // 只隐藏 # 会把它后面那个空格留在行首，标题左边缘比正文缩进一格，字号越大越明显。
            if (headerMark) decorations.push(Decoration.replace({}).range(headerMark.from, skipSpacesAfter(view.state, headerMark.to)))
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
          case "CodeBlock": {
            // 四空格缩进的代码块此前没有任何装饰，在编辑态里和普通段落长得一样。
            decorateLines(node.from, node.to, "cm-md-codeblock")
            break
          }
          case "Blockquote": {
            decorateLines(node.from, node.to, "cm-md-quote")
            // 只有首行的 QuoteMark 是 Blockquote 的直接子节点，后续行的会被并进段落等子节点里，
            // 按直接子节点找会漏掉它们，第二行开始的 > 就一直露在外面。
            if (!active) hideQuoteMarks(node.node, hide)
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
            // TaskMarker 的前一个语法兄弟并不稳定，直接按当前行定位列表标记；仅隐藏 `- ` 等标记并保留嵌套缩进。
            const line = view.state.doc.lineAt(node.from)
            const prefix = view.state.sliceDoc(line.from, node.from)
            const listMarker = prefix.match(/(?:[-+*]|\d+[.)])\s+$/)
            if (listMarker?.index !== undefined) {
              decorations.push(Decoration.replace({}).range(line.from + listMarker.index, node.from))
            }
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
    cursorLinesKey: string

    constructor(view: EditorView) {
      this.cursorLinesKey = cursorLinesKey(view.state)
      this.decorations = buildLivePreviewDecorations(view)
      // 初次构建即提交表格装饰（构造期 dispatch 延迟到挂载后执行）。
      this.syncTableDecorations(view)
    }

    update(update: ViewUpdate) {
      // 语法树是后台增量解析出来的。编辑器如果在外层容器已经滚到深处时挂载（切回编辑态、
      // 恢复上次阅读位置、从大纲跳转都会这样），可见范围所在的那一段还没被解析，装饰算出来是空的；
      // 而解析器随后追上来时的更新既没有 docChanged 也没有 viewportChanged，
      // 不把它算进来的话，那一屏就会一直停在没有渲染的 Markdown 源码上。
      const parsed = syntaxTree(update.startState) !== syntaxTree(update.state)
      if (!update.docChanged && !update.viewportChanged && !update.selectionSet && !parsed) return
      // 文档没变、视口也没动时先比对光标行签名：同一行内移动光标不会改变任何装饰，
      // 直接沿用上一次的结果，长笔记里按方向键就不必重算。
      if (!update.docChanged && !update.viewportChanged && !parsed) {
        const nextCursorLinesKey = cursorLinesKey(update.state)
        if (nextCursorLinesKey === this.cursorLinesKey) return
        this.cursorLinesKey = nextCursorLinesKey
      } else {
        this.cursorLinesKey = cursorLinesKey(update.state)
      }
      this.decorations = buildLivePreviewDecorations(update.view)
      // 表格块只在文档变化或语法树推进时才可能增减；滚动不会改变它们，没必要跟着重扫一遍语法树。
      if (update.docChanged || parsed) this.syncTableDecorations(update.view)
    }

    destroy() {
      this.destroyed = true
    }

    // 表格装饰变化时经 effect 写入 StateField，内容不变则跳过，避免无意义的重绘。
    // 插件 update 期间不允许同步 dispatch，延迟到当前更新结束后提交。
    syncTableDecorations(view: EditorView) {
      const current = collectTableBlocks(view.state)
      if (tableBlocksKey(current) === this.tableBlocksKey && !tableDecorationsDrifted(view.state, current)) return
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
