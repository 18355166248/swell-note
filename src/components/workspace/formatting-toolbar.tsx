import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { Bold, CheckCircle2, Code, Code2, Heading3, Image, Italic, Link, List, LoaderCircle, Minus, MoreHorizontal, Quote, Redo2, Strikethrough, Table, Undo2 } from "lucide-react"

import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const TABLE_TEMPLATE = "\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n"

// 手机一行放不下全部按钮，这些低频格式收进“更多”；语法与桌面端共用，避免两处写法漂移。
// 前 4 项的顺序被下方解构复用，新增项一律往后追加。
const SECONDARY_FORMATS = [
  { icon: Heading3, label: "三级标题", syntax: "\n### " },
  { icon: Quote, label: "引用", syntax: "\n> " },
  { icon: Code2, label: "代码块", syntax: "\n```\n\n```\n" },
  { icon: Link, label: "链接", syntax: "[链接](https://)" },
  { icon: Strikethrough, label: "删除线", syntax: "~~删除线文字~~" },
  { icon: Code, label: "行内代码", syntax: "`行内代码`" },
  { icon: Minus, label: "分割线", syntax: "\n---\n" },
  { icon: Table, label: "表格", syntax: TABLE_TEMPLATE },
]

export function FormattingToolbar({ attachmentBusy, canInsertAttachment, editorRef, mobile = false, onFormat, onInsertFiles }: {
  attachmentBusy: boolean
  canInsertAttachment: boolean
  editorRef: RefObject<MarkdownEditorHandle | null>
  mobile?: boolean
  onFormat: (syntax: string) => void
  onInsertFiles: (files: File[]) => Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [heading3, quote, code, link, strike, inlineCode, rule, table] = SECONDARY_FORMATS

  return (
    <div className="formatting-toolbar" data-mobile={mobile}>
      <FormatButton icon={Undo2} label="撤销（⌘/Ctrl+Z）" onClick={() => editorRef.current?.undo()} />
      <FormatButton icon={Redo2} label="重做（⌘/Ctrl+Shift+Z）" onClick={() => editorRef.current?.redo()} />
      <span className="toolbar-divider" />
      {mobile ? null : <FormatButton label="一级标题" onClick={() => onFormat("\n# ")}>H1</FormatButton>}
      <FormatButton label="二级标题" onClick={() => onFormat("\n## ")}>H2</FormatButton>
      {mobile ? null : <FormatButton label={heading3.label} onClick={() => onFormat(heading3.syntax)}>H3</FormatButton>}
      <span className="toolbar-divider" />
      <FormatButton icon={Bold} label="加粗（⌘/Ctrl+B）" onClick={() => onFormat("**加粗文字**")} />
      <FormatButton icon={Italic} label="斜体（⌘/Ctrl+I）" onClick={() => onFormat("*斜体文字*")} />
      {mobile ? null : <FormatButton icon={strike.icon} label={strike.label} onClick={() => onFormat(strike.syntax)} />}
      {mobile ? null : <FormatButton icon={quote.icon} label={quote.label} onClick={() => onFormat(quote.syntax)} />}
      <FormatButton icon={List} label="无序列表" onClick={() => onFormat("\n- ")} />
      <FormatButton icon={CheckCircle2} label="任务列表" onClick={() => onFormat("\n- [ ] ")} />
      {mobile ? null : (
        <>
          <FormatButton icon={inlineCode.icon} label={inlineCode.label} onClick={() => onFormat(inlineCode.syntax)} />
          <FormatButton icon={code.icon} label={code.label} onClick={() => onFormat(code.syntax)} />
          <FormatButton icon={link.icon} label={`${link.label}（⌘/Ctrl+K）`} onClick={() => onFormat(link.syntax)} />
          <span className="toolbar-divider" />
          <FormatButton icon={table.icon} label={table.label} onClick={() => onFormat(table.syntax)} />
          <FormatButton icon={rule.icon} label={rule.label} onClick={() => onFormat(rule.syntax)} />
        </>
      )}
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
      {mobile ? <SecondaryFormatsMenu onFormat={onFormat} /> : null}
    </div>
  )
}

// 用工具栏内部的浮层而不是通用下拉菜单：菜单一旦接管焦点，手机键盘会收起再弹出，
// 工具栏也会跟着键盘上下跳一次；自绘浮层可以让焦点始终留在 CodeMirror 里。
function SecondaryFormatsMenu({ onFormat }: { onFormat: (syntax: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", closeOnOutsidePress)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [open])

  return (
    <div className="toolbar-more" ref={containerRef}>
      <FormatButton expanded={open} icon={MoreHorizontal} label="更多格式" onClick={() => setOpen((current) => !current)} />
      {open ? (
        <div className="toolbar-more-menu" role="menu">
          {SECONDARY_FORMATS.map(({ icon: Icon, label, syntax }) => (
            <button
              key={label}
              onClick={() => {
                setOpen(false)
                onFormat(syntax)
              }}
              onPointerDown={(event) => event.preventDefault()}
              role="menuitem"
              type="button"
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function FormatButton({ busy = false, children, expanded, icon: Icon, label, onClick }: {
  busy?: boolean
  children?: ReactNode
  expanded?: boolean
  icon?: typeof List
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-expanded={expanded}
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
