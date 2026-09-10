import { useEffect, useState } from "react"
import { ChevronRight, ExternalLink, PencilLine, Unlink } from "lucide-react"

import { isValidLinkLabel, type EditorLinkTarget } from "@/components/editor/markdown-input"
import type { LinkCellSnapshot } from "@/components/editor/markdown-editor"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

// 移动端链接面板的状态：menu 为 true 时点按已有链接进入，先给「打开 / 编辑 / 移除」；
// 工具栏「链接」按钮进入时 menu 为 false，直接编辑。hadFocus 记录打开面板前编辑器是否
// 持有焦点，取消后据此把焦点（与键盘）归还给编辑器；cell 是单元格编辑中打开面板时的
// 现场快照，保存写单元格、取消时把焦点还给单元格。
export type LinkSheetState = {
  cell?: LinkCellSnapshot
  hadFocus: boolean
  href?: string
  label: string
  menu: boolean
  noteTarget?: string
  target: EditorLinkTarget | null
  url: string
}

// 手机上手动拼 [文字](地址)、在长地址里移动光标成本很高；这里把两个字段拆开来填，
// 确认或取消后编辑器保留原光标、选区与滚动位置（由编辑器侧的映射选区与焦点点恢复保证）。
// 保存/移除回调返回是否成功：失败（原文在面板期间被改动）时面板不关闭、输入不丢。
export function MobileLinkSheet({ sheet, onClose, onOpenLink, onRemoveLink, onRestoreFocus, onSaveLink }: {
  sheet: LinkSheetState | null
  onClose: () => void
  onOpenLink: () => void
  onRemoveLink: () => boolean
  // 关闭动画收尾时归还焦点：modal 面板打开期间外部元素是 inert 的，
  // 同步 focus 会静默失败，必须等卸载流程里的这个时机。
  onRestoreFocus: () => void
  onSaveLink: (label: string, url: string) => boolean
}) {
  const [view, setView] = useState<"edit" | "menu">("edit")
  const [label, setLabel] = useState("")
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    setView(sheet?.menu ? "menu" : "edit")
    setLabel(sheet?.label ?? "")
    setUrl(sheet?.url ?? "")
    setError("")
  }, [sheet])

  if (!sheet) return null
  const editing = Boolean(sheet.target)
  const canOpen = Boolean(sheet.href || sheet.noteTarget)
  const canSave = isValidLinkLabel(label) && Boolean(url.trim()) && !/[\n\r<>]/.test(url)
  const save = () => {
    if (!canSave) return
    if (!onSaveLink(label, url)) setError("内容已在别处被修改，未能保存。请关闭面板后重试。")
  }
  const remove = () => {
    if (!onRemoveLink()) setError("内容已在别处被修改，未能移除。请关闭面板后重试。")
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose() }} open>
      <DialogContent
        className="mobile-action-sheet"
        // 关闭时的焦点归属由调用方决定（取消时还给单元格或编辑器），不走默认的触发点恢复。
        onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus() }}
        placement="bottom"
      >
        <DialogHeader>
          <DialogTitle>{view === "menu" ? sheet.label || "链接" : editing ? "编辑链接" : "新增链接"}</DialogTitle>
          <DialogDescription>
            {view === "menu" ? sheet.url : "分别填写显示文字与链接地址，保存后回到原光标位置。"}
          </DialogDescription>
        </DialogHeader>
        {view === "menu" ? (
          <div className="mobile-action-list">
            <button disabled={!canOpen} onClick={onOpenLink} type="button"><ExternalLink /><span>打开链接</span><ChevronRight /></button>
            <button onClick={() => setView("edit")} type="button"><PencilLine /><span>编辑链接</span><ChevronRight /></button>
            <button className="mobile-action-destructive" onClick={remove} type="button"><Unlink /><span>移除链接</span><ChevronRight /></button>
          </div>
        ) : (
          <div
            className="mobile-link-form"
            // 回车即保存，手机上少一次精确点按；中文输入法组词中的回车不算。
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key !== "Enter") return
              event.preventDefault()
              save()
            }}
          >
            <Input aria-label="显示文字" autoFocus={!sheet.label} onChange={(event) => setLabel(event.target.value)} placeholder="显示文字" value={label} />
            <Input aria-label="链接地址" autoFocus={Boolean(sheet.label)} inputMode="url" onChange={(event) => setUrl(event.target.value)} placeholder="https://" value={url} />
          </div>
        )}
        {error ? <p className="mobile-link-error" role="alert">{error}</p> : null}
        {view === "edit" ? (
          <DialogFooter>
            <Button onClick={onClose} variant="ghost">取消</Button>
            <Button disabled={!canSave} onClick={save}>保存</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
