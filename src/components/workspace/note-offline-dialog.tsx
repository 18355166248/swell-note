import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { prepareOfflineNote, type OfflineAssetResult } from "@/services/vault/prepare-offline-note"
import type { VaultAsset } from "@/services/vault/vault-adapter"

export function NoteOfflineDialog({ open, onOpenChange, content, documentKey, readAsset }: { open: boolean; onOpenChange: (open: boolean) => void; content: string; documentKey: string; readAsset: (source: string) => Promise<VaultAsset | null> }) {
  const [results, setResults] = useState<OfflineAssetResult[]>([]), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0)
  const reader = useRef(readAsset); reader.current = readAsset
  useEffect(() => {
    if (!open) return
    let disposed = false
    const read = reader.current
    setResults([]); setBusy(true)
    // 读取器绑定本次文档，换库/关闭后旧结果不进入新会话。
    void prepareOfflineNote(content, read, (result) => setResults((current) => [...current, result]), () => !disposed)
      .finally(() => { if (!disposed) setBusy(false) })
    return () => { disposed = true }
  }, [open, documentKey, content, attempt])
  const failures = results.filter((result) => result.error).length
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>准备当前笔记离线附件</DialogTitle><DialogDescription>读取当前正文中的普通、引用式附件链接和嵌入附件。坚果云附件会保存到本机缓存；外部网址不在本次范围，其他笔记需分别准备。</DialogDescription></DialogHeader>
    <p role="status">{busy ? "正在准备…" : "本轮检查完成"} · {results.length - failures} 个成功 · {failures} 个失败 · {(results.reduce((sum, result) => sum + result.bytes, 0) / 1024 / 1024).toFixed(1)} MB</p>
    <ul className="max-h-64 overflow-y-auto">{results.map((result) => <li key={result.source} className="break-all py-2">{result.source}：{result.error ?? "已读取"}</li>)}</ul>
    {!busy && !results.length ? <p>当前正文没有本次可准备的附件。</p> : null}
    <DialogFooter><Button disabled={busy} onClick={() => setAttempt((value) => value + 1)} variant="outline">重新检查</Button><Button onClick={() => onOpenChange(false)}>{busy ? "停止后续读取" : "关闭"}</Button></DialogFooter>
  </DialogContent></Dialog>
}
