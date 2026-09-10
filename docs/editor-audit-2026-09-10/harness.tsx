import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarkdownEditor, type MarkdownEditorHandle } from '../../src/components/editor/markdown-editor'
import { FormattingToolbar } from '../../src/components/workspace/formatting-toolbar'
import type { EditorFormatState } from '../../src/components/editor/markdown-input'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import '../../src/App.css'

// 独立内存样本复用生产编辑器与工具栏，不接入用户笔记库和同步服务。
function Audit() {
  const [seed, setSeed] = useState('第一段\n\n第二段')
  const [value, setValue] = useState(seed)
  const [generation, setGeneration] = useState(0)
  const [format, setFormat] = useState<EditorFormatState | null>(null)
  const [table, setTable] = useState(false)
  const [selection, setSelection] = useState(false)
  const [history, setHistory] = useState([false, false])
  const ref = useRef<MarkdownEditorHandle>(null)
  return <main style={{ maxWidth: 1100, margin: '24px auto', padding: 20 }}>
    <h1>编辑器独立审计：仅内存样本</h1>
    <textarea aria-label="样本源码" value={seed} onChange={e => setSeed(e.target.value)} style={{ width: '100%', height: 90, border: '1px solid #999' }} />
    <button onClick={() => { setValue(seed); setFormat(null); setTable(false); setSelection(false); setHistory([false, false]); setGeneration(g => g + 1) }}>载入样本</button>
    <section className="note-editor" style={{ border: '1px solid #aaa', marginTop: 12 }}>
      <FormattingToolbar editorRef={ref} onFormat={text => ref.current?.insertText(text)} onInsertFiles={() => {}} canInsertAttachment={false} attachmentBusy={false} canUndo={history[0]} canRedo={history[1]} formatState={format} editingTable={table} hasSelection={selection} />
      <MarkdownEditor key={generation} ref={ref} value={value} onChange={setValue} onFormatStateChange={setFormat} onEditingTargetChange={setTable} onSelectionChange={setSelection} onHistoryChange={(u, r) => setHistory([u, r])} />
    </section>
    <h2>实际写入的 Markdown</h2><pre aria-label="实际源码" style={{ whiteSpace: 'pre-wrap', padding: 12, background: '#eee', color: '#111' }}>{value}</pre>
    <h2>标准 GFM 渲染核对</h2><section aria-label="渲染核对"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown></section>
  </main>
}
createRoot(document.getElementById('root')!).render(<TooltipProvider><Audit /></TooltipProvider>)
