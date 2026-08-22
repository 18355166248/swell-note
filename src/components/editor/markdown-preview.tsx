import { useEffect, useState, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  isRelativeAttachmentHref,
  parseVaultAssetHref,
  parseWikiHref,
  rewriteWikiLinks,
} from "@/services/markdown/markdown-preview-utils"
import type { VaultAsset } from "@/services/vault/vault-adapter"

type MarkdownPreviewProps = {
  content: string
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onWikiLink: (target: string) => void
}

const remarkPlugins = [remarkGfm]

export default function MarkdownPreview({ content, onResolveAsset, onWikiLink }: MarkdownPreviewProps) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        components={{
          a({ children, href }) {
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
        }}
        remarkPlugins={remarkPlugins}
        urlTransform={(url) => parseWikiHref(url) || parseVaultAssetHref(url) ? url : defaultUrlTransform(url)}
      >
        {rewriteWikiLinks(content)}
      </ReactMarkdown>
    </div>
  )
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
