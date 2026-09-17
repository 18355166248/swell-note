import { memo, useEffect, useRef } from "react"
import Vditor from "vditor"

import "vditor/dist/index.css"

type VditorLabProps = {
  initialMarkdown: string
  onChange: (markdown: string, latencyMs: number | null) => void
  onError: (message: string) => void
  onReady: (markdown: string, readyMs: number) => void
  startedAt: number
}

export const VditorLab = memo(function VditorLab({ initialMarkdown, onChange, onError, onReady, startedAt }: VditorLabProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onError, onReady })
  const pendingInputAt = useRef<number | null>(null)
  callbacks.current = { onChange, onError, onReady }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let editor: Vditor | null = null
    // React StrictMode 会立刻执行一次 effect 的挂载与清理；推迟到微任务后初始化，避免销毁
    // 一个内部 DOM 尚未建立的 Vditor 实例，同时不影响真实挂载的下一轮 effect。
    queueMicrotask(() => {
      if (disposed) return
      try {
        // Vditor 自带完整工具栏和历史栈，IR 模式与 Swell Note 当前即时预览路线最接近。
        editor = new Vditor(host, {
        after: () => {
          if (!disposed && editor) callbacks.current.onReady(editor.getValue(), performance.now() - startedAt)
        },
        cache: { enable: false },
        counter: { enable: true, type: "markdown" },
        height: "100%",
        input: (markdown) => {
          if (disposed) return
          const latency = pendingInputAt.current === null ? null : performance.now() - pendingInputAt.current
          pendingInputAt.current = null
          callbacks.current.onChange(markdown, latency)
        },
        lang: "zh_CN",
        mode: "ir",
        placeholder: "在这里测试 Vditor…",
        toolbar: [
          "undo", "redo", "|", "headings", "bold", "italic", "strike", "|",
          "list", "ordered-list", "check", "table", "upload", "|", "edit-mode", "fullscreen",
        ],
        toolbarConfig: { pin: true },
        value: initialMarkdown,
        })
      } catch (error) {
        callbacks.current.onError(error instanceof Error ? error.message : "Vditor 初始化失败")
      }
    })
    return () => {
      disposed = true
      // 初始化失败或尚未完成时 destroy 会读取不存在的内部 element，只清理已就绪实例。
      if (editor?.vditor?.element) editor.destroy()
    }
  }, [initialMarkdown, startedAt])

  return (
    <div
      className="editor-lab-editor-body editor-lab-vditor"
      onBeforeInputCapture={() => { pendingInputAt.current = performance.now() }}
      onPasteCapture={() => { pendingInputAt.current = performance.now() }}
    >
      <div ref={hostRef} />
    </div>
  )
})
