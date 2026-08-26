import { Component, Suspense, createContext, useContext, useEffect, useState, type ErrorInfo, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"

import {
  extractEmbeddedSection,
  frontmatterLineCount,
  isRelativeAttachmentHref,
  obsidianAnchorId,
  parseVaultAssetHref,
  parseWikiEmbedHref,
  parseWikiHref,
  rewriteWikiLinks,
  splitWikiTarget,
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
  editable?: boolean
  immersive?: boolean
  noteId?: string
  onContentChange?: (content: string) => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onLoadWikiNote: (target: string) => void
  onResolveWikiNote: (target: string) => EmbeddedWikiNoteResult
  onToggleTask?: (line: number, checked: boolean) => void
  onWikiLink: (target: string) => void
}

const remarkPlugins = [remarkGfm, remarkObsidian]
const rehypePlugins = [rehypeHighlight]

// 任务勾选框由 remark-gfm 合成、自身没有源码位置，行号从所属任务列表项（li）经 Context 传入。
const TaskItemLineContext = createContext<number | null>(null)

export default function MarkdownPreview(props: MarkdownPreviewProps) {
  const renderer = resolveOfficialNoteRenderer(props.content)
  if (renderer) {
    const PluginRenderer = renderer.component
    return (
      <NoteRendererErrorBoundary content={props.content} label={renderer.label}>
        <Suspense fallback={<NoteRendererLoading label={renderer.label} />}>
          <PluginRenderer
            content={props.content}
            editable={props.editable}
            immersive={props.immersive}
            key={props.noteId}
            noteId={props.noteId}
            onContentChange={props.onContentChange}
            onResolveAsset={props.onResolveAsset}
            onWikiLink={props.onWikiLink}
          />
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

function MarkdownContent({ content, depth, onLoadWikiNote, onResolveAsset, onResolveWikiNote, onToggleTask, onWikiLink }: MarkdownPreviewProps & { depth: number }) {
  // 预览正文已剥离 frontmatter，勾选任务时按 hast 行号补回偏移换算源文件行号。
  const sourceLineOffset = frontmatterLineCount(content)
  return (
    <div className={depth === 0 ? "markdown-preview" : "markdown-preview markdown-preview-embedded"}>
      <ReactMarkdown
        components={{
          input({ checked, disabled }) {
            const previewLine = useContext(TaskItemLineContext)
            if (!onToggleTask || !disabled || !previewLine) {
              return <input checked={checked} disabled={disabled} readOnly type="checkbox" />
            }
            const sourceLine = previewLine + sourceLineOffset
            return (
              <input
                aria-label="切换任务状态"
                checked={checked}
                className="task-checkbox"
                data-source-line={sourceLine}
                onChange={(event) => onToggleTask(sourceLine, event.target.checked)}
                type="checkbox"
              />
            )
          },
          li({ children, node }) {
            const classNames = node?.properties?.className
            const isTaskItem = Array.isArray(classNames) && classNames.includes("task-list-item")
            const previewLine = isTaskItem ? node?.position?.start.line : undefined
            if (!onToggleTask || !previewLine) return <li>{children}</li>
            return (
              <li>
                <TaskItemLineContext.Provider value={previewLine}>{children}</TaskItemLineContext.Provider>
              </li>
            )
          },
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
          img({ alt, src, title }) {
            return <VaultImage alt={alt} onResolveAsset={onResolveAsset} source={src} title={title} />
          },
          pre({ children, node }) {
            return <CodeBlock node={node}>{children}</CodeBlock>
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
        rehypePlugins={rehypePlugins}
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

// 只读取 hast 的结构信息（子节点、className），不引入 hast 类型依赖。
type HastNode = {
  children?: HastNode[]
  properties?: { className?: unknown }
  tagName?: string
  type: string
  value?: string
}

function hastElementText(node: HastNode): string {
  if (node.type === "text") return node.value ?? ""
  return node.children?.map(hastElementText).join("") ?? ""
}

function codeBlockLanguage(node?: HastNode): string {
  const codeChild = node?.children?.find((child) => child.type === "element" && child.tagName === "code")
  const classNames = codeChild?.properties?.className
  if (!Array.isArray(classNames)) return ""
  const languageClass = classNames.find((name) => typeof name === "string" && name.startsWith("language-"))
  return typeof languageClass === "string" ? languageClass.slice("language-".length) : ""
}

// 优先使用剪贴板 API；部分 WebView（iOS/Android 内嵌）未开放时降级为临时输入框复制。
function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return new Promise<void>((resolve, reject) => {
    const area = document.createElement("textarea")
    area.value = text
    area.style.opacity = "0"
    area.style.position = "fixed"
    document.body.appendChild(area)
    area.select()
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy failed"))
    } finally {
      area.remove()
    }
  })
}

// 代码块头部：显示语言标签并提供复制按钮，正文（含高亮）仍由 children 原样渲染。
function CodeBlock({ children, node }: { children: ReactNode; node?: HastNode }) {
  const [copied, setCopied] = useState(false)

  const copyCode = () => {
    void copyTextToClipboard(hastElementText(node ?? { type: "root" })).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      },
      () => {},
    )
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-block-header">
        <span className="markdown-code-block-lang">{codeBlockLanguage(node) || "text"}</span>
        <button className="markdown-code-block-copy" onClick={copyCode} type="button">
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
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
  const { anchor } = splitWikiTarget(target)
  // 带锚点的嵌入（![[笔记#^块id]] / ![[笔记#标题]]）只渲染被引用的块或小节，锚点无效时提示而不降级为整篇。
  const embeddedSection = result.status === "ready" && anchor ? extractEmbeddedSection(result.note.content, anchor) : null
  const embeddedContent = result.status === "ready" ? embeddedSection ?? result.note.content : ""

  useEffect(() => {
    if (result.status === "loading") onLoadWikiNote(target)
  }, [onLoadWikiNote, result.status, target])

  return (
    <section className="wiki-embed">
      <button className="wiki-embed-title" onClick={() => onWikiLink(target)} type="button">
        {result.status === "ready"
          ? anchor ? `${result.note.title} › ${anchor.replace(/^\^/, "")}` : result.note.title
          : target}
      </button>
      {result.status === "ready" && depth < 2 ? (
        embeddedSection || !anchor ? (
          <MarkdownContent
            content={embeddedContent}
            depth={depth + 1}
            onLoadWikiNote={onLoadWikiNote}
            onResolveAsset={onResolveAsset}
            onResolveWikiNote={onResolveWikiNote}
            onWikiLink={onWikiLink}
          />
        ) : <p className="wiki-embed-state">找不到引用的块或标题：{anchor}</p>
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
  title?: string
}

// title 承载 Obsidian 尺寸别名（"300" 或 "300x200"），单值只限宽、高自适应。
function parseImageSize(title?: string) {
  const match = title?.match(/^(\d+)(?:x(\d+))?$/)
  if (!match) return null
  return { height: match[2] ? Number(match[2]) : undefined, width: Number(match[1]) }
}

function VaultImage({ alt, onResolveAsset, source, title }: VaultImageProps) {
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
    const size = parseImageSize(title)
    return (
      <img
        alt={alt ?? "笔记图片"}
        loading="lazy"
        src={state.url}
        style={size ? { height: size.height, width: size.width } : undefined}
      />
    )
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
