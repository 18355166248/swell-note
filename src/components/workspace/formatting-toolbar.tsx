import { useRef, type ReactNode, type RefObject } from "react"
import { Bold, CheckCircle2, Code2, Image, Italic, Link, List, LoaderCircle, Quote, Redo2, Undo2 } from "lucide-react"

import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function FormattingToolbar({ attachmentBusy, canInsertAttachment, editorRef, mobile = false, onFormat, onInsertFiles }: {
  attachmentBusy: boolean
  canInsertAttachment: boolean
  editorRef: RefObject<MarkdownEditorHandle | null>
  mobile?: boolean
  onFormat: (syntax: string) => void
  onInsertFiles: (files: File[]) => Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="formatting-toolbar" data-mobile={mobile}>
      <FormatButton icon={Undo2} label="撤销（⌘/Ctrl+Z）" onClick={() => editorRef.current?.undo()} />
      <FormatButton icon={Redo2} label="重做（⌘/Ctrl+Shift+Z）" onClick={() => editorRef.current?.redo()} />
      <span className="toolbar-divider" />
      <FormatButton label="二级标题" onClick={() => onFormat("\n## ")}>H2</FormatButton>
      <FormatButton label="三级标题" onClick={() => onFormat("\n### ")}>H3</FormatButton>
      <span className="toolbar-divider" />
      <FormatButton icon={Bold} label="加粗" onClick={() => onFormat("**加粗文字**")} />
      <FormatButton icon={Italic} label="斜体" onClick={() => onFormat("*斜体文字*")} />
      <FormatButton icon={Quote} label="引用" onClick={() => onFormat("\n> ")} />
      <FormatButton icon={List} label="无序列表" onClick={() => onFormat("\n- ")} />
      <FormatButton icon={CheckCircle2} label="任务列表" onClick={() => onFormat("\n- [ ] ")} />
      <FormatButton icon={Code2} label="代码" onClick={() => onFormat("\n```\n\n```\n")} />
      <FormatButton icon={Link} label="链接" onClick={() => onFormat("[链接](https://)")} />
      {canInsertAttachment ? (
        <>
          <FormatButton busy={attachmentBusy} icon={Image} label="插入图片或附件" onClick={() => fileInputRef.current?.click()} />
          <input className="attachment-file-input" multiple onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            // 清空 value 才能连续两次选择同一个文件。
            event.target.value = ""
            if (files.length > 0) void onInsertFiles(files)
          }} ref={fileInputRef} tabIndex={-1} type="file" />
        </>
      ) : null}
    </div>
  )
}

function FormatButton({ busy = false, children, icon: Icon, label, onClick }: {
  busy?: boolean
  children?: ReactNode
  icon?: typeof List
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          disabled={busy}
          onClick={onClick}
          // 手机键盘打开时，工具栏不能先抢走 CodeMirror 焦点，否则每次加粗/插入列表都会触发键盘收起再弹出。
          onPointerDown={(event) => event.preventDefault()}
          type="button"
        >
          {busy ? <LoaderCircle className="animate-spin" /> : Icon ? <Icon /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
