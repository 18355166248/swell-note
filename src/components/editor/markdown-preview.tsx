import { Component, memo, Suspense, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"

import {
  extractEmbeddedSection,
  frontmatterLineCount,
  isRelativeAttachmentHref,
  obsidianAnchorId,
  parseMarkdownNoteHref,
  parseVaultAssetHref,
  parseWikiEmbedHref,
  parseWikiHref,
  rewriteWikiLinks,
  splitWikiTarget,
  stripMarkdownFrontmatter,
} from "@/services/markdown/markdown-preview-utils"
import { splitMarkdownIntoChunks, type MarkdownChunk } from "@/services/markdown/markdown-chunks"
import { resolveOfficialNoteRenderer } from "@/plugins/official-note-renderers"
import { remarkObsidian } from "@/services/markdown/remark-obsidian"
import { openExternalUrl } from "@/services/open-external-url"
import { extractFrontmatter } from "@/services/search/note-index"
import type { VaultAsset } from "@/services/vault/vault-adapter"

export type EmbeddedWikiNote = { content: string; title: string }
export type EmbeddedWikiNoteResult =
  | { note: EmbeddedWikiNote; status: "ready" }
  | { status: "loading" | "missing" }

type MarkdownPreviewProps = {
  assetScope?: string
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

// 切换笔记时这棵子树会连着渲染四次：旧正文两次、新正文两次，每一次都要把整篇
// Markdown 重新解析成 React 元素。正文没变时没有任何理由重算，这里挡住重复的那两次。
export default memo(function MarkdownPreview(props: MarkdownPreviewProps) {
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
})

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

function MarkdownContent({ assetScope, content, depth, editable, onLoadWikiNote, onResolveAsset, onResolveWikiNote, onToggleTask, onWikiLink }: MarkdownPreviewProps & { depth: number }) {
  // 预览正文已剥离 frontmatter，勾选任务时按 hast 行号补回偏移换算源文件行号。
  const sourceLineOffset = frontmatterLineCount(content)
  const body = stripMarkdownFrontmatter(content)
  const properties = depth === 0 ? Object.entries(extractFrontmatter(content).properties) : []
  const handlersRef = useRef({ onLoadWikiNote, onResolveAsset, onResolveWikiNote, onToggleTask, onWikiLink })
  handlersRef.current = { onLoadWikiNote, onResolveAsset, onResolveWikiNote, onToggleTask, onWikiLink }
  // 双链嵌入本身就短，再分帧只会让嵌入内容一段段跳出来；只有顶层正文参与分块。
  const chunks = useMemo(() => {
    const rewritten = rewriteWikiLinks(body)
    return depth === 0 ? splitMarkdownIntoChunks(rewritten) : [{ startLine: 1, text: rewritten }]
  }, [body, depth])
  return (
    <div className={depth === 0 ? "markdown-preview" : "markdown-preview markdown-preview-embedded"}>
      {properties.length > 0 ? <MarkdownProperties properties={properties} /> : null}
      {!body.trim() && depth === 0 ? (
        <div className="markdown-empty-state">
          <strong>这篇笔记还没有正文</strong>
          <span>{editable ? "切换到编辑模式开始记录。" : "源文件目前没有可预览的 Markdown 内容。"}</span>
        </div>
      ) : null}
      <ProgressiveChunks
        assetScope={assetScope}
        chunks={chunks}
        depth={depth}
        handlers={handlersRef}
        sourceLineOffset={sourceLineOffset}
      />
    </div>
  )
}

// 首屏先铺够两段（约一屏半），其余每帧补一段：整篇解析原本是一个三百毫秒级的长任务，
// 摊成一串短任务后，点「阅读」时界面不再整体僵住，滚动与返回都能立刻响应。
const INITIAL_CHUNKS = 2

// 未渲染的部分先用占位撑住高度。少了这一层，从编辑态切过来的瞬间正文只有两段高，
// 浏览器会把滚动位置夹到底部，等剩下的段落补齐时读者已经被甩到别的地方了。
function ProgressiveChunks({ assetScope, chunks, depth, handlers, sourceLineOffset }: {
  assetScope?: string
  chunks: MarkdownChunk[]
  depth: number
  handlers: { current: MarkdownHandlers }
  sourceLineOffset: number
}) {
  // 进度只增不减：换笔记时整棵预览会按 key 重建，这里自然回到起点；
  // 而在阅读态勾选任务只改动一个字符，若跟着从头铺一遍，读者眼前那段会先空掉再补回来。
  // 段落各自记忆化，没被改到的段不会重新解析，勾选的代价就只剩它所在的那一段。
  const [rendered, setRendered] = useState(INITIAL_CHUNKS)
  const visible = Math.min(rendered, chunks.length)
  const pending = chunks.length - visible
  const spacerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const spacer = spacerRef.current
    const container = spacer?.parentElement
    if (!spacer || !container) return
    // 用已渲染部分的「每字符像素高」推算剩余高度；越往后铺，估得越准。
    // 直接写 DOM：占位高度只服务滚动条，走 state 会让每补一段都把已铺好的段落重新过一遍。
    const renderedChars = chunks.slice(0, visible).reduce((sum, chunk) => sum + chunk.text.length + 1, 0)
    const pendingChars = chunks.slice(visible).reduce((sum, chunk) => sum + chunk.text.length + 1, 0)
    const renderedHeight = spacer.getBoundingClientRect().top - container.getBoundingClientRect().top
    if (renderedChars <= 0 || renderedHeight <= 0) return
    spacer.style.height = `${Math.round(renderedHeight / renderedChars * pendingChars)}px`
  }, [chunks, visible])

  useEffect(() => {
    if (visible >= chunks.length) return
    const frame = window.requestAnimationFrame(() => setRendered((count) => count + 1))
    return () => window.cancelAnimationFrame(frame)
  }, [chunks.length, visible])

  return (
    <>
      {chunks.slice(0, visible).map((chunk, index) => (
        <MarkdownChunk
          assetScope={assetScope}
          depth={depth}
          handlers={handlers}
          key={index}
          sourceLineOffset={sourceLineOffset + chunk.startLine - 1}
          text={chunk.text}
        />
      ))}
      {pending > 0 ? (
        <div aria-hidden="true" className="markdown-preview-pending" ref={spacerRef} />
      ) : null}
    </>
  )
}

type MarkdownHandlers = {
  onLoadWikiNote: MarkdownPreviewProps["onLoadWikiNote"]
  onResolveAsset: MarkdownPreviewProps["onResolveAsset"]
  onResolveWikiNote: MarkdownPreviewProps["onResolveWikiNote"]
  onToggleTask: MarkdownPreviewProps["onToggleTask"]
  onWikiLink: MarkdownPreviewProps["onWikiLink"]
}

type MarkdownChunkProps = {
  assetScope?: string
  depth: number
  handlers: { current: MarkdownHandlers }
  sourceLineOffset: number
  text: string
}

// 已铺好的段落不该因为后面又补了一段而重渲染，回调统一走 ref 中转，props 全是稳定值。
const MarkdownChunk = memo(function MarkdownChunk({ assetScope, depth, handlers, sourceLineOffset, text }: MarkdownChunkProps) {
  const components = useMemo(
    () => buildMarkdownComponents(assetScope, depth, handlers, sourceLineOffset),
    [assetScope, depth, handlers, sourceLineOffset],
  )
  return (
    <ReactMarkdown
      components={components}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={previewUrlTransform}
    >
      {text}
    </ReactMarkdown>
  )
})

function previewUrlTransform(url: string) {
  return parseWikiHref(url) || parseWikiEmbedHref(url) || parseVaultAssetHref(url) ? url : defaultUrlTransform(url)
}

function buildMarkdownComponents(
  assetScope: string | undefined,
  depth: number,
  handlersRef: { current: MarkdownHandlers },
  sourceLineOffset: number,
) {
  return {
    input({ checked, disabled }: { checked?: boolean; disabled?: boolean }) {
      const previewLine = useContext(TaskItemLineContext)
      const toggleTask = handlersRef.current.onToggleTask
      if (!toggleTask || !disabled || !previewLine) {
        return <input checked={checked} disabled={disabled} readOnly type="checkbox" />
      }
      const sourceLine = previewLine + sourceLineOffset
      return (
        <input
          aria-label="切换任务状态"
          checked={checked}
          className="task-checkbox"
          data-source-line={sourceLine}
          onChange={(event) => toggleTask(sourceLine, event.target.checked)}
          type="checkbox"
        />
      )
    },
    li({ children, node }: { children?: ReactNode; node?: { position?: { start: { line: number } }; properties?: { className?: unknown } } }) {
      const classNames = node?.properties?.className
      const isTaskItem = Array.isArray(classNames) && classNames.includes("task-list-item")
      const previewLine = isTaskItem ? node?.position?.start.line : undefined
      if (!handlersRef.current.onToggleTask || !previewLine) return <li data-source-line={node?.position?.start.line ? node.position.start.line + sourceLineOffset : undefined}>{children}</li>
      return <li data-source-line={previewLine + sourceLineOffset}><TaskItemLineContext.Provider value={previewLine}>{children}</TaskItemLineContext.Provider></li>
    },
    a({ children, href }: { children?: ReactNode; href?: string }) {
      const embedTarget = parseWikiEmbedHref(href)
      if (embedTarget) return <button className="wiki-link" onClick={() => handlersRef.current.onWikiLink(embedTarget)} type="button">{children}</button>
      const wikiTarget = parseWikiHref(href)
      if (wikiTarget) return <button className="wiki-link" onClick={() => handlersRef.current.onWikiLink(wikiTarget)} type="button">{children}</button>
      const markdownNoteTarget = parseMarkdownNoteHref(href)
      if (markdownNoteTarget) return <button className="wiki-link markdown-note-link" onClick={() => handlersRef.current.onWikiLink(markdownNoteTarget)} type="button">{children}</button>
      const assetSource = parseVaultAssetHref(href) ?? (isRelativeAttachmentHref(href) ? href : null)
      if (assetSource) return <VaultAttachment onResolveAsset={handlersRef.current.onResolveAsset} source={assetSource}>{children}</VaultAttachment>
      if (href?.startsWith("#")) return <MarkdownAnchorLink href={href}>{children}</MarkdownAnchorLink>
      // Tauri WebView 默认拒绝 target=_blank 的新窗口请求，点击统一交给 openExternalUrl；
      // href 保留给悬停预览与右键菜单。
      return (
        <a
          className="markdown-external-link"
          href={href}
          onClick={(event) => {
            if (!href) return
            event.preventDefault()
            void openExternalUrl(href)
          }}
          rel="noreferrer noopener"
          target="_blank"
        >
          {children}
        </a>
      )
    },
    img({ alt, src, title }: { alt?: string; src?: string; title?: string }) {
      return <VaultImage alt={alt} assetScope={assetScope} onResolveAsset={handlersRef.current.onResolveAsset} source={src} title={title} />
    },
    pre({ children, node }: { children?: ReactNode; node?: Parameters<typeof CodeBlock>[0]["node"] }) {
      return <CodeBlock node={node}>{children}</CodeBlock>
    },
    p({ children, node }: { children?: ReactNode; node?: { position?: { start: { line: number } } } }) {
      return <p data-source-line={node?.position?.start.line ? node.position.start.line + sourceLineOffset : undefined}>{children}</p>
    },
    td({ children, node }: { children?: ReactNode; node?: { position?: { start: { line: number } } } }) {
      return <td data-source-line={node?.position?.start.line ? node.position.start.line + sourceLineOffset : undefined}>{children}</td>
    },
    th({ children, node }: { children?: ReactNode; node?: { position?: { start: { line: number } } } }) {
      return <th data-source-line={node?.position?.start.line ? node.position.start.line + sourceLineOffset : undefined}>{children}</th>
    },
    table({ children }: { children?: ReactNode }) {
      return <ScrollableMarkdownTable>{children}</ScrollableMarkdownTable>
    },
    div({ children, node }: { children?: ReactNode; node?: { properties?: Record<string, unknown> } }) {
      const property = node?.properties?.["data-wiki-embed"] ?? node?.properties?.dataWikiEmbed
      const embedTarget = typeof property === "string" ? property : ""
      if (!embedTarget) return <div>{children}</div>
      return (
        <WikiEmbed
          assetScope={assetScope}
          depth={depth}
          onLoadWikiNote={handlersRef.current.onLoadWikiNote}
          onResolveAsset={handlersRef.current.onResolveAsset}
          onResolveWikiNote={handlersRef.current.onResolveWikiNote}
          onWikiLink={handlersRef.current.onWikiLink}
          target={embedTarget}
        />
      )
    },
    h1({ children, node }: HeadingComponentProps) { return <Heading level={1} sourceLine={sourceLine(node, sourceLineOffset)}>{children}</Heading> },
    h2({ children, node }: HeadingComponentProps) { return <Heading level={2} sourceLine={sourceLine(node, sourceLineOffset)}>{children}</Heading> },
    h3({ children, node }: HeadingComponentProps) { return <Heading level={3} sourceLine={sourceLine(node, sourceLineOffset)}>{children}</Heading> },
    h4({ children, node }: HeadingComponentProps) { return <Heading level={4} sourceLine={sourceLine(node, sourceLineOffset)}>{children}</Heading> },
    h5({ children, node }: HeadingComponentProps) { return <Heading level={5} sourceLine={sourceLine(node, sourceLineOffset)}>{children}</Heading> },
    h6({ children, node }: HeadingComponentProps) { return <Heading level={6} sourceLine={sourceLine(node, sourceLineOffset)}>{children}</Heading> },
  }
}

function ScrollableMarkdownTable({ children }: { children?: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollState, setScrollState] = useState({ atEnd: true, atStart: true, overflowing: false })
  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const overflowing = viewport.scrollWidth - viewport.clientWidth > 2
    const atStart = !overflowing || viewport.scrollLeft <= 2
    const atEnd = !overflowing || viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 2
    setScrollState((current) => current.atEnd === atEnd && current.atStart === atStart && current.overflowing === overflowing
      ? current
      : { atEnd, atStart, overflowing })
  }, [])
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    if (!viewport || !scrollState.overflowing || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const step = Math.max(48, Math.round(viewport.clientWidth * 0.2))
    if (event.key === "Home") viewport.scrollLeft = 0
    else if (event.key === "End") viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth
    else viewport.scrollLeft += event.key === "ArrowRight" ? step : -step
    updateScrollState()
  }, [scrollState.overflowing, updateScrollState])

  useEffect(() => {
    updateScrollState()
    const viewport = viewportRef.current
    if (!viewport) return
    // 字体、窗口和正文宽度都可能在首屏后变化，持续测量才能避免错误显示滑动提示。
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollState)
    observer?.observe(viewport)
    const table = viewport.querySelector("table")
    if (table) observer?.observe(table)
    window.addEventListener("resize", updateScrollState)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", updateScrollState)
    }
  }, [updateScrollState])

  return (
    <div
      className="markdown-table-shell"
      data-at-end={scrollState.atEnd}
      data-at-start={scrollState.atStart}
      data-overflow={scrollState.overflowing}
    >
      <div
        aria-label={scrollState.overflowing ? "可横向滚动的表格" : undefined}
        className="markdown-table-wrap"
        onKeyDown={handleKeyDown}
        onScroll={updateScrollState}
        ref={viewportRef}
        role={scrollState.overflowing ? "region" : undefined}
        tabIndex={scrollState.overflowing ? 0 : undefined}
      >
        <table>{children}</table>
      </div>
      <span aria-hidden="true" className="markdown-table-scroll-hint">左右滑动</span>
    </div>
  )
}

function MarkdownProperties({ properties }: { properties: [string, string | string[]][] }) {
  return (
    <details className="markdown-properties" open>
      <summary>属性 <span>{properties.length}</span></summary>
      <dl>
        {properties.map(([key, rawValue]) => {
          const values = Array.isArray(rawValue) ? rawValue : [rawValue]
          const isTags = key === "tags" || key === "tag"
          return (
            <div className="markdown-property-row" key={key}>
              <dt>{key}</dt>
              <dd data-tags={isTags || undefined}>
                {values.length > 0 ? values.map((value, index) => (
                  <span key={`${value}-${index}`}>{isTags ? `#${value.replace(/^#/, "")}` : value || "—"}</span>
                )) : <span>—</span>}
              </dd>
            </div>
          )
        })}
      </dl>
    </details>
  )
}

function MarkdownAnchorLink({ children, href }: { children: ReactNode; href: string }) {
  const scrollToAnchor = (event: MouseEvent<HTMLButtonElement>) => {
    const rawTarget = href.slice(1)
    let decodedTarget = rawTarget
    try { decodedTarget = decodeURIComponent(rawTarget) } catch { /* 保留原值作为兼容回退。 */ }
    const targetId = obsidianAnchorId(decodedTarget)
    const preview = event.currentTarget.closest(".markdown-preview")
    const target = Array.from(preview?.querySelectorAll<HTMLElement>("[id]") ?? [])
      .find((element) => element.id === targetId)
    target?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return <button className="wiki-link markdown-anchor-link" onClick={scrollToAnchor} type="button">{children}</button>
}

type HeadingComponentProps = { children?: ReactNode; node?: { position?: { start: { line: number } } } }

function sourceLine(node: HeadingComponentProps["node"], offset: number) {
  return node?.position?.start.line ? node.position.start.line + offset : undefined
}

function Heading({ children, level, sourceLine }: { children: ReactNode; level: 1 | 2 | 3 | 4 | 5 | 6; sourceLine?: number }) {
  const id = obsidianAnchorId(reactNodeText(children))
  const Tag = `h${level}` as const
  return <Tag data-source-line={sourceLine} id={id || undefined}>{children}</Tag>
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

function WikiEmbed({ assetScope, depth, onLoadWikiNote, onResolveAsset, onResolveWikiNote, onWikiLink, target }: {
  assetScope?: string
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
            assetScope={assetScope}
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
  assetScope?: string
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  source?: string
  title?: string
}

// 仅为旧 Vault 保留图片尺寸别名读取；新内容始终使用标准 Markdown 图片语法。
function parseImagePresentation(alt?: string, title?: string) {
  const titleSize = title?.match(/^(\d+)(?:x(\d+))?$/)
  const altSize = alt?.match(/^(.*)\|(\d+)(?:x(\d+))?$/)
  const match = titleSize ?? altSize?.slice(1)
  return {
    alt: altSize?.[1].trim() || alt || "笔记图片",
    size: match ? { height: match[2] ? Number(match[2]) : undefined, width: Number(match[1]) } : null,
  }
}

function isRemoteImageSource(source?: string) {
  return Boolean(source && /^https?:\/\//i.test(source))
}

type VaultImageCacheEntry = {
  listeners: Set<(state: VaultImageState) => void>
  refs: number
  releaseTimer?: number
  state: VaultImageState
}

type VaultImageState = { status: "loading" | "ready" | "error"; url?: string }

const vaultImageCache = new Map<string, VaultImageCacheEntry>()

function imageCacheKey(assetScope: string | undefined, source: string) {
  return `${assetScope ?? "active-note"}\u0000${source}`
}

function releaseVaultImage(cacheKey: string, entry: VaultImageCacheEntry) {
  entry.refs = Math.max(0, entry.refs - 1)
  if (entry.refs > 0) return
  // 同步刷新可能在相邻渲染帧卸载并重建 Markdown；延迟释放可直接复用原 Blob URL，避免图片先消失再加载。
  entry.releaseTimer = window.setTimeout(() => {
    if (entry.refs > 0 || vaultImageCache.get(cacheKey) !== entry) return
    // 读取尚未结束时不能丢掉缓存项，否则迟到的 Blob URL 将无人负责释放。
    if (entry.state.status === "loading") {
      entry.releaseTimer = undefined
      return
    }
    if (entry.state.url?.startsWith("blob:")) URL.revokeObjectURL(entry.state.url)
    vaultImageCache.delete(cacheKey)
  }, 30_000)
}

function VaultImage({ alt, assetScope, onResolveAsset, source, title }: VaultImageProps) {
  const resolveAssetRef = useRef(onResolveAsset)
  resolveAssetRef.current = onResolveAsset
  const resolvedSource = parseVaultAssetHref(source) ?? source
  const cacheKey = resolvedSource ? imageCacheKey(assetScope, resolvedSource) : ""
  const [state, setState] = useState<VaultImageState>(() => {
    if (isRemoteImageSource(resolvedSource)) return { status: "ready", url: resolvedSource }
    return cacheKey ? vaultImageCache.get(cacheKey)?.state ?? { status: "loading" } : { status: "error" }
  })

  useEffect(() => {
    if (!resolvedSource) {
      setState({ status: "error" })
      return
    }

    // 远程图片无需经过 Vault 读取器；仅允许 http(s)，其他协议继续拒绝以避免执行型 URL。
    if (isRemoteImageSource(resolvedSource)) {
      setState({ status: "ready", url: resolvedSource })
      return
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(resolvedSource)) {
      setState({ status: "error" })
      return
    }

    let entry = vaultImageCache.get(cacheKey)
    if (!entry) {
      entry = { listeners: new Set(), refs: 0, state: { status: "loading" } }
      vaultImageCache.set(cacheKey, entry)
      const ownedEntry = entry
      void resolveAssetRef.current(resolvedSource)
        .then((asset) => {
          const nextState: VaultImageState = asset
            ? {
                status: "ready",
                url: URL.createObjectURL(new Blob([new Uint8Array(asset.data).buffer], { type: asset.mimeType })),
              }
            : { status: "error" }
          ownedEntry.state = nextState
          for (const listener of ownedEntry.listeners) listener(nextState)
          if (ownedEntry.refs === 0 && !ownedEntry.releaseTimer) releaseVaultImage(cacheKey, ownedEntry)
        })
        .catch(() => {
          ownedEntry.state = { status: "error" }
          for (const listener of ownedEntry.listeners) listener(ownedEntry.state)
          if (ownedEntry.refs === 0 && !ownedEntry.releaseTimer) releaseVaultImage(cacheKey, ownedEntry)
        })
    }
    if (entry.releaseTimer) window.clearTimeout(entry.releaseTimer)
    entry.releaseTimer = undefined
    entry.refs += 1
    entry.listeners.add(setState)
    setState(entry.state)

    return () => {
      entry!.listeners.delete(setState)
      releaseVaultImage(cacheKey, entry!)
    }
  }, [cacheKey, resolvedSource])

  if (state.status === "ready" && state.url) {
    const presentation = parseImagePresentation(alt, title)
    return (
      <img
        alt={presentation.alt}
        decoding="async"
        loading="lazy"
        onError={() => setState({ status: "error" })}
        referrerPolicy="no-referrer"
        src={state.url}
        style={presentation.size ? { height: presentation.size.height, width: presentation.size.width } : undefined}
      />
    )
  }

  return (
    <span className="markdown-image-state" data-status={state.status}>
      {state.status === "loading" ? "正在读取图片…" : `无法读取图片${alt ? `：${parseImagePresentation(alt, title).alt}` : ""}`}
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
