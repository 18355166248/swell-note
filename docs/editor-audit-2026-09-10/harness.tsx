import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarkdownEditor, type MarkdownEditorHandle } from '../../src/components/editor/markdown-editor'
import { EditorView } from '@codemirror/view'
import { FormattingToolbar } from '../../src/components/workspace/formatting-toolbar'
import type { EditorFormatState } from '../../src/components/editor/markdown-input'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import '../../src/App.css'

// 自动化验证专用：让脚本能在页面里读写 CodeMirror 选区（仅复现页，不进生产包）。
;(window as unknown as { __auditView: () => EditorView | null }).__auditView =
  () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)

// 独立内存样本复用生产编辑器与工具栏，不接入用户笔记库和同步服务。
function Audit() {
  const [seed, setSeed] = useState('第一段\n\n第二段')
  const [value, setValue] = useState(seed)
  const [generation, setGeneration] = useState(0)
  const [format, setFormat] = useState<EditorFormatState | null>(null)
  const [table, setTable] = useState(false)
  const [selection, setSelection] = useState(false)
  const [history, setHistory] = useState([false, false])
  // 附件插入模拟：可控延迟与失败的内存写入替身，复刻 workspace.handleInsertFiles 的接线
  // （busy 守卫 → captureInsertion 书签 → 异步完成后 insert），不触达真实笔记库。
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [delay, setDelay] = useState(800)
  const [fail, setFail] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const ref = useRef<MarkdownEditorHandle>(null)
  const fakeInsert = async (count: number) => {
    // 与生产 handleInsertFiles 一致：并发守卫用 ref（state 闭包在同一渲染里看不到已开始的批次）。
    if (busyRef.current) { setAttachError('上一批附件仍在写入，请完成后再试'); return }
    const insertion = ref.current?.captureInsertion()
    busyRef.current = true
    setBusy(true)
    setAttachError(null)
    try {
      await new Promise(resolve => setTimeout(resolve, delay))
      if (fail) throw new Error('模拟写入失败')
      const markdown = `${Array.from({ length: count }, (_, index) => `![测试图${index + 1}](attachments/fake-${index + 1}.png)`).join('\n\n')}\n`
      if (!insertion?.insert(markdown)) setAttachError('编辑器已卸载，插入被取消（完整应用中回退追加到原笔记末尾）')
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : '插入附件失败')
    } finally {
      insertion?.dispose()
      busyRef.current = false
      setBusy(false)
    }
  }
  return <main style={{ maxWidth: 1100, margin: '24px auto', padding: 20 }}>
    <h1>编辑器独立审计：仅内存样本</h1>
    <textarea aria-label="样本源码" value={seed} onChange={e => setSeed(e.target.value)} style={{ width: '100%', height: 90, border: '1px solid #999' }} />
    <button onClick={() => { setValue(seed); setFormat(null); setTable(false); setSelection(false); setHistory([false, false]); setGeneration(g => g + 1) }}>载入样本</button>
    <fieldset style={{ marginTop: 12, border: '1px solid #bbb' }}>
      <legend>附件插入模拟（内存替身，可控延迟）</legend>
      <label>延迟毫秒 <input aria-label="延迟毫秒" type="number" value={delay} onChange={e => setDelay(Number(e.target.value) || 0)} style={{ width: 90 }} /></label>
      <label style={{ marginLeft: 12 }}><input checked={fail} onChange={e => setFail(e.target.checked)} type="checkbox" /> 模拟失败</label>
      {/* 与生产 FormatButton 一致：pointerdown 阻止默认，点击不抢编辑器/单元格焦点。 */}
      <button disabled={busy} onClick={() => void fakeInsert(1)} onPointerDown={e => e.preventDefault()} style={{ marginLeft: 12 }}>{busy ? '写入中…' : '插入一张测试图'}</button>
      <button disabled={busy} onClick={() => void fakeInsert(2)} onPointerDown={e => e.preventDefault()} style={{ marginLeft: 8 }}>插入两张测试图</button>
      {attachError ? <p aria-label="附件错误" role="alert" style={{ color: '#b00', margin: '8px 0 0' }}>{attachError}</p> : null}
    </fieldset>
    <section className="note-editor" style={{ border: '1px solid #aaa', marginTop: 12 }}>
      <FormattingToolbar editorRef={ref} onFormat={text => ref.current?.insertText(text)} onInsertFiles={() => Promise.resolve()} canInsertAttachment={false} attachmentBusy={false} canUndo={history[0]} canRedo={history[1]} formatState={format} editingTable={table} hasSelection={selection} />
      <MarkdownEditor key={generation} ref={ref} value={value} onChange={setValue} onFormatStateChange={setFormat} onEditingTargetChange={setTable} onSelectionChange={setSelection} onHistoryChange={(u, r) => setHistory([u, r])} />
    </section>
    <h2>实际写入的 Markdown</h2><pre aria-label="实际源码" style={{ whiteSpace: 'pre-wrap', padding: 12, background: '#eee', color: '#111' }}>{value}</pre>
    <h2>标准 GFM 渲染核对</h2><section aria-label="渲染核对"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown></section>
  </main>
}
createRoot(document.getElementById('root')!).render(<TooltipProvider><Audit /></TooltipProvider>)
