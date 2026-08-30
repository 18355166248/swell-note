import { useEffect, useState } from "react"
import { History, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { listNoteVersions, summarizeLineChanges, type NoteVersion } from "@/services/history/note-history"

export function NoteVersionHistoryDialog({ cacheId, currentContent, noteId, onOpenChange, onRestore, open }: {
  cacheId: string | null
  currentContent: string
  noteId: string
  onOpenChange: (open: boolean) => void
  onRestore: (content: string) => void
  open: boolean
}) {
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !cacheId) return
    let cancelled = false
    setLoading(true)
    void listNoteVersions(cacheId, noteId)
      .then((items) => {
        if (cancelled) return
        setVersions(items)
        setSelectedId(items[0]?.id ?? "")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [cacheId, noteId, open])

  const selected = versions.find((version) => version.id === selectedId) ?? versions[0]
  const changes = selected ? summarizeLineChanges(selected.content, currentContent) : null

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="note-history-dialog">
        <DialogHeader>
          <DialogTitle>本地版本历史</DialogTitle>
          <DialogDescription>版本仅保存在当前设备，最多保留 30 个；恢复后会作为新的本地修改保存。</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="note-history-empty"><LoaderCircle className="animate-spin" /> 正在读取历史版本…</div>
        ) : versions.length === 0 ? (
          <div className="note-history-empty"><History /> 编辑并保存后，这里会出现修改前的版本。</div>
        ) : (
          <div className="note-history-layout">
            <ScrollArea className="note-history-list">
              {versions.map((version) => (
                <button className="note-history-item" data-active={version.id === selected?.id} key={version.id} onClick={() => setSelectedId(version.id)} type="button">
                  <strong>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(version.createdAt)}</strong>
                  <span>{version.reason} · {version.content.length} 字符</span>
                </button>
              ))}
            </ScrollArea>
            <div className="note-history-preview">
              <div className="note-history-summary">
                <span>相对当前版本</span>
                <span className="note-history-added">+{changes?.added ?? 0} 行</span>
                <span className="note-history-removed">−{changes?.removed ?? 0} 行</span>
              </div>
              <pre>{selected?.content}</pre>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">关闭</Button>
          <Button disabled={!selected || selected.content === currentContent} onClick={() => {
            if (!selected || !window.confirm("恢复后，当前正文会先保存为一个历史版本。确认继续？")) return
            onRestore(selected.content)
            onOpenChange(false)
          }}>恢复此版本</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
