import { diffLines } from "diff"
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react"

import "@/App.css"
import { CodeMirrorLab } from "./code-mirror-lab"
import {
  DEFAULT_EDITOR_LAB_MARKDOWN,
  EDITOR_LAB_IDS,
  expandMarkdown,
  markdownDiffSummary,
  markdownStats,
  type EditorLabId,
} from "./editor-lab-model"
import { MilkdownLab } from "./milkdown-lab"
import { VditorLab } from "./vditor-lab"
import "./editor-lab.css"

type EditorMetric = {
  error: string | null
  inputLatencyMs: number | null
  readyMs: number | null
}

type EditorOutputs = Record<EditorLabId, string>
type EditorMetrics = Record<EditorLabId, EditorMetric>

const EDITOR_LABELS: Record<EditorLabId, { description: string; name: string }> = {
  codemirror: { name: "CodeMirror 6", description: "Swell Note 当前实现" },
  vditor: { name: "Vditor 4", description: "Markdown 即时渲染" },
  milkdown: { name: "Milkdown Crepe", description: "ProseMirror 结构化编辑" },
}

function createOutputs(markdown: string): EditorOutputs {
  return { codemirror: markdown, milkdown: markdown, vditor: markdown }
}

function createMetrics(): EditorMetrics {
  const metric = (): EditorMetric => ({ error: null, inputLatencyMs: null, readyMs: null })
  return { codemirror: metric(), milkdown: metric(), vditor: metric() }
}

export default function EditorLabPage() {
  const [run, setRun] = useState(() => ({ generation: 0, markdown: DEFAULT_EDITOR_LAB_MARKDOWN, startedAt: performance.now() }))
  const [outputs, setOutputs] = useState<EditorOutputs>(() => createOutputs(DEFAULT_EDITOR_LAB_MARKDOWN))
  const [metrics, setMetrics] = useState<EditorMetrics>(createMetrics)
  const [reportMessage, setReportMessage] = useState("")
  const sourceStats = useMemo(() => markdownStats(run.markdown), [run.markdown])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const startRun = useCallback((markdown: string) => {
    setOutputs(createOutputs(markdown))
    setMetrics(createMetrics())
    setReportMessage("")
    setRun((previous) => ({ generation: previous.generation + 1, markdown, startedAt: performance.now() }))
  }, [])

  const updateOutput = useCallback((id: EditorLabId, markdown: string, inputLatencyMs: number | null) => {
    setOutputs((previous) => previous[id] === markdown ? previous : { ...previous, [id]: markdown })
    if (inputLatencyMs !== null) {
      setMetrics((previous) => ({ ...previous, [id]: { ...previous[id], inputLatencyMs } }))
    }
  }, [])

  const markReady = useCallback((id: EditorLabId, markdown: string, readyMs: number) => {
    setOutputs((previous) => ({ ...previous, [id]: markdown }))
    setMetrics((previous) => ({ ...previous, [id]: { ...previous[id], error: null, readyMs } }))
  }, [])

  const markError = useCallback((id: EditorLabId, message: string) => {
    setMetrics((previous) => ({ ...previous, [id]: { ...previous[id], error: message } }))
  }, [])

  // 三个适配器常驻页面；绑定后的回调保持稳定，实时差异刷新不会让重型编辑器无意义重渲染。
  const editorCallbacks = useMemo(() => ({
    codemirror: {
      onChange: (markdown: string, latency: number | null) => updateOutput("codemirror", markdown, latency),
      onReady: (markdown: string, readyMs: number) => markReady("codemirror", markdown, readyMs),
    },
    milkdown: {
      onChange: (markdown: string, latency: number | null) => updateOutput("milkdown", markdown, latency),
      onError: (message: string) => markError("milkdown", message),
      onReady: (markdown: string, readyMs: number) => markReady("milkdown", markdown, readyMs),
    },
    vditor: {
      onChange: (markdown: string, latency: number | null) => updateOutput("vditor", markdown, latency),
      onError: (message: string) => markError("vditor", message),
      onReady: (markdown: string, readyMs: number) => markReady("vditor", markdown, readyMs),
    },
  }), [markError, markReady, updateOutput])

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    startRun(await file.text())
  }

  const exportReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      source: { ...sourceStats, markdown: run.markdown },
      editors: Object.fromEntries(EDITOR_LAB_IDS.map((id) => [id, {
        diff: markdownDiffSummary(run.markdown, outputs[id]),
        markdown: outputs[id],
        metrics: metrics[id],
        stats: markdownStats(outputs[id]),
      }])),
      userAgent: navigator.userAgent,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `swell-note-editor-lab-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setReportMessage("对比报告已导出")
  }

  return (
    <main className="editor-lab">
      <header className="editor-lab-header">
        <div>
          <a className="editor-lab-back" href="#/notes">← 返回笔记</a>
          <h1>Editor Lab</h1>
          <p>三个编辑器从同一份 Markdown 独立开始。修改任意一栏后，下方会显示序列化结果与原文的差异。</p>
        </div>
        <div className="editor-lab-source-stats" aria-label="当前测试文档规模">
          <strong>{sourceStats.characters.toLocaleString()}</strong><span>字符</span>
          <strong>{sourceStats.lines.toLocaleString()}</strong><span>行</span>
        </div>
      </header>

      <section className="editor-lab-controls" aria-label="实验控制">
        <input accept=".md,.markdown,text/markdown,text/plain" hidden onChange={(event) => { void loadFile(event) }} ref={fileInputRef} type="file" />
        <button onClick={() => fileInputRef.current?.click()} type="button">加载真实 .md</button>
        <button onClick={() => startRun(DEFAULT_EDITOR_LAB_MARKDOWN)} type="button">恢复标准样本</button>
        <span className="editor-lab-control-divider" />
        <span>长文：</span>
        <button onClick={() => startRun(expandMarkdown(DEFAULT_EDITOR_LAB_MARKDOWN, 20))} type="button">20×</button>
        <button onClick={() => startRun(expandMarkdown(DEFAULT_EDITOR_LAB_MARKDOWN, 100))} type="button">100×</button>
        <span className="editor-lab-control-spacer" />
        <button onClick={exportReport} type="button">导出对比报告</button>
        <span aria-live="polite" className="editor-lab-report-message">{reportMessage}</span>
      </section>

      <section className="editor-lab-checklist" aria-label="建议测试步骤">
        <span>输入法：连续输入“测试中文输入”并选词</span>
        <span>表格：编辑、粘贴二维数据</span>
        <span>历史：输入 → 格式化 → 撤销/重做</span>
        <span>图片：在图片前后输入并滚动</span>
      </section>

      <section className="editor-lab-grid">
        <EditorCard id="codemirror" metrics={metrics.codemirror} output={outputs.codemirror} source={run.markdown}>
          <CodeMirrorLab
            key={`codemirror-${run.generation}`}
            initialMarkdown={run.markdown}
            onChange={editorCallbacks.codemirror.onChange}
            onReady={editorCallbacks.codemirror.onReady}
            startedAt={run.startedAt}
          />
        </EditorCard>
        <EditorCard id="vditor" metrics={metrics.vditor} output={outputs.vditor} source={run.markdown}>
          <VditorLab
            key={`vditor-${run.generation}`}
            initialMarkdown={run.markdown}
            onChange={editorCallbacks.vditor.onChange}
            onError={editorCallbacks.vditor.onError}
            onReady={editorCallbacks.vditor.onReady}
            startedAt={run.startedAt}
          />
        </EditorCard>
        <EditorCard id="milkdown" metrics={metrics.milkdown} output={outputs.milkdown} source={run.markdown}>
          <MilkdownLab
            key={`milkdown-${run.generation}`}
            initialMarkdown={run.markdown}
            onChange={editorCallbacks.milkdown.onChange}
            onError={editorCallbacks.milkdown.onError}
            onReady={editorCallbacks.milkdown.onReady}
            startedAt={run.startedAt}
          />
        </EditorCard>
      </section>
    </main>
  )
}

const EditorCard = memo(function EditorCard({ children, id, metrics, output, source }: {
  children: ReactNode
  id: EditorLabId
  metrics: EditorMetric
  output: string
  source: string
}) {
  const labels = EDITOR_LABELS[id]
  const deferredOutput = useDeferredValue(output)
  const diff = useMemo(() => markdownDiffSummary(source, deferredOutput), [deferredOutput, source])
  const stats = useMemo(() => markdownStats(deferredOutput), [deferredOutput])
  return (
    <article className="editor-lab-card" data-editor={id}>
      <header className="editor-lab-card-header">
        <div><h2>{labels.name}</h2><p>{labels.description}</p></div>
        <span className={diff.exact ? "editor-lab-exact" : "editor-lab-changed"}>{diff.exact ? "原文一致" : `+${diff.addedLines} / −${diff.removedLines} 行`}</span>
      </header>
      <div className="editor-lab-metrics">
        <span>初始化 <strong>{formatMetric(metrics.readyMs)}</strong></span>
        <span>最近输入回调 <strong>{formatMetric(metrics.inputLatencyMs)}</strong></span>
        <span>{stats.characters.toLocaleString()} 字符</span>
      </div>
      {metrics.error ? <p className="editor-lab-error" role="alert">{metrics.error}</p> : null}
      {children}
      <DiffInspector output={deferredOutput} source={source} />
    </article>
  )
})

const DiffInspector = memo(function DiffInspector({ output, source }: { output: string; source: string }) {
  const parts = useMemo(() => diffLines(source, output), [output, source])
  const exact = source === output
  return (
    <details className="editor-lab-diff">
      <summary>{exact ? "查看保存后的 Markdown（完全一致）" : "查看保存后的 Markdown 差异"}</summary>
      <pre>{parts.map((part, index) => {
        const value = part.value.length > 4000 ? `${part.value.slice(0, 4000)}\n…此段已截断…\n` : part.value
        return <span className={part.added ? "diff-added" : part.removed ? "diff-removed" : "diff-same"} key={`${index}-${part.count}`}>{value}</span>
      })}</pre>
    </details>
  )
})

function formatMetric(value: number | null) {
  return value === null ? "等待中" : `${value.toFixed(value < 10 ? 1 : 0)} ms`
}
