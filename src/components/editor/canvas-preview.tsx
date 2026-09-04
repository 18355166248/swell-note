import { useEffect, useId, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { openExternalUrl } from "@/services/open-external-url"
import type { VaultAsset } from "@/services/vault/vault-adapter"

type CanvasSide = "bottom" | "left" | "right" | "top"
type CanvasNode = {
  color?: string
  height: number
  id: string
  label?: string
  text?: string
  type: "file" | "group" | "link" | "text"
  url?: string
  file?: string
  width: number
  x: number
  y: number
}

type CanvasEdge = {
  color?: string
  fromEnd?: "arrow" | "none"
  fromNode: string
  fromSide?: CanvasSide
  id: string
  label?: string
  toEnd?: "arrow" | "none"
  toNode: string
  toSide?: CanvasSide
}

type CanvasPreviewProps = {
  content: string
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onWikiLink: (target: string) => void
}

const colorMap: Record<string, string> = {
  "1": "#dc2626", "2": "#d97706", "3": "#ca8a04", "4": "#16a34a", "5": "#0891b2", "6": "#7c3aed",
}
const markdownFilePattern = /\.(?:canvas|md)$/i
const imageFilePattern = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i
const remarkPlugins = [remarkGfm]

export default function CanvasPreview({ content, onResolveAsset, onWikiLink }: CanvasPreviewProps) {
  const markerId = useId().replace(/:/g, "")
  let canvas: { edges?: CanvasEdge[]; nodes?: CanvasNode[] }
  try {
    canvas = JSON.parse(content) as typeof canvas
  } catch {
    return <div className="canvas-preview-error">Canvas 文件不是有效的 JSON，已保留原文件且未做修改。</div>
  }
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : []
  const edges = Array.isArray(canvas.edges) ? canvas.edges : []
  if (!nodes.length) return <div className="canvas-preview-empty">这是一个空白 Canvas。</div>

  const bounds = getCanvasBounds(nodes)
  if (!bounds) return <div className="canvas-preview-error">Canvas 中存在无效节点尺寸，无法安全展示。</div>
  const { height, minX, minY, width } = bounds
  const byId = new Map(nodes.map((node) => [node.id, node]))

  return (
    <div className="canvas-preview-viewport">
      <div className="canvas-preview" style={{ height, width }}>
        <svg aria-hidden="true" className="canvas-edges" height={height} width={width}>
          <defs>
            <marker id={`${markerId}-arrow`} markerHeight="7" markerWidth="7" orient="auto-start-reverse" refX="6" refY="3.5">
              <path d="M0,0 L7,3.5 L0,7 z" fill="context-stroke" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = byId.get(edge.fromNode)
            const to = byId.get(edge.toNode)
            if (!from || !to) return null
            const start = connectionPoint(from, edge.fromSide ?? "right", minX, minY)
            const end = connectionPoint(to, edge.toSide ?? "left", minX, minY)
            const color = colorMap[edge.color ?? ""] ?? edge.color
            return (
              <g key={edge.id}>
                <line
                  markerEnd={(edge.toEnd ?? "arrow") === "arrow" ? `url(#${markerId}-arrow)` : undefined}
                  markerStart={edge.fromEnd === "arrow" ? `url(#${markerId}-arrow)` : undefined}
                  style={{ color, stroke: color }}
                  x1={start.x}
                  x2={end.x}
                  y1={start.y}
                  y2={end.y}
                />
                {edge.label ? <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 6}>{edge.label}</text> : null}
              </g>
            )
          })}
        </svg>
        {nodes.map((node) => (
          <article
            className="canvas-node"
            data-type={node.type}
            key={node.id}
            style={{
              borderColor: colorMap[node.color ?? ""] ?? node.color,
              height: node.height,
              left: node.x - minX + 40,
              top: node.y - minY + 40,
              width: node.width,
            }}
          >
            {node.label ? <strong>{node.label}</strong> : null}
            {node.type === "file" && node.file ? (
              <CanvasFileNode file={node.file} onResolveAsset={onResolveAsset} onWikiLink={onWikiLink} />
            ) : null}
            {node.type === "link" && node.url ? (
              // 与阅读态外链一致：Tauri WebView 里 target=_blank 会被静默拒绝，统一走 openExternalUrl。
              <a
                href={node.url}
                onClick={(event) => {
                  event.preventDefault()
                  void openExternalUrl(node.url!)
                }}
                rel="noreferrer noopener"
                target="_blank"
              >
                {node.url}
              </a>
            ) : null}
            {node.text ? <ReactMarkdown remarkPlugins={remarkPlugins}>{node.text}</ReactMarkdown> : null}
          </article>
        ))}
      </div>
    </div>
  )
}

function CanvasFileNode({ file, onResolveAsset, onWikiLink }: {
  file: string
  onResolveAsset: CanvasPreviewProps["onResolveAsset"]
  onWikiLink: CanvasPreviewProps["onWikiLink"]
}) {
  if (markdownFilePattern.test(file)) return <button onClick={() => onWikiLink(file)} type="button">{file}</button>
  if (imageFilePattern.test(file)) return <CanvasImage file={file} onResolveAsset={onResolveAsset} />
  return <CanvasAttachment file={file} onResolveAsset={onResolveAsset} />
}

function CanvasImage({ file, onResolveAsset }: { file: string; onResolveAsset: CanvasPreviewProps["onResolveAsset"] }) {
  const [state, setState] = useState<{ status: "error" | "loading" | "ready"; url?: string }>({ status: "loading" })
  useEffect(() => {
    let disposed = false
    let objectUrl = ""
    void onResolveAsset(file).then((asset) => {
      if (!asset || disposed) {
        if (!disposed) setState({ status: "error" })
        return
      }
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(asset.data).buffer], { type: asset.mimeType }))
      setState({ status: "ready", url: objectUrl })
    }).catch(() => {
      if (!disposed) setState({ status: "error" })
    })
    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, onResolveAsset])
  return state.status === "ready" && state.url
    ? <img alt={file} loading="lazy" src={state.url} />
    : <span className="canvas-file-state">{state.status === "error" ? "无法读取图片" : "正在读取图片…"}</span>
}

function CanvasAttachment({ file, onResolveAsset }: { file: string; onResolveAsset: CanvasPreviewProps["onResolveAsset"] }) {
  const [status, setStatus] = useState<"error" | "idle" | "loading">("idle")
  const open = async () => {
    setStatus("loading")
    try {
      const asset = await onResolveAsset(file)
      if (!asset) {
        setStatus("error")
        return
      }
      const url = URL.createObjectURL(new Blob([new Uint8Array(asset.data).buffer], { type: asset.mimeType }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = file.split("/").pop() ?? "附件"
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setStatus("idle")
    } catch {
      setStatus("error")
    } finally {
      setStatus((current) => current === "loading" ? "idle" : current)
    }
  }
  return <button disabled={status === "loading"} onClick={() => void open()} type="button">{
    status === "loading" ? "正在读取…" : status === "error" ? `重试：${file}` : file
  }</button>
}

function getCanvasBounds(nodes: CanvasNode[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    if (![node.x, node.y, node.width, node.height].every(Number.isFinite)) return null
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }
  return {
    height: Math.max(240, maxY - minY + 80),
    minX,
    minY,
    width: Math.max(320, maxX - minX + 80),
  }
}

function connectionPoint(node: CanvasNode, side: CanvasSide, minX: number, minY: number) {
  const left = node.x - minX + 40
  const top = node.y - minY + 40
  if (side === "left") return { x: left, y: top + node.height / 2 }
  if (side === "right") return { x: left + node.width, y: top + node.height / 2 }
  if (side === "top") return { x: left + node.width / 2, y: top }
  return { x: left + node.width / 2, y: top + node.height }
}
