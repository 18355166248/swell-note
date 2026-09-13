import { isolateHistory } from "@codemirror/commands"
import { syntaxTree } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"
import { EditorView, WidgetType } from "@codemirror/view"
import { lazy, Suspense, useEffect, useReducer, useState, type KeyboardEvent, type MouseEvent } from "react"
import { createRoot, type Root } from "react-dom/client"

import type { VaultAsset } from "@/services/vault/vault-adapter"

import type { EmbeddedWikiNoteResult } from "./markdown-preview"
import "./compatibility-blocks.css"

const MarkdownPreview = lazy(() => import("./markdown-preview"))

type CompatibilityBlockBase = {
  from: number
  source: string
  to: number
}

export type FrontmatterCompatibilityBlock = CompatibilityBlockBase & {
  kind: "frontmatter"
}

export type CalloutCompatibilityBlock = CompatibilityBlockBase & {
  calloutType: string
  fold: "+" | "-" | null
  kind: "callout"
  title: string
}

export type WikiEmbedCompatibilityBlock = CompatibilityBlockBase & {
  kind: "wiki-embed"
  target: string
}

export type CompatibilityBlock =
  | FrontmatterCompatibilityBlock
  | CalloutCompatibilityBlock
  | WikiEmbedCompatibilityBlock

export type CompatibilityBlockOptions = {
  assetScope?: string
  onLoadWikiNote?: (target: string) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  onResolveWikiNote?: (target: string) => EmbeddedWikiNoteResult
}

const frontmatterFencePattern = /^---\s*$/
const calloutMarkerPattern = /^ {0,3}>[ \t]*\[!([\w-]+)\]([+-])?(?:[ \t]+([^\n]+))?\s*$/i
const standaloneWikiEmbedPattern = /^\s*!\[\[([^\[\]\n]+)\]\]\s*$/
const fileExtensionPattern = /\.[a-z\d]{1,8}$/i

type ParentSyntaxNode = { name: string; parent: ParentSyntaxNode | null }

function findFrontmatterBlock(state: EditorState): FrontmatterCompatibilityBlock | null {
  if (state.doc.lines < 2 || !frontmatterFencePattern.test(state.doc.line(1).text)) return null
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const closing = state.doc.line(number)
    if (!frontmatterFencePattern.test(closing.text)) continue
    const first = state.doc.line(1)
    return {
      from: first.from,
      kind: "frontmatter",
      source: state.sliceDoc(first.from, closing.to),
      to: closing.to,
    }
  }
  // 未闭合的 YAML 很可能仍在输入，保持源码可见，避免把后续正文一起替换掉。
  return null
}

function collectCalloutBlocks(state: EditorState): CalloutCompatibilityBlock[] {
  const blocks: CalloutCompatibilityBlock[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Blockquote") return
      const firstLine = state.doc.lineAt(node.from)
      const marker = firstLine.text.match(calloutMarkerPattern)
      if (!marker) return
      const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1))
      const source = state.sliceDoc(firstLine.from, lastLine.to)
      blocks.push({
        calloutType: marker[1].toLocaleLowerCase(),
        fold: marker[2] === "+" || marker[2] === "-" ? marker[2] : null,
        from: firstLine.from,
        kind: "callout",
        source,
        title: marker[3]?.trim() || marker[1],
        to: lastLine.to,
      })
      // 整块会被一个 Widget 接管，内部嵌套引用不能再产生重叠的块级装饰。
      return false
    },
  })
  return blocks
}

function isInsideCode(state: EditorState, position: number) {
  let node: ParentSyntaxNode | null = syntaxTree(state).resolveInner(position, 1)
  for (; node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "InlineCode") return true
  }
  return false
}

function isWikiNoteTarget(target: string) {
  const noteTarget = target.split("#", 1)[0].trim()
  if (!noteTarget) return true
  const path = noteTarget.replace(/[?#].*$/, "")
  return !fileExtensionPattern.test(path) || /\.md$/i.test(path)
}

function collectWikiEmbedBlocks(state: EditorState): WikiEmbedCompatibilityBlock[] {
  const blocks: WikiEmbedCompatibilityBlock[] = []
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    const match = line.text.match(standaloneWikiEmbedPattern)
    if (!match || isInsideCode(state, line.from)) continue
    // 别名只控制显示文字；解析和跳转始终使用竖线前的真实目标。
    const target = match[1].split("|", 1)[0].trim()
    if (!target || !isWikiNoteTarget(target)) continue
    blocks.push({ from: line.from, kind: "wiki-embed", source: line.text, target, to: line.to })
  }
  return blocks
}

function overlaps(left: CompatibilityBlockBase, right: CompatibilityBlockBase) {
  return left.from < right.to && left.to > right.from
}

export function collectCompatibilityBlocks(state: EditorState): CompatibilityBlock[] {
  const frontmatter = findFrontmatterBlock(state)
  const candidates: CompatibilityBlock[] = [
    ...(frontmatter ? [frontmatter] : []),
    ...collectCalloutBlocks(state),
    ...collectWikiEmbedBlocks(state),
  ].sort((left, right) => left.from - right.from || right.to - left.to)

  // CodeMirror 不允许块级 replace 彼此交叠；外层块优先，内部兼容语法交给 MarkdownPreview 递归渲染。
  const blocks: CompatibilityBlock[] = []
  for (const candidate of candidates) {
    if (!blocks.some((block) => overlaps(block, candidate))) blocks.push(candidate)
  }
  return blocks
}

const missingWikiNote = (): EmbeddedWikiNoteResult => ({ status: "missing" })
const ignoreWikiLoad = () => undefined
const ignoreWikiLink = () => undefined
const missingAsset = () => Promise.resolve(null)

function CompatibilityPreview({ block, options }: { block: CompatibilityBlock; options: CompatibilityBlockOptions }) {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  const wikiStatus = block.kind === "wiki-embed"
    ? (options.onResolveWikiNote ?? missingWikiNote)(block.target).status
    : null

  useEffect(() => {
    if (block.kind !== "wiki-embed" || wikiStatus !== "loading") return
    // Vault 加载回调沿用阅读态的 fire-and-forget 接口；短轮询只负责在缓存就绪后刷新本 Widget。
    const timer = window.setInterval(refresh, 250)
    return () => window.clearInterval(timer)
  }, [block, wikiStatus])

  return (
    <Suspense fallback={<div className="cm-md-compat-loading" role="status">正在加载兼容内容…</div>}>
      <MarkdownPreview
        assetScope={options.assetScope}
        content={block.source}
        key={wikiStatus ?? block.kind}
        onLoadWikiNote={options.onLoadWikiNote ?? ignoreWikiLoad}
        onResolveAsset={options.onResolveAsset ?? missingAsset}
        onResolveWikiNote={options.onResolveWikiNote ?? missingWikiNote}
        // 不传 onToggleTask：嵌入子笔记中的任务只展示，绝不能按宿主源码行号改写当前笔记。
        onWikiLink={options.onOpenWikiLink ?? ignoreWikiLink}
      />
    </Suspense>
  )
}

function editLabel(kind: CompatibilityBlock["kind"]) {
  if (kind === "frontmatter") return "编辑 YAML 属性源码"
  if (kind === "callout") return "编辑 Callout 源码"
  return "编辑嵌入引用源码"
}

function CompatibilityBlockView({ block, options, readOnly, view }: {
  block: CompatibilityBlock
  options: CompatibilityBlockOptions
  readOnly: boolean
  view: EditorView
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(block.source)
  const [sourceSnapshot, setSourceSnapshot] = useState(block.source)
  const [error, setError] = useState("")
  const sourceConflict = editing && block.source !== sourceSnapshot

  const openEditor = () => {
    if (view.state.readOnly) return
    setDraft(block.source)
    setSourceSnapshot(block.source)
    setError("")
    setEditing(true)
  }
  const cancel = () => {
    setDraft(block.source)
    setSourceSnapshot(block.source)
    setError("")
    setEditing(false)
    view.focus()
  }
  const save = () => {
    if (view.state.readOnly) {
      setError("当前笔记已切换为只读，未保存修改。")
      return
    }
    // 块前方的插入只会移动范围，可以安全沿用草稿；块自身变化则必须拒绝覆盖新正文。
    if (sourceConflict || view.state.sliceDoc(block.from, block.to) !== sourceSnapshot) {
      setError("这段源码已发生变化，请取消后重新编辑。")
      return
    }
    if (draft === sourceSnapshot) {
      cancel()
      return
    }
    view.dispatch({
      annotations: isolateHistory.of("full"),
      changes: { from: block.from, to: block.to, insert: draft },
      userEvent: "input.compatibility-block",
    })
    setEditing(false)
    view.focus()
  }
  const stopMouseDown = (event: MouseEvent) => event.preventDefault()
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法确认候选时不能顺带保存或取消，避免半成品覆盖原 Markdown。
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === "Escape") {
      event.preventDefault()
      cancel()
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    }
  }

  return (
    <>
      <div className="cm-md-compat-result" hidden={editing && !readOnly}><CompatibilityPreview block={block} options={options} /></div>
      {!readOnly && !editing ? <button aria-label={editLabel(block.kind)} className="cm-md-compat-edit" onClick={openEditor} onMouseDown={stopMouseDown} type="button">编辑</button> : null}
      {editing && !readOnly ? (
        <div className="cm-md-compat-editor">
          <textarea
            aria-label={editLabel(block.kind)}
            autoFocus
            onChange={(event) => { setDraft(event.target.value); setError("") }}
            onKeyDown={handleKeyDown}
            rows={Math.min(14, Math.max(3, draft.split("\n").length))}
            value={draft}
          />
          {sourceConflict || error ? <p role="alert">{sourceConflict ? "这段源码已发生变化，请取消后重新编辑。" : error}</p> : null}
          <div className="cm-md-compat-editor-actions">
            <button onClick={cancel} onMouseDown={stopMouseDown} type="button">取消</button>
            <button onClick={save} onMouseDown={stopMouseDown} type="button">保存</button>
          </div>
        </div>
      ) : null}
    </>
  )
}

const widgetRoots = new WeakMap<HTMLElement, Root>()

function renderWidgetRoot(host: HTMLElement, widget: CompatibilityBlockWidget) {
  // CodeMirror 可能在外层 React 提交期间创建/更新 Widget；排到微任务避免嵌套 React root 更新警告。
  queueMicrotask(() => {
    const root = widgetRoots.get(host)
    if (!root) return
    root.render(<CompatibilityBlockView block={widget.block} options={widget.options} readOnly={widget.readOnly} view={widget.view} />)
  })
}

export class CompatibilityBlockWidget extends WidgetType {
  readonly readOnly: boolean

  constructor(
    readonly block: CompatibilityBlock,
    readonly options: CompatibilityBlockOptions,
    readonly view: EditorView,
  ) {
    super()
    this.readOnly = view.state.readOnly
  }

  eq(other: CompatibilityBlockWidget) {
    return other.block.kind === this.block.kind
      && other.block.from === this.block.from
      && other.block.to === this.block.to
      && other.block.source === this.block.source
      && other.readOnly === this.readOnly
  }

  toDOM() {
    const host = document.createElement("section")
    host.className = `cm-md-compat cm-md-compat-${this.block.kind}`
    host.dataset.compatibilityKind = this.block.kind
    const root = createRoot(host)
    widgetRoots.set(host, root)
    renderWidgetRoot(host, this)
    return host
  }

  updateDOM(dom: HTMLElement) {
    if (dom.dataset.compatibilityKind !== this.block.kind || !widgetRoots.has(dom)) return false
    // 同类型块只更新最新范围/只读态/渲染参数，React 组件实例不换，未保存草稿得以跨重配保留。
    renderWidgetRoot(dom, this)
    return true
  }

  destroy(dom: HTMLElement) {
    const root = widgetRoots.get(dom)
    widgetRoots.delete(dom)
    // destroy 也可能发生在父 React 的提交阶段，同步 unmount 会触发嵌套 root 警告。
    if (root) queueMicrotask(() => root.unmount())
  }

  ignoreEvent() {
    return true
  }
}
