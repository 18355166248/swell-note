import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { exportTextDocument, markdownExportFilename } from "@/services/export/markdown-export"
import type { VaultAsset } from "@/services/vault/vault-adapter"

export function NoteDeliveryDialog({ open, onOpenChange, content, title, documentKey, readAsset }: { open: boolean; onOpenChange: (value: boolean) => void; content: string; title: string; documentKey: string; readAsset: (source: string) => Promise<VaultAsset | null> }) {
  const [result, setResult] = useState<{ html: string; warnings: string[] } | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null), reader = useRef(readAsset)
  reader.current = readAsset
  useEffect(() => {
    setResult(null); setError(""); setPreviewReady(false)
    if (!open) return
    let disposed = false
    const read = reader.current
    void import("@/services/export/html-export").then(({ createHtmlDocument }) => createHtmlDocument({ content, title, readAsset: (source) => {
      if (disposed) throw new Error("导出会话已结束")
      return read(source)
    } })).then((next) => { if (!disposed) setResult(next) }).catch((reason) => { if (!disposed) setError(reason instanceof Error ? reason.message : "生成导出预览失败") })
    return () => { disposed = true }
  }, [open, content, title, documentKey, attempt])
  const download = async () => {
    if (!result || busy) return
    setBusy(true); setError("")
    try { await exportTextDocument(result.html, markdownExportFilename(title).replace(/\.md$/i, ".html"), "html", "导出 HTML 笔记", "text/html") }
    catch (reason) { setError(reason instanceof Error ? reason.message : "导出失败") }
    finally { setBusy(false) }
  }
  const print = () => {
    if (!previewReady || !frame.current?.contentWindow) return
    try { frame.current.contentWindow.focus(); frame.current.contentWindow.print() }
    catch { setError("当前环境无法打开打印窗口，请先下载 HTML，在浏览器中打开后打印或另存为 PDF。") }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="note-delivery-dialog">
      <DialogHeader><DialogTitle>导出与打印</DialogTitle><DialogDescription>导出当前正文快照。HTML 包含可读取的本地附件；打印窗口可选择另存为 PDF。外部图片仍需联网。</DialogDescription></DialogHeader>
      {error ? <p role="alert">{error}<Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>重新生成</Button></p> : null}
      {result ? <><p role="status">{result.warnings.length ? `有 ${result.warnings.length} 项导出说明，请检查预览。` : "预览已生成"}</p><iframe ref={frame} title="导出预览" srcDoc={result.html} sandbox="allow-same-origin allow-modals" onLoad={() => setPreviewReady(true)} /></> : !error ? <p role="status">正在生成导出预览…</p> : null}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button><Button disabled={!result || busy} onClick={() => void download()}>下载 HTML</Button><Button disabled={!result || !previewReady} onClick={print} variant="outline">打印 / 保存 PDF</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
