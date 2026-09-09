import { useEffect, useRef, useState, type RefObject } from "react"
import { ClipboardPaste, Copy, Scissors, TextSelect } from "lucide-react"

import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"

// iOS 只在点击已有选区时才给出系统的 Cut/Copy/Paste；长按选中的那一刻不弹，
// 手机上选一段文字要点两次才能复制。选区非空时补一条自己的操作条，把这一步补回来。

export type SelectionAction = "copy" | "cut" | "paste" | "selectAll"

const FAILURE_HINTS: Record<SelectionAction, string> = {
  copy: "复制失败",
  cut: "剪切失败",
  paste: "读不到剪贴板内容",
  selectAll: "",
}

// 复制/剪切/粘贴/全选的执行逻辑与失败提示；独立操作条和格式栏的选区模式共用。
export function useSelectionActions(editorRef: RefObject<MarkdownEditorHandle | null>) {
  const [hint, setHint] = useState("")
  const hintTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
  }, [])

  const showHint = (message: string) => {
    setHint(message)
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    hintTimerRef.current = window.setTimeout(() => setHint(""), 2200)
  }

  const run = async (action: SelectionAction) => {
    const editor = editorRef.current
    if (!editor) return
    if (action === "selectAll") {
      editor.selectAll()
      return
    }
    const done = action === "copy"
      ? await editor.copySelection()
      : action === "cut" ? await editor.cutSelection() : await editor.pasteAtSelection()
    if (!done) showHint(FAILURE_HINTS[action])
  }

  return { hint, run }
}

// 只渲染按钮本身，外层容器（独立操作条 / 格式栏选区模式）由调用方决定。
export function SelectionButtons({ readOnly = false, run }: {
  readOnly?: boolean
  run: (action: SelectionAction) => Promise<void>
}) {
  return (
    <>
      <SelectionButton icon={Copy} label="复制" onClick={() => void run("copy")} />
      {readOnly ? null : (
        <>
          <SelectionButton icon={Scissors} label="剪切" onClick={() => void run("cut")} />
          <SelectionButton icon={ClipboardPaste} label="粘贴" onClick={() => void run("paste")} />
        </>
      )}
      <SelectionButton icon={TextSelect} label="全选" onClick={() => void run("selectAll")} />
    </>
  )
}

export function SelectionActionBar({ editorRef, readOnly = false }: {
  editorRef: RefObject<MarkdownEditorHandle | null>
  readOnly?: boolean
}) {
  const { hint, run } = useSelectionActions(editorRef)

  return (
    // 只读笔记不渲染格式工具栏，操作条自己成了屏幕最下沿，要接手底部安全区的留白。
    <div aria-label="选区操作" className="selection-action-bar" data-standalone={readOnly} role="toolbar">
      {hint ? <p aria-live="polite" className="selection-action-hint" role="status">{hint}</p> : null}
      <SelectionButtons readOnly={readOnly} run={run} />
    </div>
  )
}

function SelectionButton({ icon: Icon, label, onClick }: {
  icon: typeof Copy
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className="selection-action-button"
      onClick={onClick}
      // 按钮一旦抢走焦点，CodeMirror 的选区就没了，复制的内容也跟着变空。
      onPointerDown={(event) => event.preventDefault()}
      type="button"
    >
      <Icon />
      <span>{label}</span>
    </button>
  )
}
