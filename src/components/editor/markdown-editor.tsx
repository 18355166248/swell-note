import { forwardRef, useImperativeHandle, useRef } from "react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { markdown } from "@codemirror/lang-markdown"
import { EditorView } from "@codemirror/view"

export type MarkdownEditorHandle = {
  insertText: (text: string) => void
}

type MarkdownEditorProps = {
  onChange: (value: string) => void
  readOnly?: boolean
  value: string
}

const editorExtensions = [markdown(), EditorView.lineWrapping]

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ onChange, readOnly = false, value }, ref) {
    const editorRef = useRef<ReactCodeMirrorRef>(null)

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
        extensions={editorExtensions}
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

export default MarkdownEditor
