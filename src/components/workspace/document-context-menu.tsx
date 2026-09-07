import { useRef, useState, type ReactNode, type RefObject } from "react"
import { Bold, ClipboardPaste, Copy, Download, ExternalLink, History, Italic, Link, Redo2, Search, TextSelect, Undo2, Scissors, PencilLine, Eye, Star } from "lucide-react"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { writeClipboardText } from "@/services/clipboard/clipboard-text"

type Props = {
  disabled?: boolean
  children: ReactNode
  editorRef: RefObject<MarkdownEditorHandle | null>
  previewing: boolean
  readOnly: boolean
  hasSelection: boolean
  canUndo: boolean
  canRedo: boolean
  canHistory: boolean
  starred: boolean
  onFind: () => void
  onToggleView: () => void
  onToggleStar: () => void
  onExport: () => void
  onHistory: () => void
}

export function DocumentContextMenu(props: Props) {
  const { children, editorRef, previewing, readOnly } = props
  const [selected, setSelected] = useState(false)
  const [hint, setHint] = useState("")
  const [link, setLink] = useState<{ element: HTMLElement; address: string } | null>(null)
  const range = useRef<Range | null>(null)
  const root = useRef<HTMLElement | null>(null)
  const restore = () => {
    if (!previewing) { editorRef.current?.focus(); return }
    if (!range.current?.startContainer.isConnected) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range.current)
  }
  const run = async (action: "copy" | "cut" | "paste") => {
    restore()
    const editor = editorRef.current
    const done = previewing ? await writeClipboardText(range.current?.toString() ?? "")
      : action === "copy" ? await editor?.copySelection()
      : action === "cut" ? await editor?.cutSelection() : await editor?.pasteAtSelection()
    if (!done) setHint(action === "paste" ? "无法读取剪贴板，请使用 ⌘V / Ctrl+V 粘贴" : "操作失败，请使用键盘快捷键")
  }
  if (props.disabled) return children
  return <>
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild onContextMenu={(event) => {
        if (event.defaultPrevented) return
        const element = event.target as HTMLElement
        const anchor = element.closest<HTMLElement>("a[href], [data-md-href]")
        if (anchor) {
          setLink({ element: anchor, address: anchor.getAttribute("href") ?? anchor.dataset.mdHref ?? "" })
          setHint("")
          return
        }
        setLink(null)
        const cell = element.closest<HTMLElement>(".cm-md-table-cell-editable")
        if (cell) {
          // 先沿用单元格点击路径定位，再将右键交给输入框菜单，不能误用正文旧光标。
          event.preventDefault()
          const from = cell.closest<HTMLElement>(".cm-md-table-wrap")?.dataset.tableFrom
          const row = cell.dataset.rowIndex
          const column = cell.dataset.columnIndex
          const container = event.currentTarget
          cell.click()
          window.setTimeout(() => {
            const input = container.querySelector<HTMLElement>(`.cm-md-table-wrap[data-table-from="${from}"] [data-row-index="${row}"][data-column-index="${column}"] textarea`)
            input?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: 2 }))
          }, 0)
          return
        }
        if (element.closest("input, textarea, button, a, [role='button'], .cm-md-table-wrap")) { event.preventDefault(); return }
        root.current = event.currentTarget
        const selection = window.getSelection()
        range.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
        setSelected(previewing ? Boolean(range.current?.toString()) : props.hasSelection)
        setHint("")
      }}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent onEscapeKeyDown={() => { if (!link) restore() }} onCloseAutoFocus={(event) => event.preventDefault()}>
        {link ? <>
          <ContextMenuItem onSelect={() => { if (link.element.isConnected) link.element.click() }}><ExternalLink />打开链接</ContextMenuItem>
          <ContextMenuItem onSelect={() => {
            void writeClipboardText(link.address, "text").then((done) => { if (!done) setHint("复制链接失败，请重试") })
          }}><Copy />复制链接地址</ContextMenuItem>
        </> : <>
        <ContextMenuItem disabled={!selected} onSelect={() => void run("copy")}><Copy />复制</ContextMenuItem>
        {!previewing && <>
          <ContextMenuItem disabled={readOnly || !selected} onSelect={() => void run("cut")}><Scissors />剪切</ContextMenuItem>
          <ContextMenuItem disabled={readOnly} onSelect={() => void run("paste")}><ClipboardPaste />粘贴</ContextMenuItem>
        </>}
        <ContextMenuItem onSelect={() => {
          if (!previewing) { editorRef.current?.selectAll(); return }
          const content = root.current?.querySelector(".markdown-preview")
          if (!content) return
          const all = document.createRange()
          all.selectNodeContents(content)
          window.getSelection()?.removeAllRanges()
          window.getSelection()?.addRange(all)
        }}><TextSelect />全选正文</ContextMenuItem>
        {!previewing && <>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={readOnly || !props.canUndo} onSelect={() => editorRef.current?.undo()}><Undo2 />撤销</ContextMenuItem>
          <ContextMenuItem disabled={readOnly || !props.canRedo} onSelect={() => editorRef.current?.redo()}><Redo2 />重做</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={readOnly} onSelect={() => editorRef.current?.insertText("**加粗文字**")}><Bold />加粗</ContextMenuItem>
          <ContextMenuItem disabled={readOnly} onSelect={() => editorRef.current?.insertText("*斜体文字*")}><Italic />斜体</ContextMenuItem>
          <ContextMenuItem disabled={readOnly} onSelect={() => editorRef.current?.insertText("[链接](https://)")}><Link />插入链接</ContextMenuItem>
        </>}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={props.onFind}><Search />查找正文</ContextMenuItem>
        <ContextMenuItem onSelect={props.onToggleView}>{previewing ? <PencilLine /> : <Eye />}{previewing ? "编辑模式" : "阅读模式"}</ContextMenuItem>
        <ContextMenuItem onSelect={props.onToggleStar}><Star />{props.starred ? "取消收藏" : "收藏笔记"}</ContextMenuItem>
        <ContextMenuItem onSelect={props.onExport}><Download />导出 Markdown 文件</ContextMenuItem>
        <ContextMenuItem disabled={!props.canHistory} onSelect={props.onHistory}><History />本地版本历史</ContextMenuItem>
        </>}
      </ContextMenuContent>
    </ContextMenu>
    {hint && <p role="status" className="attachment-error" onClick={() => setHint("")}>{hint}</p>}
  </>
}
