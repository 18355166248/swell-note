import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorView } from "@codemirror/view"

import type { VaultAsset } from "@/services/vault/vault-adapter"

import { markdownLivePreview } from "./live-preview"
import { wikiLinkCompletion, type WikiLinkSuggestion } from "./wiki-link-completion"
import "./markdown-table.css"

export type MarkdownEditorHandle = {
  focus: () => void
  findText: (query: string, direction?: "next" | "previous", fromStart?: boolean) => MarkdownFindResult
  insertText: (text: string) => void
  redo: () => void
  replaceAll: (query: string, replacement: string) => number
  replaceCurrent: (query: string, replacement: string) => MarkdownFindResult
  revealLine: (line: number) => void
  undo: () => void
}

export type MarkdownFindResult = {
  current: number
  total: number
}

type MarkdownEditorProps = {
  onChange: (value: string) => void
  onCursorChange?: (line: number, column: number) => void
  onInsertFiles?: (files: File[]) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  getWikiLinkSuggestions?: () => WikiLinkSuggestion[]
  readOnly?: boolean
  storageKey?: string
  value: string
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ getWikiLinkSuggestions, onChange, onCursorChange, onInsertFiles, onOpenWikiLink, onResolveAsset, readOnly = false, storageKey, value }, ref) {
    const editorRef = useRef<ReactCodeMirrorRef>(null)

    // CodeMirror 的扩展数组一旦换引用就会整体重配置（语言也会重新解析）；
    // 调用方传入的回调多为内联函数，用 ref 中转后扩展只在只读状态切换时重建。
    const handlers = useRef({ getWikiLinkSuggestions, onCursorChange, onInsertFiles, onOpenWikiLink, onResolveAsset })
    useEffect(() => {
      handlers.current = { getWikiLinkSuggestions, onCursorChange, onInsertFiles, onOpenWikiLink, onResolveAsset }
    })

    const extensions = useMemo(() => [
      // GFM 基座：表格、删除线与任务列表才能进入语法树，供语法高亮与即时渲染装饰使用。
      markdown({ base: markdownLanguage }),
      markdownLivePreview({
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
      }),
      EditorView.domEventHandlers({
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
    ], [readOnly, storageKey])

    useImperativeHandle(ref, () => ({
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
