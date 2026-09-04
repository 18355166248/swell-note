import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { syntaxTree } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import type { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

import { readClipboardText, writeClipboardText } from "@/services/clipboard/clipboard-text"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import { scrollCursorIntoView } from "./cursor-visibility"
import { markdownLivePreview } from "./live-preview"
import { wikiLinkCompletion, type WikiLinkSuggestion } from "./wiki-link-completion"
import "./markdown-table.css"

export type MarkdownEditorHandle = {
  collapseSelection: () => void
  copySelection: () => Promise<boolean>
  cutSelection: () => Promise<boolean>
  focus: () => void
  findText: (query: string, direction?: "next" | "previous", fromStart?: boolean) => MarkdownFindResult
  insertText: (text: string) => void
  // 与阅读态互换视图时用来对齐阅读位置：一个按屏幕坐标问行号，一个把指定行顶到可视区顶端。
  lineAtViewportTop: (clientY: number) => number | null
  pasteAtSelection: () => Promise<boolean>
  redo: () => void
  replaceAll: (query: string, replacement: string) => number
  replaceCurrent: (query: string, replacement: string) => MarkdownFindResult
  revealLine: (line: number) => void
  scrollLineToTop: (line: number) => boolean
  selectAll: () => void
  undo: () => void
}

export type MarkdownFindResult = {
  current: number
  total: number
}

type MarkdownEditorProps = {
  compact?: boolean
  onChange: (value: string) => void
  onCursorChange?: (line: number, column: number) => void
  onInsertFiles?: (files: File[]) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  onSelectionChange?: (hasSelection: boolean) => void
  getWikiLinkSuggestions?: () => WikiLinkSuggestion[]
  readOnly?: boolean
  storageKey?: string
  value: string
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ compact = false, getWikiLinkSuggestions, onChange, onCursorChange, onInsertFiles, onOpenWikiLink, onResolveAsset, onSelectionChange, readOnly = false, storageKey, value }, ref) {
    const editorRef = useRef<ReactCodeMirrorRef>(null)

    // CodeMirror 的扩展数组一旦换引用就会整体重配置（语言也会重新解析）；
    // 调用方传入的回调多为内联函数，用 ref 中转后扩展只在只读状态切换时重建。
    const handlers = useRef({ getWikiLinkSuggestions, onCursorChange, onInsertFiles, onOpenWikiLink, onResolveAsset, onSelectionChange })
    useEffect(() => {
      handlers.current = { getWikiLinkSuggestions, onCursorChange, onInsertFiles, onOpenWikiLink, onResolveAsset, onSelectionChange }
    })

    // 切换笔记会按 key 重建编辑器，卸载时要撤回选区状态，新笔记才不会带着上一篇的选区操作条打开。
    useEffect(() => () => handlers.current.onSelectionChange?.(false), [])

    useEffect(() => {
      const viewport = window.visualViewport
      if (!compact || !viewport) return
      // 键盘升起会把可视区压掉一半，此前落在下半屏的光标就藏到了键盘后面。
      // 布局要等 --keyboard-inset 写入后才是最终高度，所以推迟一帧再量。
      let frame = 0
      const follow = () => {
        frame = 0
        const view = editorRef.current?.view
        if (view?.hasFocus) scrollCursorIntoView(view)
      }
      const schedule = () => {
        if (frame) return
        frame = requestAnimationFrame(follow)
      }
      viewport.addEventListener("resize", schedule)
      return () => {
        if (frame) cancelAnimationFrame(frame)
        viewport.removeEventListener("resize", schedule)
      }
    }, [compact])

    const extensions = useMemo(() => [
      // GFM 基座：表格、删除线与任务列表才能进入语法树，供语法高亮与即时渲染装饰使用。
      // codeLanguages 让围栏代码块按 info 字符串套用对应语言的高亮，与阅读态保持一致；
      // 各语言由官方的 language-data 按需动态加载，不写代码块的笔记不会为此付出代价。
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      markdownLivePreview({
        keepRenderedOnRangeSelection: compact,
        onOpenWikiLink: (target) => handlers.current.onOpenWikiLink?.(target),
        onResolveAsset: (source) => handlers.current.onResolveAsset?.(source) ?? Promise.resolve(null),
        tableStorageKey: storageKey,
      }),
      wikiLinkCompletion(() => handlers.current.getWikiLinkSuggestions?.() ?? []),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return
        const position = update.state.selection.main.head
        const line = update.state.doc.lineAt(position)
        handlers.current.onCursorChange?.(line.number, position - line.from + 1)
        handlers.current.onSelectionChange?.(!update.state.selection.main.empty)
        // 打字打到可视区边缘、或光标跳到远处时同样要跟过去，否则又落到键盘后面。
        if (compact && update.view.hasFocus) scrollCursorIntoView(update.view)
      }),
      EditorView.domEventHandlers({
        // CodeMirror 的选区不随失焦清空：点走标题输入框后选区高亮已经没了，
        // 选区操作条却会继续占着底部，所以焦点变化时同步汇报一次。
        blur() {
          handlers.current.onSelectionChange?.(false)
          return false
        },
        focus(_event, view) {
          handlers.current.onSelectionChange?.(!view.state.selection.main.empty)
          return false
        },
        // 正文以表格结尾时，点最后一块下方的空白本该在表格后面接着写，
        // 但紧邻表格的那一行会被 Markdown 并进表格，先补出空行再落光标。
        // 其余情况交给 CodeMirror 自己定位，拖选等原生行为保持不变。
        mousedown(event, view) {
          if (event.button !== 0 || event.shiftKey || event.target !== view.contentDOM) return false
          if (view.state.readOnly) return false
          const lastBlock = view.lineBlockAt(view.state.doc.length)
          if (event.clientY <= view.documentTop + lastBlock.bottom) return false
          const separator = paragraphSeparatorAtEnd(view.state)
          if (!separator) return false
          event.preventDefault()
          const end = view.state.doc.length
          view.dispatch({
            changes: { from: end, insert: separator },
            scrollIntoView: true,
            selection: { anchor: end + separator.length },
          })
          view.focus()
          return true
        },
        drop(event) {
          const onInsertFiles = handlers.current.onInsertFiles
          const files = collectTransferFiles(event.dataTransfer)
          if (!onInsertFiles || readOnly || files.length === 0) return false
          event.preventDefault()
          onInsertFiles(files)
          return true
        },
        paste(event) {
          // 截图与图片文件的剪贴板不带纯文本；Excel 等来源同时带文本时仍按普通粘贴处理。
          const onInsertFiles = handlers.current.onInsertFiles
          const files = collectTransferFiles(event.clipboardData)
          if (!onInsertFiles || readOnly || files.length === 0) return false
          if (event.clipboardData?.getData("text/plain")) return false
          event.preventDefault()
          onInsertFiles(files)
          return true
        },
        keydown(event, view) {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return false
          const key = event.key.toLocaleLowerCase()
          if (key === "s") {
            // 文档变化已实时进入本地工作副本；拦截浏览器“保存网页”即可避免误操作。
            event.preventDefault()
            return true
          }
          if (key !== "b" && key !== "i") return false
          event.preventDefault()
          const selection = view.state.selection.main
          const marker = key === "b" ? "**" : "*"
          const selected = view.state.sliceDoc(selection.from, selection.to)
          const inserted = `${marker}${selected || (key === "b" ? "加粗文字" : "斜体文字")}${marker}`
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: inserted },
            selection: { anchor: selection.from + inserted.length },
          })
          return true
        },
      }),
    ], [compact, readOnly, storageKey])

    useImperativeHandle(ref, () => ({
      collapseSelection() {
        const view = editorRef.current?.view
        if (!view || view.state.selection.main.empty) return
        // 不抢焦点：点空白与点标题输入框都会走到这里，抢回来会把刚给出去的焦点又夺走。
        view.dispatch({ selection: { anchor: view.state.selection.main.head } })
      },
      async copySelection() {
        const view = editorRef.current?.view
        const selected = readSelectedText(view)
        if (!selected) return false
        return writeClipboardText(selected)
      },
      async cutSelection() {
        const view = editorRef.current?.view
        const selected = readSelectedText(view)
        if (!view || readOnly || !selected) return false
        // 先确认内容已进入剪贴板再删除；复制失败时保留原文，避免这段文字既没被复制又已经没了。
        if (!await writeClipboardText(selected)) return false
        const selection = view.state.selection.main
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: "" },
          selection: { anchor: selection.from },
        })
        view.focus()
        return true
      },
      focus() {
        editorRef.current?.view?.focus()
      },
      findText(query, direction = "next", fromStart = false) {
        return findTextInView(editorRef.current?.view, query, direction, fromStart)
      },
      insertText(text) {
        const view = editorRef.current?.view
        if (!view || readOnly || !text) return

        // 格式工具栏优先包装当前选区；没有选区时才插入带占位文案的模板。
        const selection = view.state.selection.main
        const selected = view.state.sliceDoc(selection.from, selection.to)
        const formatted = formatToolbarText(text, selected)
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: formatted.text },
          selection: formatted.selection
            ? { anchor: selection.from + formatted.selection.from, head: selection.from + formatted.selection.to }
            : { anchor: selection.from + formatted.text.length },
          scrollIntoView: true,
        })
        view.focus()
      },
      lineAtViewportTop(clientY) {
        const view = editorRef.current?.view
        if (!view) return null
        // 编辑器本身不滚动，可视区由外层容器决定，所以按屏幕坐标反查位置而不是读编辑器的滚动量。
        const bounds = view.contentDOM.getBoundingClientRect()
        const position = view.posAtCoords({ x: bounds.left + 1, y: clientY + 1 }, false)
        return position === null ? null : view.state.doc.lineAt(position).number
      },
      async pasteAtSelection() {
        const view = editorRef.current?.view
        if (!view || readOnly) return false
        const text = await readClipboardText()
        if (!text) return false
        const selection = view.state.selection.main
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: text },
          selection: { anchor: selection.from + text.length },
          scrollIntoView: true,
        })
        view.focus()
        return true
      },
      redo() {
        dispatchHistoryShortcut(editorRef.current?.view, true)
      },
      replaceAll(query, replacement) {
        const view = editorRef.current?.view
        if (!view || readOnly || !query) return 0
        const matches = findPlainTextMatches(view.state.doc.toString(), query)
        if (matches.length === 0) return 0
        // CodeMirror 以同一个 transaction 应用全部变更，整次替换可被一次撤销恢复。
        view.dispatch({
          changes: matches.map((match) => ({ from: match.from, insert: replacement, to: match.to })),
        })
        view.focus()
        return matches.length
      },
      replaceCurrent(query, replacement) {
        const view = editorRef.current?.view
        if (!view || readOnly || !query) return { current: 0, total: 0 }
        const selection = view.state.selection.main
        const selected = view.state.sliceDoc(selection.from, selection.to)
        if (selected.toLocaleLowerCase() !== query.toLocaleLowerCase()) {
          return findTextInView(view, query, "next", false)
        }
        view.dispatch({
          changes: { from: selection.from, insert: replacement, to: selection.to },
          selection: { anchor: selection.from + replacement.length },
        })
        return findTextInView(view, query, "next", false)
      },
      revealLine(line) {
        const view = editorRef.current?.view
        if (!view) return
        const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
        view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true })
        view.focus()
      },
      scrollLineToTop(line) {
        const view = editorRef.current?.view
        if (!view) return false
        const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
        // 不动选区也不抢焦点：这是切换视图时的对位，手机上抢焦点会顺带把键盘顶起来。
        view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: "start" }) })
        return true
      },
      selectAll() {
        const view = editorRef.current?.view
        if (!view) return
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
        view.focus()
      },
      undo() {
        dispatchHistoryShortcut(editorRef.current?.view, false)
      },
    }), [readOnly])

    return (
      <CodeMirror
        aria-label="Markdown 编辑器"
        basicSetup={{
          bracketMatching: true,
          closeBrackets: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          lineNumbers: false,
        }}
        editable={!readOnly}
        extensions={extensions}
        height="100%"
        onChange={onChange}
        placeholder="开始记录你的想法…"
        readOnly={readOnly}
        ref={editorRef}
        value={value}
      />
    )
  },
)

function collectTransferFiles(transfer: DataTransfer | null) {
  return Array.from(transfer?.files ?? [])
}

function readSelectedText(view: EditorView | undefined) {
  if (!view) return ""
  const selection = view.state.selection.main
  return view.state.sliceDoc(selection.from, selection.to)
}

// 只用到节点名与父链；按结构声明，避免为类型引入 @lezer/common 显式依赖。
type MdNode = { name: string; parent: MdNode | null }

function isInsideTable(state: EditorState, position: number) {
  for (let node: MdNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name === "Table") return true
  }
  return false
}

// 表格会把紧随其后的非空行并进自己，只有隔开一个空行，新写的内容才是独立段落。
export function paragraphSeparatorAtEnd(state: EditorState) {
  const { doc } = state
  const lastLine = doc.line(doc.lines)
  if (lastLine.text.trim() !== "") return isInsideTable(state, lastLine.from) ? "\n\n" : ""
  if (doc.lines < 2) return ""
  const previous = doc.line(doc.lines - 1)
  if (previous.text.trim() === "") return ""
  return isInsideTable(state, previous.from) ? "\n" : ""
}


export function findPlainTextMatches(text: string, query: string) {
  if (!query) return []
  const matches: Array<{ from: number; to: number }> = []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu")
  for (const match of text.matchAll(pattern)) {
    const from = match.index
    matches.push({ from, to: from + match[0].length })
  }
  return matches
}

function findTextInView(
  view: EditorView | undefined,
  query: string,
  direction: "next" | "previous",
  fromStart: boolean,
): MarkdownFindResult {
  if (!view || !query) return { current: 0, total: 0 }
  const matches = findPlainTextMatches(view.state.doc.toString(), query)
  if (matches.length === 0) return { current: 0, total: 0 }

  const selection = view.state.selection.main
  let index = 0
  if (!fromStart && direction === "next") {
    index = matches.findIndex((match) => match.from >= selection.to)
    if (index < 0) index = 0
  } else if (!fromStart) {
    index = matches.length - 1
    while (index >= 0 && matches[index].to > selection.from) index -= 1
    if (index < 0) index = matches.length - 1
  }
  const match = matches[index]
  // 查找栏需要持续接收键盘输入；这里只移动编辑器选区，不抢回输入框焦点。
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true })
  return { current: index + 1, total: matches.length }
}

export function formatToolbarText(template: string, selected: string) {
  if (!selected) return { text: template }
  if (template === "**加粗文字**") return { text: `**${selected}**` }
  if (template === "*斜体文字*") return { text: `*${selected}*` }
  if (template === "[链接](https://)") {
    const text = `[${selected}](https://)`
    const urlStart = selected.length + 3
    return { selection: { from: urlStart, to: urlStart + 8 }, text }
  }
  if (template === "\n```\n\n```\n") return { text: `\n\`\`\`\n${selected}\n\`\`\`\n` }

  const prefix = template.match(/^\n(#{2,3} |> |- |- \[ \] )$/)?.[1]
  if (prefix) return { text: selected.split("\n").map((line) => `${prefix}${line}`).join("\n") }
  return { text: template }
}

function dispatchHistoryShortcut(view: EditorView | undefined, redo: boolean) {
  if (!view) return
  // basicSetup 已注册平台原生历史快捷键；复用同一路径保证按钮和键盘共享撤销栈。
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    key: "z",
    metaKey: navigator.platform.toLocaleLowerCase().includes("mac"),
    ctrlKey: !navigator.platform.toLocaleLowerCase().includes("mac"),
    shiftKey: redo,
  }))
  view.focus()
}

export default MarkdownEditor
