import { memo, useEffect, useRef, useState } from "react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { markdown as markdownLanguageSupport } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import { redo, undo } from "@codemirror/commands"
import { EditorView } from "@codemirror/view"

type CodeMirrorLabProps = {
  initialMarkdown: string
  onChange: (markdown: string, latencyMs: number | null) => void
  onReady: (markdown: string, readyMs: number) => void
  startedAt: number
}

export const CodeMirrorLab = memo(function CodeMirrorLab({ initialMarkdown, onChange, onReady, startedAt }: CodeMirrorLabProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const pendingInputAt = useRef<number | null>(null)
  const readyReported = useRef(false)
  const callbacks = useRef({ onChange, onReady })
  callbacks.current = { onChange, onReady }

  useEffect(() => {
    setMarkdown(initialMarkdown)
  }, [initialMarkdown, startedAt])

  return (
    <div
      className="editor-lab-editor-body editor-lab-codemirror"
      onBeforeInputCapture={() => { pendingInputAt.current = performance.now() }}
      onPasteCapture={() => { pendingInputAt.current = performance.now() }}
    >
      <div className="editor-lab-inline-actions" aria-label="CodeMirror 历史操作">
        <button onClick={() => { const view = editorRef.current?.view; if (view) undo(view) }} type="button">撤销</button>
        <button onClick={() => { const view = editorRef.current?.view; if (view) redo(view) }} type="button">重做</button>
      </div>
      <div className="editor-lab-codemirror-scroll" data-slot="scroll-area-viewport">
        <CodeMirror
          basicSetup={{ foldGutter: false, highlightActiveLineGutter: false }}
          extensions={[markdownLanguageSupport({ codeLanguages: languages }), EditorView.lineWrapping]}
          height="100%"
          onChange={(nextMarkdown) => {
            const latency = pendingInputAt.current === null ? null : performance.now() - pendingInputAt.current
            pendingInputAt.current = null
            setMarkdown(nextMarkdown)
            callbacks.current.onChange(nextMarkdown, latency)
          }}
          onCreateEditor={() => {
            if (readyReported.current) return
            readyReported.current = true
            callbacks.current.onReady(initialMarkdown, performance.now() - startedAt)
          }}
          ref={editorRef}
          value={markdown}
        />
      </div>
    </div>
  )
})
