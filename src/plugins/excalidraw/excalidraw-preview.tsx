import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState, NormalizedZoomValue } from "@excalidraw/excalidraw/types"
import "@excalidraw/excalidraw/index.css"

import type { NoteRendererPluginProps } from "@/plugins/note-renderer"
import { extractExcalidrawTextElements } from "@/services/markdown/markdown-preview-utils"
import { parseExcalidrawMarkdown } from "./excalidraw-parser"

const LazyExcalidraw = lazy(async () => {
  const module = await import("@excalidraw/excalidraw")
  return { default: module.Excalidraw }
})

const DEFAULT_ZOOM = { value: 1 as NormalizedZoomValue } as const

export default function ExcalidrawPreview({ content, immersive = false }: NoteRendererPluginProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const result = useMemo(() => {
    try {
      return { scene: parseExcalidrawMarkdown(content) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "无法读取 Excalidraw 画布" }
    }
  }, [content])

  const scene = result.scene
  useEffect(() => {
    if (!api || !scene) return
    // API 回调早于内部 App 完成挂载；延后一帧再居中，避免调用尚未挂载组件的 setState。
    const frame = window.requestAnimationFrame(() => {
      api.scrollToContent(api.getSceneElements(), { animate: false, fitToContent: true, maxZoom: 1, minZoom: 1 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [api, content, scene])

  if (!scene) return <ExcalidrawFallback content={content} error={result.error} />

  const { scrollX: _scrollX, scrollY: _scrollY, zoom: _zoom, ...portableAppState } = scene.appState ?? {}
  const initialData: ExcalidrawInitialDataState = {
    appState: { ...portableAppState, zoom: DEFAULT_ZOOM },
    elements: scene.elements,
    files: scene.files,
    scrollToContent: false,
  } as ExcalidrawInitialDataState

  return (
    <section className="excalidraw-plugin" data-immersive={immersive} data-plugin-id="official.excalidraw">
      <div className="excalidraw-plugin-canvas">
        <Suspense fallback={<div className="note-renderer-loading" role="status">正在初始化画布…</div>}>
          <LazyExcalidraw
            excalidrawAPI={setApi}
            initialData={initialData}
            langCode="zh-CN"
            // 开启官方编辑界面才能显示顶部绘图快捷栏；当前未接 onChange，操作只留在本次页面内，不会写回坚果云。
            viewModeEnabled={false}
          />
        </Suspense>
      </div>
      {!immersive ? <details className="excalidraw-plugin-source">
        <summary>查看原始 Markdown</summary>
        <pre><code>{content}</code></pre>
      </details> : null}
    </section>
  )
}

function ExcalidrawFallback({ content, error }: { content: string; error?: string }) {
  const textElements = extractExcalidrawTextElements(content)
  return (
    <div className="markdown-preview excalidraw-summary" data-plugin-id="official.excalidraw">
      <div className="excalidraw-summary-heading">
        <span aria-hidden="true">◇</span>
        <div><strong>Excalidraw 绘图</strong><p>{error ?? "画布模块暂时无法加载，已切换文本预览。"}</p></div>
      </div>
      {textElements.length ? (
        <ul>{textElements.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}</ul>
      ) : <p className="wiki-embed-state">这张画布没有可提取的文本元素。</p>}
      <details><summary>查看原始 Markdown</summary><pre><code>{content}</code></pre></details>
    </div>
  )
}
