import { isolateHistory } from "@codemirror/commands"
import { syntaxTree } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"
import { EditorView, WidgetType } from "@codemirror/view"

import { blockEditSessionKey, clearBlockEditDraft, readBlockEditDraft, writeBlockEditDraft } from "./block-edit-session"
import { MERMAID_THEME_VARIABLES, authorizeMermaidStyles } from "./mermaid-rendering"
import "katex/dist/katex.min.css"
import "./unified-rich-block.css"

export type UnifiedRichBlock = {
  expression: string
  from: number
  kind: "math" | "mermaid"
  source: string
  to: number
}

export type InlineMath = {
  expression: string
  from: number
  source: string
  to: number
}

const exactMathFence = /^\s*\$\$\s*$/
const singleLineMathBlock = /^\s*\$\$(\S(?:.*\S)?)\$\$\s*$/
const mermaidFence = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/i
const frontmatterFence = /^(?:---|\.\.\.)\s*$/

export type SourceRange = { from: number; to: number }

function isEscaped(text: string, index: number) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function isInsideParsedCode(state: EditorState, position: number) {
  const resolved = syntaxTree(state).resolveInner(position, 1)
  let node: typeof resolved | null = resolved
  for (; node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "InlineCode") return true
  }
  return false
}

function frontmatterRange(state: EditorState): SourceRange | null {
  if (state.doc.lines < 2 || !/^---\s*$/.test(state.doc.line(1).text)) return null
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    if (frontmatterFence.test(line.text)) return { from: 0, to: line.to }
  }
  return null
}

export function fencedCodeLanguage(state: EditorState, from: number, to: number): string | null {
  const firstLine = state.doc.lineAt(from)
  const lastLine = state.doc.lineAt(to)
  const opening = firstLine.text.match(/^\s*(`{3,}|~{3,})\s*([^\s`~]+)?(?:\s.*)?$/)
  if (!opening) return null
  const closing = lastLine.text.match(/^\s*(`{3,}|~{3,})\s*$/)
  // 未闭合的围栏继续显示源码，避免把用户正在输入的后续正文一起吞进预览块。
  if (!closing || opening[1][0] !== closing[1][0] || closing[1].length < opening[1].length) return null
  return opening[2]?.toLocaleLowerCase() ?? ""
}

function collectMermaidBlocks(state: EditorState, excluded: readonly SourceRange[]): UnifiedRichBlock[] {
  const blocks: UnifiedRichBlock[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return
      const firstLine = state.doc.lineAt(node.from)
      const lastLine = state.doc.lineAt(node.to)
      if (fencedCodeLanguage(state, node.from, node.to) !== "mermaid" || !mermaidFence.test(firstLine.text)) return false
      if (excluded.some((range) => node.from < range.to && node.to > range.from)) return false
      const contentFrom = Math.min(firstLine.to + 1, state.doc.length)
      const contentTo = Math.max(contentFrom, lastLine.from - 1)
      blocks.push({
        expression: state.sliceDoc(contentFrom, contentTo),
        from: firstLine.from,
        kind: "mermaid",
        source: state.sliceDoc(firstLine.from, lastLine.to),
        to: lastLine.to,
      })
      return false
    },
  })
  return blocks
}

function overlaps(blocks: readonly SourceRange[], from: number, to: number) {
  return blocks.some((block) => from < block.to && to > block.from)
}

function collectMathBlocks(state: EditorState, frontmatter: SourceRange | null): UnifiedRichBlock[] {
  const blocks: UnifiedRichBlock[] = []
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    if (frontmatter && line.from < frontmatter.to || isInsideParsedCode(state, line.from)) continue
    const oneLine = line.text.match(singleLineMathBlock)
    if (oneLine) {
      blocks.push({ expression: oneLine[1], from: line.from, kind: "math", source: line.text, to: line.to })
      continue
    }
    if (!exactMathFence.test(line.text)) continue
    for (let closingNumber = number + 1; closingNumber <= state.doc.lines; closingNumber += 1) {
      const closing = state.doc.line(closingNumber)
      if (!exactMathFence.test(closing.text)) continue
      const expressionFrom = Math.min(line.to + 1, state.doc.length)
      const expressionTo = Math.max(expressionFrom, closing.from - 1)
      blocks.push({
        expression: state.sliceDoc(expressionFrom, expressionTo),
        from: line.from,
        kind: "math",
        source: state.sliceDoc(line.from, closing.to),
        to: closing.to,
      })
      number = closingNumber
      break
    }
  }
  return blocks
}

const richBlockCache = new WeakMap<object, { blocks: UnifiedRichBlock[]; tree: object }>()

export function collectUnifiedRichBlocks(state: EditorState): UnifiedRichBlock[] {
  const tree = syntaxTree(state)
  const cached = richBlockCache.get(state.doc)
  // 选区、视口或只读状态变化不会改变 Text identity；语法树后台推进时 identity 会变，
  // 此时仍需重算围栏识别，避免缓存未完整解析的长文结果。
  if (cached?.tree === tree) return cached.blocks
  const frontmatter = frontmatterRange(state)
  const mathBlocks = collectMathBlocks(state, frontmatter)
  // 外层 $$ 数学块优先拥有整段范围；其中看似 Mermaid 的围栏只是公式原文，不能再生成重叠替换。
  const mermaidBlocks = collectMermaidBlocks(state, [...mathBlocks, ...(frontmatter ? [frontmatter] : [])])
  const blocks = [...mathBlocks, ...mermaidBlocks].sort((left, right) => left.from - right.from)
  richBlockCache.set(state.doc, { blocks, tree })
  return blocks
}

export function collectInlineMath(
  state: EditorState,
  from = 0,
  to = state.doc.length,
  blocks: readonly SourceRange[] = collectUnifiedRichBlocks(state),
): InlineMath[] {
  const formulas: InlineMath[] = []
  const frontmatter = frontmatterRange(state)
  const safeFrom = state.doc.lineAt(Math.max(0, Math.min(from, state.doc.length))).from
  const safeTo = state.doc.lineAt(Math.max(0, Math.min(to, state.doc.length))).to
  const text = state.sliceDoc(safeFrom, safeTo)
  for (let open = 0; open < text.length; open += 1) {
    if (text[open] !== "$" || text[open + 1] === "$" || isEscaped(text, open)) continue
    const absoluteOpen = safeFrom + open
    if (frontmatter && absoluteOpen < frontmatter.to || isInsideParsedCode(state, absoluteOpen) || overlaps(blocks, absoluteOpen, absoluteOpen + 1)) continue
    for (let close = open + 1; close < text.length && text[close] !== "\n"; close += 1) {
      if (text[close] !== "$" || text[close + 1] === "$" || isEscaped(text, close)) continue
      const expression = text.slice(open + 1, close)
      // 空公式和边缘空白保持源码，降低货币金额被误识别的概率。
      if (expression && expression.trim() === expression) {
        formulas.push({ expression, from: absoluteOpen, source: text.slice(open, close + 1), to: safeFrom + close + 1 })
        open = close
      }
      break
    }
  }
  return formulas
}

function currentTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function appendSourceFallback(host: HTMLElement, source: string, message: string) {
  host.dataset.renderState = "error"
  host.querySelectorAll(":scope > .cm-md-rich-result, :scope > .cm-md-rich-loading, :scope > .cm-md-rich-error, :scope > .cm-md-rich-source")
    .forEach((element) => element.remove())
  const status = document.createElement("span")
  status.className = "cm-md-rich-error"
  status.setAttribute("role", "status")
  status.textContent = message
  const code = document.createElement("code")
  code.className = "cm-md-rich-source"
  code.textContent = source
  // 错误只替换当前块的结果区，编辑入口仍保留，用户可以就地修正源码。
  host.prepend(status, code)
}

function stillOwnsSource(view: EditorView, from: number, to: number, source: string, host: HTMLElement) {
  return view.dom.isConnected && host.isConnected && view.state.sliceDoc(from, to) === source
}

function renderMath(host: HTMLElement, expression: string, source: string, displayMode: boolean, view: EditorView, from: number, to: number) {
  const output = document.createElement("span")
  output.className = "cm-md-rich-result"
  host.append(output)
  void import("katex").then(({ default: katex }) => {
    if (!stillOwnsSource(view, from, to, source, host)) return
    try {
      katex.render(expression, output, { displayMode, strict: "ignore", throwOnError: true, trust: false })
      host.dataset.renderState = "ready"
    } catch {
      appendSourceFallback(host, source, "公式语法有误")
    }
  }).catch(() => {
    if (stillOwnsSource(view, from, to, source, host)) appendSourceFallback(host, source, "公式暂时无法渲染")
  })
}

let mermaidRenderSequence = 0

function renderMermaid(host: HTMLElement, expression: string, source: string, view: EditorView, from: number, to: number) {
  const output = document.createElement("div")
  output.className = "cm-md-rich-result cm-md-rich-mermaid-result"
  output.setAttribute("role", "img")
  output.setAttribute("aria-label", "Mermaid 图表")
  const loading = document.createElement("span")
  loading.className = "cm-md-rich-loading"
  loading.setAttribute("role", "status")
  loading.textContent = "正在绘制图表…"
  host.append(output, loading)
  void import("mermaid").then(async ({ default: mermaid }) => {
    mermaid.initialize({
      securityLevel: "strict",
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: MERMAID_THEME_VARIABLES[currentTheme()],
    })
    const id = `noteEditorDiagram${++mermaidRenderSequence}`
    const { svg } = await mermaid.render(id, expression)
    // 渲染期间可能已经切换笔记或修改源码；旧 Promise 只能结束，不能回写新的块。
    if (!stillOwnsSource(view, from, to, source, host)) return
    output.innerHTML = svg
    authorizeMermaidStyles(output)
    loading.remove()
    host.dataset.renderState = "ready"
  }).catch(() => {
    if (stillOwnsSource(view, from, to, source, host)) {
      appendSourceFallback(host, source, "图表语法有误")
    }
  })
}

function editLabel(kind: "math" | "mermaid") {
  return kind === "math" ? "编辑公式源码" : "编辑图表源码"
}

/**
 * 打开的块编辑器登记表，按 EditorView 隔离。
 *
 * 公式 / mermaid 的编辑器是 Widget 自绘的 DOM，草稿只活在 Widget 实例里；宿主（编辑器适配层）
 * 在切换正文模式这类会回收 Widget 的时刻必须先把它提交回正文，否则没保存的内容会被静默丢掉。
 * 直接遍历 DOM 找按钮再模拟点击太脆（样式类一改就失效），这里给 Widget 自己登记一个提交入口。
 */
const openRichEditors = new WeakMap<EditorView, Set<{ commit: () => void; host: HTMLElement }>>()

function registerRichEditor(view: EditorView, host: HTMLElement, commit: () => void) {
  let open = openRichEditors.get(view)
  if (!open) {
    open = new Set()
    openRichEditors.set(view, open)
  }
  const entry = { commit, host }
  open.add(entry)
  return () => {
    open.delete(entry)
    if (open.size === 0) openRichEditors.delete(view)
  }
}

/**
 * 提交当前所有打开着的块编辑器草稿。切正文模式前调用：草稿进入正文，
 * 而不是随 Widget 一起被回收。
 */
export function commitOpenRichEditors(view: EditorView | undefined) {
  if (!view) return
  for (const entry of Array.from(openRichEditors.get(view) ?? [])) {
    // 已从 DOM 摘下的条目不再提交：它的宿主已消失，提交也无处可落。
    if (entry.host.isConnected) entry.commit()
  }
}

abstract class UnifiedRichWidget extends WidgetType {
  readonly readOnly: boolean

  constructor(
    readonly kind: "math" | "mermaid",
    readonly source: string,
    readonly expression: string,
    readonly from: number,
    readonly to: number,
    readonly view: EditorView,
    readonly block: boolean,
    readonly scope?: string,
  ) {
    super()
    this.readOnly = view.state.readOnly
  }

  eq(other: UnifiedRichWidget) {
    return other.kind === this.kind && other.source === this.source && other.from === this.from && other.to === this.to && other.block === this.block && other.readOnly === this.readOnly && other.scope === this.scope
  }

  toDOM() {
    const host = document.createElement(this.block ? "div" : "span")
    host.className = `cm-md-rich cm-md-rich-${this.kind}${this.block ? " cm-md-rich-block" : " cm-md-rich-inline"}`
    host.dataset.renderState = "loading"
    if (this.kind === "math") renderMath(host, this.expression, this.source, this.block, this.view, this.from, this.to)
    else renderMermaid(host, this.expression, this.source, this.view, this.from, this.to)
    const session = readBlockEditDraft(this.view, this.sessionKey())
    if (!this.readOnly) {
      host.append(this.createEditButton(host))
      if (session?.open) queueMicrotask(() => {
        if (host.isConnected && !host.querySelector(".cm-md-rich-editor")) this.openEditor(host)
      })
    } else if (session?.open) {
      const preserved = document.createElement("span")
      preserved.className = "cm-md-rich-draft-preserved"
      preserved.setAttribute("role", "status")
      preserved.textContent = "局部草稿已保留，解除只读后可继续编辑"
      host.append(preserved)
    }
    return host
  }

  private sessionKey() {
    return blockEditSessionKey(this.scope, this.kind, this.from)
  }

  private createEditButton(host: HTMLElement) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "cm-md-rich-edit"
    button.textContent = "编辑"
    button.setAttribute("aria-label", editLabel(this.kind))
    button.addEventListener("mousedown", (event) => event.preventDefault())
    button.addEventListener("click", (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (this.view.state.readOnly || host.querySelector(".cm-md-rich-editor")) return
      this.openEditor(host)
    })
    return button
  }

  private openEditor(host: HTMLElement) {
    const key = this.sessionKey()
    const saved = readBlockEditDraft(this.view, key)
    const session = saved ?? { draft: this.source, open: true, originalSource: this.source }
    session.open = true
    writeBlockEditDraft(this.view, key, session)
    const editor = document.createElement("span")
    editor.className = "cm-md-rich-editor"
    host.classList.add("cm-md-rich-editing")
    const input = document.createElement("textarea")
    input.value = session.draft
    input.rows = this.block ? Math.min(12, Math.max(3, session.draft.split("\n").length)) : 2
    input.setAttribute("aria-label", editLabel(this.kind))
    const actions = document.createElement("span")
    actions.className = "cm-md-rich-editor-actions"
    const save = document.createElement("button")
    save.type = "button"
    save.textContent = "保存"
    const cancel = document.createElement("button")
    cancel.type = "button"
    cancel.textContent = "取消"
    actions.append(save, cancel)
    const error = document.createElement("span")
    error.className = "cm-md-rich-editor-error"
    error.setAttribute("role", "alert")
    if (this.view.state.sliceDoc(this.from, this.to) !== session.originalSource) {
      error.textContent = "这段源码已发生变化，草稿仍保留；请取消后重新编辑。"
    }
    editor.append(input, error, actions)
    host.append(editor)
    // 先占位、再在 commit 定义之后登记：dismiss 里要注销，而 commit 又会经 dismiss 收尾。
    let unregisterEditor = () => {}
    const dismiss = (clear: boolean) => {
      unregisterEditor()
      if (clear) clearBlockEditDraft(this.view, key)
      editor.remove()
      host.classList.remove("cm-md-rich-editing")
    }
    const commit = () => {
      session.draft = input.value
      writeBlockEditDraft(this.view, key, session)
      if (this.view.state.readOnly) {
        error.textContent = "当前笔记已切换为只读，草稿已保留。"
        return
      }
      if (this.view.state.sliceDoc(this.from, this.to) !== session.originalSource) {
        error.textContent = "这段源码已发生变化，草稿仍保留；请取消后重新编辑。"
        return
      }
      if (input.value === session.originalSource) {
        dismiss(true)
        return
      }
      clearBlockEditDraft(this.view, key)
      this.view.dispatch({
        annotations: isolateHistory.of("full"),
        changes: { from: this.from, to: this.to, insert: input.value },
        userEvent: "input.rich-block",
      })
    }
    // 登记提交入口：切换正文模式会回收整个 Widget，宿主必须先经这里把草稿写回正文，
    // 否则没点「保存」的内容会静默消失。
    unregisterEditor = registerRichEditor(this.view, host, commit)
    save.addEventListener("mousedown", (event) => event.preventDefault())
    cancel.addEventListener("mousedown", (event) => event.preventDefault())
    save.addEventListener("click", commit)
    cancel.addEventListener("click", () => dismiss(true))
    input.addEventListener("input", () => {
      session.draft = input.value
      writeBlockEditDraft(this.view, key, session)
      error.textContent = this.view.state.sliceDoc(this.from, this.to) === session.originalSource
        ? ""
        : "这段源码已发生变化，草稿仍保留；请取消后重新编辑。"
    })
    input.addEventListener("keydown", (event) => {
      // 中文候选词确认阶段不响应保存/取消快捷键，避免把半成品写回 Markdown。
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === "Escape") {
        event.preventDefault()
        dismiss(true)
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        commit()
      }
    })
    input.focus({ preventScroll: true })
    input.select()
  }

  ignoreEvent() {
    return true
  }
}

export class InlineMathWidget extends UnifiedRichWidget {
  constructor(source: string, expression: string, from: number, to: number, view: EditorView, scope?: string) {
    super("math", source, expression, from, to, view, false, scope)
  }
}

export class UnifiedRichBlockWidget extends UnifiedRichWidget {
  constructor(block: UnifiedRichBlock, view: EditorView, scope?: string) {
    super(block.kind, block.source, block.expression, block.from, block.to, view, true, scope)
  }
}
