import { loadHistoryPolicy, saveHistoryPolicy, type HistoryPolicy } from "@/services/history/history-policy"
import { exportTextDocument, markdownExportFilename } from "@/services/export/markdown-export"
import { useEffect, useMemo, useState, useRef } from "react"
import { History, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { listNoteVersions, saveNoteVersion, exportHistoryArchive, importHistoryArchive, type NoteVersion } from "@/services/history/note-history"
import { buildNoteLineDiff } from "@/services/history/note-line-diff"

export function NoteVersionHistoryDialog({ cacheId, currentContent, title = "未命名笔记", noteId, onOpenChange, onRestore, onRestoreCopy, open }: {
  cacheId: string | null
  title?: string
  currentContent: string
  noteId: string
  onOpenChange: (open: boolean) => void
  onRestore: (content: string) => Promise<void>
  onRestoreCopy: (content: string, createdAt: number) => Promise<void>
  open: boolean
}) {
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadedKey, setLoadedKey] = useState("")
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [action, setAction] = useState<"restore" | "copy" | "snapshot" | "export" | "import" | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const noteKey = `${cacheId ?? ""}\u0000${noteId}`

  const importRef = useRef<HTMLInputElement>(null)
  const [policy, setPolicy] = useState(loadHistoryPolicy)
  const contextRef = useRef({ key: noteKey, open })
  if (contextRef.current.key !== noteKey || contextRef.current.open !== open) contextRef.current = { key: noteKey, open }
  const historyAction = async (mode: "snapshot" | "export" | "import", file?: File) => {
    if (!cacheId || action) return
    const context = contextRef.current
    setAction(mode); setRestoreError(null); setNotice("")
    try {
      if (mode === "snapshot") await saveNoteVersion({ cacheId, noteId, title, content: currentContent, reason: "手动快照" })
      else if (mode === "export") await exportTextDocument(exportHistoryArchive(currentVersions, title), markdownExportFilename(title).replace(/\.md$/i, ".history.json"), "json", "导出本地历史", "application/json")
      else if (file) {
        if (file.size > 20 * 1024 * 1024) throw new Error("历史归档不能超过 20MB")
        const raw = await file.text()
        if (contextRef.current !== context) return
        await importHistoryArchive(cacheId, noteId, raw)
      }
      const items = await listNoteVersions(cacheId, noteId)
      if (contextRef.current !== context) return
      setVersions(items); setSelectedId(items[0]?.id ?? ""); setLoadedKey(noteKey)
      if (mode !== "export") setNotice(mode === "snapshot" ? "当前正文快照已保存（相同内容会复用已有版本）" : "归档已导入本地历史，当前正文保持不变")
    } catch (error) { if (contextRef.current === context) setRestoreError(error instanceof Error ? error.message : "历史操作失败") }
    finally { if (contextRef.current === context) setAction(null) }
  }
  const changePolicy = (next: HistoryPolicy) => {
    try { saveHistoryPolicy(next); setPolicy(next); setRestoreError(null) }
    catch { setRestoreError("历史设置保存失败，请重试") }
  }
  useEffect(() => { setAction(null) }, [noteKey, open])

  useEffect(() => {
    if (!open || !cacheId) {
      setLoadedKey("")
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadedKey("")
    setHistoryError(null)
    setRestoreError(null)
    void listNoteVersions(cacheId, noteId)
      .then((items) => {
        if (cancelled) return
        setVersions(items)
        setSelectedId(items[0]?.id ?? "")
        setLoadedKey(noteKey)
      })
      .catch((error) => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : "读取历史版本失败，请重新打开后重试")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [cacheId, noteId, noteKey, open])

  // 异步加载时旧列表可能还留在 state 中；只有库和笔记都匹配才允许恢复。
  const currentVersions = loadedKey === noteKey && !historyError ? versions : []
  const selected = currentVersions.find((version) => version.id === selectedId) ?? currentVersions[0]
  const changes = useMemo(() => selected ? buildNoteLineDiff(currentContent, selected.content) : null, [currentContent, selected])

  const restore = async (mode: "restore" | "copy") => {
    if (!selected || action || (mode === "restore" && !window.confirm("恢复后，当前正文会先保存为一个历史版本。确认继续？"))) return
    setAction(mode)
    setRestoreError(null)
    const context = contextRef.current
    try {
      if (mode === "copy") await onRestoreCopy(selected.content, selected.createdAt)
      else await onRestore(selected.content)
      if (contextRef.current === context) onOpenChange(false)
    } catch (error) {
      if (contextRef.current === context) setRestoreError(error instanceof Error ? error.message : "操作失败，原笔记未修改；请重试")
    } finally {
      if (contextRef.current === context) setAction(null)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="note-history-dialog">
        <DialogHeader>
          <DialogTitle>本地版本历史</DialogTitle>
          <DialogDescription>版本仅保存在当前设备，可导出归档并在其他设备导入当前笔记历史。下方显示从当前正文变为所选版本的逐行差异；也可在同目录恢复为独立副本。</DialogDescription>
        </DialogHeader>
        <div className="history-policy-controls">
          <label>保留数量 <select aria-label="历史保留数量" value={policy.limit} onChange={(event) => changePolicy({ ...policy, limit: Number(event.target.value) })}>{[30, 100, 300].map((limit) => <option key={limit} value={limit}>{limit} 个</option>)}</select></label>
          <label>自动快照间隔 <select aria-label="自动快照间隔" value={policy.intervalMinutes} onChange={(event) => changePolicy({ ...policy, intervalMinutes: Number(event.target.value) })}>{[1, 5, 15].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select></label>
          <small>本机设置。数量上限在下次保存/导入时生效，最旧版本会被清理；导入不改当前正文。</small>
        </div>
        <input hidden accept=".json,application/json" ref={importRef} type="file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void historyAction("import", file) }} />
        {loading || (open && cacheId && loadedKey !== noteKey && !historyError) ? (
          <div className="note-history-empty"><LoaderCircle className="animate-spin" /> 正在读取历史版本…</div>
        ) : historyError ? (
          <div className="note-history-empty" role="alert">{historyError}</div>
        ) : currentVersions.length === 0 ? (
          <div className="note-history-empty"><History /> 编辑并保存后，这里会出现修改前的版本。</div>
        ) : (
          <div className="note-history-layout">
            <ScrollArea className="note-history-list">
              {currentVersions.map((version) => (
                <button className="note-history-item" data-active={version.id === selected?.id} key={version.id} onClick={() => { setSelectedId(version.id); setRestoreError(null) }} type="button">
                  <strong>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(version.createdAt)}</strong>
                  <span>{version.reason} · {version.content.length} 字符</span>
                </button>
              ))}
            </ScrollArea>
            <div className="note-history-preview">
              <div className="note-history-summary">
                <span>当前正文 → 所选版本</span>
                <span className="note-history-added">+{changes?.added ?? 0} 行写入</span>
                <span className="note-history-removed">−{changes?.removed ?? 0} 行移除</span>
                {changes?.simplified ? <span>长文使用简化差异，行数可能包含未变化内容</span> : null}
                {changes?.truncated ? <span>仅展示开头和结尾的差异</span> : null}
              </div>
              <div aria-label="逐行差异" className="note-history-diff" role="list">
                {changes?.rows.map((row, index) => <div className="note-history-diff-row" data-kind={row.kind} key={index} role="listitem">
                  <span className="note-history-diff-number">{row.currentLine ?? ""}</span>
                  <span className="note-history-diff-number">{row.selectedLine ?? ""}</span>
                  <span className="note-history-diff-sign">{row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "}</span>
                  <code>{row.text || " "}</code>
                </div>)}
              </div>
            </div>
          </div>
        )}
        {restoreError ? <p role="alert">{restoreError}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <DialogFooter>
          <Button disabled={Boolean(action) || loading || !cacheId || loadedKey !== noteKey} onClick={() => void historyAction("snapshot")} variant="outline">保存当前快照</Button>
          <Button disabled={Boolean(action) || loading || !currentVersions.length} onClick={() => void historyAction("export")} variant="outline">导出历史</Button>
          <Button disabled={Boolean(action) || loading || !cacheId} onClick={() => importRef.current?.click()} variant="outline">导入历史</Button>
          <Button onClick={() => onOpenChange(false)} variant="outline">关闭</Button>
          <Button disabled={Boolean(action) || !selected} onClick={() => void restore("copy")} variant="outline">
            {action === "copy" ? "正在创建副本…" : "恢复为副本"}
          </Button>
          <Button disabled={Boolean(action) || !selected || selected.content === currentContent} onClick={() => void restore("restore")}>
            {action === "restore" ? "正在保存保护版本…" : "恢复此版本"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
