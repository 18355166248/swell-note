import { Component, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  isRelativeAttachmentHref,
  obsidianAnchorId,
  parseVaultAssetHref,
  parseWikiEmbedHref,
  parseWikiHref,
  rewriteWikiLinks,
  stripMarkdownFrontmatter,
} from "@/services/markdown/markdown-preview-utils"
import { resolveOfficialNoteRenderer } from "@/plugins/official-note-renderers"
import { remarkObsidian } from "@/services/markdown/remark-obsidian"
import type { VaultAsset } from "@/services/vault/vault-adapter"

export type EmbeddedWikiNote = { content: string; title: string }
export type EmbeddedWikiNoteResult =
  | { note: EmbeddedWikiNote; status: "ready" }
  | { status: "loading" | "missing" }

type MarkdownPreviewProps = {
  content: string
  immersive?: boolean
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onLoadWikiNote: (target: string) => void
  onResolveWikiNote: (target: string) => EmbeddedWikiNoteResult
  onWikiLink: (target: string) => void
}

const remarkPlugins = [remarkGfm, remarkObsidian]

export default function MarkdownPreview(props: MarkdownPreviewProps) {
  const renderer = resolveOfficialNoteRenderer(props.content)
  if (renderer) {
    const PluginRenderer = renderer.component
    return (
      <NoteRendererErrorBoundary content={props.content} label={renderer.label}>
        <Suspense fallback={<NoteRendererLoading label={renderer.label} />}>
          <PluginRenderer content={props.content} immersive={props.immersive} onResolveAsset={props.onResolveAsset} onWikiLink={props.onWikiLink} />
        </Suspense>
      </NoteRendererErrorBoundary>
    )
  }
  return <MarkdownContent {...props} depth={0} />
}

function NoteRendererLoading({ label }: { label: string }) {
  return <div className="note-renderer-loading" role="status">正在加载 {label} 预览…</div>
}

class NoteRendererErrorBoundary extends Component<{
  children: ReactNode
  content: string
  label: string
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`笔记渲染模块 ${this.props.label} 加载失败`, error, info)
  }

  componentDidUpdate(previous: Readonly<{ content: string }>) {
    if (previous.content !== this.props.content && this.state.failed) this.setState({ failed: false })
  }

  render() {
    if (this.state.failed) {
      return <div className="note-renderer-error">{this.props.label} 预览加载失败，可通过右上角菜单打开原始文件。</div>
    }
    return this.props.children
  }
}

function MarkdownContent({ content, depth, onLoadWikiNote, onResolveAsset, onResolveWikiNote, onWikiLink }: MarkdownPreviewProps & { depth: number }) {
  return (
    <div className={depth === 0 ? "markdown-preview" : "markdown-preview markdown-preview-embedded"}>
      <ReactMarkdown
        components={{
          a({ children, href }) {
            const embedTarget = parseWikiEmbedHref(href)
            if (embedTarget) {
              return (
                <button className="wiki-link" onClick={() => onWikiLink(embedTarget)} type="button">{children}</button>
              )
            }
            const wikiTarget = parseWikiHref(href)
            if (wikiTarget) {
              return (
                <button className="wiki-link" onClick={() => onWikiLink(wikiTarget)} type="button">
                  {children}
                </button>
              )
            }

            const assetSource = parseVaultAssetHref(href) ?? (isRelativeAttachmentHref(href) ? href : null)
            if (assetSource) {
              return (
                <VaultAttachment onResolveAsset={onResolveAsset} source={assetSource}>
                  {children}
                </VaultAttachment>
              )
            }

            return (
              <a href={href} rel="noreferrer noopener" target="_blank">
                {children}
              </a>
            )
          },
          img({ alt, src }) {
            return <VaultImage alt={alt} onResolveAsset={onResolveAsset} source={src} />
          },
          div({ children, node }) {
            const property = node?.properties?.["data-wiki-embed"] ?? node?.properties?.dataWikiEmbed
            const embedTarget = typeof property === "string" ? property : ""
            if (!embedTarget) return <div>{children}</div>
            return (
              <WikiEmbed
                depth={depth}
                onLoadWikiNote={onLoadWikiNote}
                onResolveAsset={onResolveAsset}
                onResolveWikiNote={onResolveWikiNote}
                onWikiLink={onWikiLink}
                target={embedTarget}
              />
            )
          },
          h1({ children }) { return <Heading level={1}>{children}</Heading> },
          h2({ children }) { return <Heading level={2}>{children}</Heading> },
          h3({ children }) { return <Heading level={3}>{children}</Heading> },
          h4({ children }) { return <Heading level={4}>{children}</Heading> },
          h5({ children }) { return <Heading level={5}>{children}</Heading> },
          h6({ children }) { return <Heading level={6}>{children}</Heading> },
        }}
        remarkPlugins={remarkPlugins}
        urlTransform={(url) => parseWikiHref(url) || parseWikiEmbedHref(url) || parseVaultAssetHref(url) ? url : defaultUrlTransform(url)}
      >
        {rewriteWikiLinks(stripMarkdownFrontmatter(content))}
      </ReactMarkdown>
    </div>
  )
}

function Heading({ children, level }: { children: ReactNode; level: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const id = obsidianAnchorId(reactNodeText(children))
  const Tag = `h${level}` as const
  return <Tag id={id || undefined}>{children}</Tag>
}

function WikiEmbed({ depth, onLoadWikiNote, onResolveAsset, onResolveWikiNote, onWikiLink, target }: {
  depth: number
  onLoadWikiNote: MarkdownPreviewProps["onLoadWikiNote"]
  onResolveAsset: MarkdownPreviewProps["onResolveAsset"]
  onResolveWikiNote: MarkdownPreviewProps["onResolveWikiNote"]
  onWikiLink: MarkdownPreviewProps["onWikiLink"]
  target: string
}) {
  const result = depth < 2 ? onResolveWikiNote(target) : { status: "missing" as const }

  useEffect(() => {
    if (result.status === "loading") onLoadWikiNote(target)
  }, [onLoadWikiNote, result.status, target])

  return (
    <section className="wiki-embed">
      <button className="wiki-embed-title" onClick={() => onWikiLink(target)} type="button">
        {result.status === "ready" ? result.note.title : target}
      </button>
      {result.status === "ready" && depth < 2 ? (
        <MarkdownContent
          content={result.note.content}
          depth={depth + 1}
          onLoadWikiNote={onLoadWikiNote}
          onResolveAsset={onResolveAsset}
          onResolveWikiNote={onResolveWikiNote}
          onWikiLink={onWikiLink}
        />
      ) : <p className="wiki-embed-state">{depth >= 2
        ? "嵌入层级过深，点击打开笔记"
        : result.status === "loading" ? "正在读取嵌入笔记…" : "找不到嵌入的笔记"}</p>}
    </section>
  )
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(reactNodeText).join("")
  if (node && typeof node === "object" && "props" in node) {
    return reactNodeText((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ""
}

type VaultImageProps = {
  alt?: string
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  source?: string
}

function VaultImage({ alt, onResolveAsset, source }: VaultImageProps) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; url?: string }>({
    status: "loading",
  })

  useEffect(() => {
    const resolvedSource = parseVaultAssetHref(source) ?? source
    if (!resolvedSource || /^[a-z][a-z\d+.-]*:/i.test(resolvedSource)) {
      setState({ status: "error" })
      return
    }

    let disposed = false
    let objectUrl: string | undefined
    setState({ status: "loading" })

    void onResolveAsset(resolvedSource)
      .then((asset) => {
        if (!asset || disposed) {
          if (!disposed) setState({ status: "error" })
          return
        }
        const data = new Uint8Array(asset.data).buffer
        objectUrl = URL.createObjectURL(new Blob([data], { type: asset.mimeType }))
        setState({ status: "ready", url: objectUrl })
      })
      .catch(() => {
        if (!disposed) setState({ status: "error" })
      })

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [onResolveAsset, source])

  if (state.status === "ready" && state.url) {
    return <img alt={alt ?? "笔记图片"} loading="lazy" src={state.url} />
  }

  return (
    <span className="markdown-image-state" data-status={state.status}>
      {state.status === "loading" ? "正在读取图片…" : `无法读取图片${alt ? `：${alt}` : ""}`}
    </span>
  )
}

type VaultAttachmentProps = {
  children: ReactNode
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  source: string
}

function VaultAttachment({ children, onResolveAsset, source }: VaultAttachmentProps) {
  const [requested, setRequested] = useState(false)
  const [state, setState] = useState<{
    mimeType?: string
    status: "idle" | "loading" | "ready" | "error"
    url?: string
  }>({ status: "idle" })

  useEffect(() => {
    if (!requested) return
    let disposed = false
    let objectUrl: string | undefined
    setState({ status: "loading" })

    // 附件可能很大，只在用户主动点击后读取；对象 URL 在卸载时释放，避免长时间预览造成内存泄漏。
    void onResolveAsset(source)
      .then((asset) => {
        if (!asset || disposed) {
          if (!disposed) setState({ status: "error" })
          return
        }
        const mimeType = asset.mimeType || inferAttachmentMimeType(source)
        const data = new Uint8Array(asset.data).buffer
        objectUrl = URL.createObjectURL(new Blob([data], { type: mimeType }))
        setState({ mimeType, status: "ready", url: objectUrl })
      })
      .catch(() => {
        if (!disposed) setState({ status: "error" })
      })

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [onResolveAsset, requested, source])

  if (state.status === "ready" && state.url) {
    if (state.mimeType === "application/pdf") {
      return <iframe className="markdown-attachment-frame" src={state.url} title={attachmentLabel(children, source)} />
    }
    if (state.mimeType?.startsWith("audio/")) {
      return <audio className="markdown-attachment-media" controls preload="metadata" src={state.url} />
    }
    if (state.mimeType?.startsWith("video/")) {
      return <video className="markdown-attachment-media" controls preload="metadata" src={state.url} />
    }
    return <a className="markdown-attachment-download" download href={state.url}>{children || "下载附件"}</a>
  }

  return (
    <button
      className="markdown-attachment-button"
      disabled={state.status === "loading"}
      onClick={() => setRequested(true)}
      type="button"
    >
      {state.status === "loading" ? "正在读取附件…" : state.status === "error" ? "重试读取附件" : <>打开附件：{children}</>}
    </button>
  )
}

function inferAttachmentMimeType(source: string) {
  const extension = source.split(/[?#]/, 1)[0].split(".").pop()?.toLocaleLowerCase()
  return extension === "pdf" ? "application/pdf"
    : extension === "mp3" ? "audio/mpeg"
      : extension === "m4a" ? "audio/mp4"
        : extension === "ogg" ? "audio/ogg"
          : extension === "wav" ? "audio/wav"
            : extension === "mov" ? "video/quicktime"
              : extension === "mp4" ? "video/mp4"
                : extension === "webm" ? "video/webm"
                  : "application/octet-stream"
}

function attachmentLabel(children: ReactNode, source: string) {
  return typeof children === "string" ? children : source.split("/").pop() ?? "附件预览"
}
