import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { serializeAsJSON } from "@excalidraw/excalidraw"
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState, NormalizedZoomValue } from "@excalidraw/excalidraw/types"
import "@excalidraw/excalidraw/index.css"

import type { NoteRendererPluginProps } from "@/plugins/note-renderer"
import { extractExcalidrawTextElements } from "@/services/markdown/markdown-preview-utils"
import { parseExcalidrawMarkdown, serializeExcalidrawMarkdown, type ExcalidrawScene } from "./excalidraw-parser"

const LazyExcalidraw = lazy(async () => {
  const module = await import("@excalidraw/excalidraw")
  return { default: module.Excalidraw }
})

const DEFAULT_ZOOM = { value: 1 as NormalizedZoomValue } as const

export default function ExcalidrawPreview({ content, editable = false, immersive = false, onContentChange }: NoteRendererPluginProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const contentRef = useRef(content)
  const onContentChangeRef = useRef(onContentChange)
  const pendingSceneRef = useRef<ExcalidrawScene | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const userInteractedRef = useRef(false)
  const result = useMemo(() => {
    try {
      return { scene: parseExcalidrawMarkdown(content) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "无法读取 Excalidraw 画布" }
    }
  }, [content])

  contentRef.current = content
  onContentChangeRef.current = onContentChange

  const flushPendingScene = useCallback(() => {
    if (!editable || !pendingSceneRef.current || !onContentChangeRef.current) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    const nextContent = serializeExcalidrawMarkdown(contentRef.current, pendingSceneRef.current)
    pendingSceneRef.current = null
    if (nextContent === contentRef.current) return
    contentRef.current = nextContent
    onContentChangeRef.current(nextContent)
  }, [editable])

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushPendingScene()
    }
    document.addEventListener("visibilitychange", flushWhenHidden)
    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden)
      flushPendingScene()
    }
  }, [flushPendingScene])

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
    <section aria-label={editable ? "Excalidraw 可编辑画布" : "Excalidraw 只读画布"} className="excalidraw-plugin" data-editable={editable} data-immersive={immersive} data-plugin-id="official.excalidraw">
      <div className="excalidraw-plugin-canvas">
        <Suspense fallback={<div className="note-renderer-loading" role="status">正在初始化画布…</div>}>
          <LazyExcalidraw
            excalidrawAPI={setApi}
            initialData={initialData}
            langCode="zh-CN"
            onChange={(elements, appState, files) => {
              // 初始化、居中和只读浏览也会触发 onChange；只有明确操作过画布后才进入保存队列，避免打开即污染文件。
              if (!editable || !userInteractedRef.current || !onContentChangeRef.current) return
              const serialized = JSON.parse(serializeAsJSON(elements, appState, files, "local")) as ExcalidrawScene
              pendingSceneRef.current = { ...serialized, source: scene.source ?? serialized.source }
              if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
              saveTimerRef.current = window.setTimeout(flushPendingScene, 450)
            }}
            onPointerDown={() => { userInteractedRef.current = true }}
            viewModeEnabled={!editable}
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
