import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { Bold, CheckCircle2, Code, Code2, Heading3, Image, Italic, Link, List, LoaderCircle, Minus, MoreHorizontal, Quote, Redo2, Strikethrough, Table, Undo2 } from "lucide-react"

import { TABLE_INSERT_TEMPLATE, type MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import type { EditorFormatState } from "@/components/editor/markdown-input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { SelectionButtons, useSelectionActions } from "./selection-action-bar"

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
  { icon: Table, label: "表格", syntax: TABLE_INSERT_TEMPLATE },
]

export function FormattingToolbar({ canUndo = true, canRedo = true, editingTable = false, attachmentBusy, canInsertAttachment, editorRef, formatState = null, hasSelection = false, mobile = false, onFormat, onInsertFiles }: {
  canUndo?: boolean
  canRedo?: boolean
  editingTable?: boolean
  attachmentBusy: boolean
  canInsertAttachment: boolean
  editorRef: RefObject<MarkdownEditorHandle | null>
  // 光标 / 选区当前的格式，用于按钮高亮；null 表示不在编辑态，不高亮任何按钮。
  formatState?: EditorFormatState | null
  // 移动端选区非空时工具栏进入选区模式：复制/剪切/粘贴替换低频入口，与格式按钮共享同一行，
  // 不再在格式栏上方额外堆一条 46px 的操作条。
  hasSelection?: boolean
  mobile?: boolean
  onFormat: (syntax: string) => void
  onInsertFiles: (files: File[]) => Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [, quote, code, link, strike, inlineCode, rule, table] = SECONDARY_FORMATS
  // 标题选择器受控：光标落在哪级标题就显示哪级；切换行为不变（选完即触发 onFormat）。
  const headingValue = formatState?.heading ? "#".repeat(formatState.heading) : ""
  const selectionMode = mobile && hasSelection
  const { hint, run } = useSelectionActions(editorRef)

  if (selectionMode) {
    return (
      <div className="formatting-toolbar" data-mobile={mobile} data-selection-mode="true">
        {hint ? <p aria-live="polite" className="selection-action-hint" role="status">{hint}</p> : null}
        <SelectionButtons run={run} />
        <FormatButton active={Boolean(formatState?.strong)} icon={Bold} label="加粗（⌘/Ctrl+B）" onClick={() => onFormat("**加粗文字**")} />
        <FormatButton active={Boolean(formatState?.emphasis)} icon={Italic} label="斜体（⌘/Ctrl+I）" onClick={() => onFormat("*斜体文字*")} />
        <SecondaryFormatsMenu canRedo={canRedo} editingTable={editingTable} editorRef={editorRef} onFormat={onFormat} />
      </div>
    )
  }

  return (
    <div className="formatting-toolbar" data-mobile={mobile}>
      <FormatButton disabled={!canUndo && !editingTable} icon={Undo2} label="撤销（⌘/Ctrl+Z）" onClick={() => editorRef.current?.undo()} />
      {/* 手机屏幕一排放不下全部按钮，重做收进“更多”菜单，主栏只留最高频入口。 */}
      {mobile ? null : <FormatButton disabled={!canRedo} icon={Redo2} label="重做（⌘/Ctrl+Shift+Z）" onClick={() => editorRef.current?.redo()} />}
      <span className="toolbar-divider" />
      <select aria-label="标题级别" className="toolbar-heading-select" data-active={Boolean(headingValue)} disabled={editingTable} onChange={(event) => {
        const prefix = event.currentTarget.value
        if (prefix) { onFormat(`\n${prefix} `); return }
        // 恢复正文：受控选择器里重选当前级别不会触发 onChange，
        // 用当前级别再切换一次，借块格式的反向开关去掉标题。
        if (formatState?.heading) onFormat(`\n${"#".repeat(formatState.heading)} `)
      }} value={headingValue}>
        <option value="">正文</option>
        <option value="#">一级标题</option>
        <option value="##">二级标题</option>
        <option value="###">三级标题</option>
      </select>
      <span className="toolbar-divider" />
      <FormatButton active={Boolean(formatState?.strong)} icon={Bold} label="加粗（⌘/Ctrl+B）" onClick={() => onFormat("**加粗文字**")} />
      <FormatButton active={Boolean(formatState?.emphasis)} icon={Italic} label="斜体（⌘/Ctrl+I）" onClick={() => onFormat("*斜体文字*")} />
      {mobile ? null : <FormatButton active={Boolean(formatState?.strike)} icon={strike.icon} label={strike.label} onClick={() => onFormat(strike.syntax)} />}
      {mobile ? null : <FormatButton disabled={editingTable} icon={quote.icon} label={quote.label} onClick={() => onFormat(quote.syntax)} />}
      <FormatButton disabled={editingTable} icon={List} label="无序列表" onClick={() => onFormat("\n- ")} />
      <FormatButton disabled={editingTable} icon={CheckCircle2} label="任务列表" onClick={() => onFormat("\n- [ ] ")} />
      {mobile ? null : (
        <>
          <FormatButton active={Boolean(formatState?.code)} icon={inlineCode.icon} label={inlineCode.label} onClick={() => onFormat(inlineCode.syntax)} />
          <FormatButton disabled={editingTable} icon={code.icon} label={code.label} onClick={() => onFormat(code.syntax)} />
          <FormatButton icon={link.icon} label={`${link.label}（⌘/Ctrl+K）`} onClick={() => onFormat(link.syntax)} />
          <span className="toolbar-divider" />
          <FormatButton disabled={editingTable} icon={table.icon} label={table.label} onClick={() => onFormat(table.syntax)} />
          <FormatButton disabled={editingTable} icon={rule.icon} label={rule.label} onClick={() => onFormat(rule.syntax)} />
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
      {mobile ? <SecondaryFormatsMenu canRedo={canRedo} editingTable={editingTable} editorRef={editorRef} onFormat={onFormat} /> : null}
    </div>
  )
}

// 用工具栏内部的浮层而不是通用下拉菜单：菜单一旦接管焦点，手机键盘会收起再弹出，
// 工具栏也会跟着键盘上下跳一次；自绘浮层可以让焦点始终留在 CodeMirror 里。
function SecondaryFormatsMenu({ canRedo = true, editorRef, onFormat, editingTable }: {
  canRedo?: boolean
  editorRef: RefObject<MarkdownEditorHandle | null>
  editingTable: boolean
  onFormat: (syntax: string) => void
}) {
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
          <button
            disabled={!canRedo}
            onClick={() => {
              setOpen(false)
              editorRef.current?.redo()
            }}
            onPointerDown={(event) => event.preventDefault()}
            role="menuitem"
            type="button"
          >
            <Redo2 />
            <span>重做</span>
          </button>
          {SECONDARY_FORMATS.map(({ icon: Icon, label, syntax }) => (
            <button
              key={label}
              disabled={editingTable && syntax.startsWith("\n")}
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

function FormatButton({ active = false, disabled = false, busy = false, children, expanded, icon: Icon, label, onClick }: {
  active?: boolean
  disabled?: boolean
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
          aria-pressed={active || undefined}
          data-active={active || undefined}
          disabled={disabled || busy}
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
