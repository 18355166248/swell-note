import { useRef, useState } from "react"
import { ListChecks } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Note } from "@/types/note"
import type { VaultFolder } from "@/services/search/vault-folders"
import { parseEditableTags } from "@/services/markdown/note-tags"
import type { BatchOrganizeAction, BatchOrganizeReport } from "@/services/vault/batch-organize"
import "./batch-organize-dialog.css"

export type OrganizeNotesHandler = (ids: string[], action: BatchOrganizeAction, progress: (completed: number, total: number) => void) => Promise<BatchOrganizeReport>

export function BatchOrganizeDialog({ notes, folders, disabled, onOrganize }: {
  notes: Note[]
  folders: VaultFolder[]
  disabled: boolean
  onOrganize: OrganizeNotesHandler
}) {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<Note[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [kind, setKind] = useState<BatchOrganizeAction["kind"]>("move")
  const [folder, setFolder] = useState("")
  const [tags, setTags] = useState("")
  const [limit, setLimit] = useState(100)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")
  const [report, setReport] = useState<BatchOrganizeReport | null>(null)
  const [confirming, setConfirming] = useState(false)

  const start = () => {
    // 锁定打开时的候选范围，执行期间移动/删除导致列表变化也不会把新笔记悄悄加入选择。
    setCandidates(notes.filter((note) => note.pendingOperation !== "delete"))
    setSelected(new Set())
    setReport(null); setError(""); setConfirming(false); setLimit(100); setOpen(true)
  }
  const execute = async () => {
    if (running.current || !selected.size || report) return
    let action: BatchOrganizeAction
    try {
      action = kind === "move" ? { kind, folder: folder || null } : kind === "delete" ? { kind }
        : { kind, tags: parseEditableTags(tags) }
      if ("tags" in action && !action.tags.length) throw new Error("请输入至少一个标签")
    } catch (cause) { setError((cause as Error).message); return }
    running.current = true; setBusy(true); setError("")
    try {
      setReport(await onOrganize([...selected], action, (completed, total) => setProgress(`已处理 ${completed} / ${total} 篇`)))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "批量整理失败") }
    finally { running.current = false; setBusy(false); setConfirming(false) }
  }
  return <>
    <Button aria-label="批量整理笔记" title="批量整理笔记" size="icon-sm" variant="ghost" disabled={disabled || !notes.length} onClick={start}><ListChecks /></Button>
    <Dialog open={open} onOpenChange={(next) => { if (!running.current) setOpen(next) }}>
      <DialogContent className="batch-organize-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>批量整理笔记</DialogTitle>
          <DialogDescription>当前列表共 {candidates.length} 篇。仅处理所选笔记，无法处理的项目会列出原因。</DialogDescription>
        </DialogHeader>
        {!report && <>
          <div className="batch-selection-summary">
            <span>已选 {selected.size} 篇</span>
            <Button variant="ghost" disabled={busy || confirming} onClick={() => setSelected(new Set(candidates.map((note) => note.id)))}>全选当前列表</Button>
            <Button variant="ghost" disabled={busy || confirming} onClick={() => setSelected(new Set())}>清空</Button>
          </div>
          <div className="batch-note-list" aria-label="选择要整理的笔记">
            {candidates.slice(0, limit).map((note) => <label key={note.id}>
              <input type="checkbox" checked={selected.has(note.id)} disabled={busy || confirming} onChange={() => setSelected((current) => {
                const next = new Set(current); if (next.has(note.id)) next.delete(note.id); else next.add(note.id); return next
              })} />
              <span><strong>{note.title || "未命名笔记"}</strong><small>{note.folder || "根目录"}</small></span>
            </label>)}
            {candidates.length > limit && <Button variant="ghost" onClick={() => setLimit((count) => count + 100)}>显示更多笔记</Button>}
          </div>
          <fieldset className="batch-options" disabled={busy || confirming}>
            <label>操作<select aria-label="批量操作" value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setError("") }}>
              <option value="move">移动到目录</option><option value="add-tags">添加标签</option>
              <option value="remove-tags">移除标签</option><option value="delete">移入回收站</option>
            </select></label>
            {kind === "move" && <label>目标目录<select aria-label="批量移动目标目录" value={folder} onChange={(event) => setFolder(event.target.value)}>
              <option value="">根目录</option>{folders.map((item) => <option key={item.path} value={item.path}>{item.path}</option>)}
            </select></label>}
            {(kind === "add-tags" || kind === "remove-tags") && <label>标签<input aria-label="批量标签" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用逗号分隔多个标签" /></label>}
          </fieldset>
          <p className="batch-operation-hint">{kind === "move" ? "同名文件会跳过；会一并修复可读取笔记中的相对链接。"
            : kind === "delete" ? "所选笔记将移入回收站，可在保留期内恢复。云端删除将在后续同步时执行。"
            : "仅添加或移除指定标签，保留其他标签、属性和正文。"}</p>
          {confirming && <p role="alert">确认将所选 {selected.size} 篇笔记移入回收站？</p>}
        </>}
        {busy && <p role="status">{progress || "正在准备…"}</p>}
        {report && <div className="batch-report" role="status">
          <p>已完成 {report.succeededIds.length} / {selected.size} 篇。</p>
          {report.issues.length ? <><p>以下项目需要检查：</p><ul>{report.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></> : <p>全部处理完成。</p>}
        </div>}
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => confirming ? setConfirming(false) : setOpen(false)}>{report ? "完成" : "取消"}</Button>
          {!report && <Button disabled={busy || !selected.size || disabled} variant={kind === "delete" ? "destructive" : "default"}
            onClick={() => kind === "delete" && !confirming ? setConfirming(true) : void execute()}>
            {busy ? "正在处理…" : confirming ? `确认移入回收站（${selected.size}）` : `执行（${selected.size}）`}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
