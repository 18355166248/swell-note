import { memo, useEffect, useRef, useState } from "react"

import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/editor/markdown-editor"

type CodeMirrorLabProps = {
  initialMarkdown: string
  onChange: (markdown: string, latencyMs: number | null) => void
  onReady: (markdown: string, readyMs: number) => void
  startedAt: number
}

export const CodeMirrorLab = memo(function CodeMirrorLab({ initialMarkdown, onChange, onReady, startedAt }: CodeMirrorLabProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const pendingInputAt = useRef<number | null>(null)
  const callbacks = useRef({ onChange, onReady })
  callbacks.current = { onChange, onReady }

  useEffect(() => {
    const frame = requestAnimationFrame(() => callbacks.current.onReady(initialMarkdown, performance.now() - startedAt))
    return () => cancelAnimationFrame(frame)
  }, [initialMarkdown, startedAt])

  return (
    <div
      className="editor-lab-editor-body editor-lab-codemirror"
      onBeforeInputCapture={() => { pendingInputAt.current = performance.now() }}
      onPasteCapture={() => { pendingInputAt.current = performance.now() }}
    >
      <div className="editor-lab-inline-actions" aria-label="CodeMirror 历史操作">
        <button onClick={() => editorRef.current?.undo()} type="button">撤销</button>
        <button onClick={() => editorRef.current?.redo()} type="button">重做</button>
      </div>
      <div className="markdown-editor-shell editor-lab-codemirror-scroll" data-slot="scroll-area-viewport">
        <MarkdownEditor
          compact={window.matchMedia("(max-width: 900px)").matches}
          onChange={(nextMarkdown) => {
            const latency = pendingInputAt.current === null ? null : performance.now() - pendingInputAt.current
            pendingInputAt.current = null
            setMarkdown(nextMarkdown)
            callbacks.current.onChange(nextMarkdown, latency)
          }}
          onResolveAsset={resolveLabAsset}
          ref={editorRef}
          sessionKey="editor-lab-codemirror"
          storageKey="editor-lab"
          value={markdown}
        />
      </div>
    </div>
  )
})

async function resolveLabAsset(source: string) {
  if (!source.startsWith("/")) return null
  try {
    const response = await fetch(source)
    if (!response.ok) return null
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") ?? undefined,
    }
  } catch {
    return null
  }
}
