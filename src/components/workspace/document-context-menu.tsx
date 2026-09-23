import { useRef, useState, type ReactNode, type RefObject } from "react"
import { Bold, ClipboardPaste, Copy, Download, ExternalLink, History, Italic, Link, LockKeyhole, Redo2, Search, TextSelect, Undo2, Scissors, PencilLine, Star } from "lucide-react"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { writeClipboardText } from "@/services/clipboard/clipboard-text"
import { getNoteViewModeAction, type NoteViewMode } from "@/services/preferences/ui-preferences"

type Props = {
  disabled?: boolean
  children: ReactNode
  editorRef: RefObject<MarkdownEditorHandle | null>
  // 手机工作区：正文不用自定义右键菜单，见下方 mobile 分支说明。
  mobile?: boolean
  previewing: boolean
  readOnly: boolean
  viewMode: NoteViewMode
  hasSelection: boolean
  canUndo: boolean
  canRedo: boolean
  canHistory: boolean
  starred: boolean
  onFind: () => void
  onViewModeChange: (mode: NoteViewMode) => void
  onToggleStar: () => void
  onExport: () => void
  onHistory: () => void
}

export function DocumentContextMenu(props: Props) {
  const { children, editorRef, previewing, readOnly } = props
  const viewAction = getNoteViewModeAction(props.viewMode)
  const [selected, setSelected] = useState(false)
  const [hint, setHint] = useState("")
  const [link, setLink] = useState<{ element: HTMLElement; address: string } | null>(null)
  const range = useRef<Range | null>(null)
  const root = useRef<HTMLElement | null>(null)
  // 阅读态取文本必须走 Selection.toString()，不能用保存的 Range 克隆：
  // Range.toString() 只是把范围内的文本节点原样拼起来，会把 App.css 里 user-select:none
  // 排除掉的界面文字（代码块语言名与「复制」按钮、表格「左右滑动」提示）当成正文带出去，
  // 表格单元格之间的制表符也会丢；Selection.toString() 给的是渲染后的可见文字，与 ⌘C 一致。
  const previewSelectionText = () => window.getSelection()?.toString() ?? ""
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
    const done = previewing ? await writeClipboardText(previewSelectionText())
      : action === "copy" ? await editor?.copySelection()
      : action === "cut" ? await editor?.cutSelection() : await editor?.pasteAtSelection()
    if (!done) setHint(action === "paste" ? "无法读取剪贴板，请使用 ⌘V / Ctrl+V 粘贴" : "操作失败，请使用键盘快捷键")
  }
  if (props.disabled) return children
  // 手机端不挂 Radix 触发器：它的指针长按在 pointerType 非鼠标时按住 700ms 会自己弹菜单，
  // 手指几乎不动才触发，于是偶发误弹；这条路不派发 contextmenu，onContextMenu 里的
  // 选区状态根本没算过，弹出来也是复制/剪切全灰的空壳。
  // 正文的格式与剪贴板操作手机上已由格式工具栏和顶栏「更多操作」覆盖，长按留给系统文字选择。
  if (props.mobile) return children
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
        // 阅读态的可复制内容同样只看可见文字：整段只框住了被排除的界面文字时不该点亮「复制」。
        setSelected(previewing ? Boolean(range.current && previewSelectionText()) : props.hasSelection)
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
        <ContextMenuItem onSelect={() => props.onViewModeChange(viewAction.nextMode)}>
          {viewAction.nextMode === "unified" ? <PencilLine /> : <LockKeyhole />}{viewAction.label}
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onToggleStar}><Star />{props.starred ? "取消收藏" : "收藏笔记"}</ContextMenuItem>
        <ContextMenuItem onSelect={props.onExport}><Download />导出笔记与附件包</ContextMenuItem>
        <ContextMenuItem disabled={!props.canHistory} onSelect={props.onHistory}><History />本地版本历史</ContextMenuItem>
        </>}
      </ContextMenuContent>
    </ContextMenu>
    {hint && <p role="status" className="attachment-error" onClick={() => setHint("")}>{hint}</p>}
  </>
}
