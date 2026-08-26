import { forwardRef, useImperativeHandle, useMemo, useRef } from "react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorView } from "@codemirror/view"

import { markdownLivePreview } from "./live-preview"

export type MarkdownEditorHandle = {
  insertText: (text: string) => void
  redo: () => void
  undo: () => void
}

type MarkdownEditorProps = {
  onChange: (value: string) => void
  onCursorChange?: (line: number, column: number) => void
  onInsertFiles?: (files: File[]) => void
  onOpenWikiLink?: (target: string) => void
  readOnly?: boolean
  value: string
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ onChange, onCursorChange, onInsertFiles, onOpenWikiLink, readOnly = false, value }, ref) {
    const editorRef = useRef<ReactCodeMirrorRef>(null)
    const extensions = useMemo(() => [
      // GFM 基座：表格、删除线与任务列表才能进入语法树，供语法高亮与即时渲染装饰使用。
      markdown({ base: markdownLanguage }),
      markdownLivePreview({ onOpenWikiLink }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return
        const position = update.state.selection.main.head
        const line = update.state.doc.lineAt(position)
        onCursorChange?.(line.number, position - line.from + 1)
      }),
      EditorView.domEventHandlers({
        drop(event) {
          const files = collectTransferFiles(event.dataTransfer)
          if (!onInsertFiles || readOnly || files.length === 0) return false
          event.preventDefault()
          onInsertFiles(files)
          return true
        },
        paste(event) {
          // 截图与图片文件的剪贴板不带纯文本；Excel 等来源同时带文本时仍按普通粘贴处理。
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
    ], [onCursorChange, onInsertFiles, onOpenWikiLink, readOnly])

    useImperativeHandle(ref, () => ({
      insertText(text) {
        const view = editorRef.current?.view
        if (!view || readOnly || !text) return

        // 格式工具栏应作用于当前光标或选区，不能把 Markdown 语法机械追加到文末。
        const selection = view.state.selection.main
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: text },
          selection: { anchor: selection.from + text.length },
          scrollIntoView: true,
        })
        view.focus()
      },
      redo() {
        dispatchHistoryShortcut(editorRef.current?.view, true)
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
