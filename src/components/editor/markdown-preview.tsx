import { useEffect, useState } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"

import { parseWikiHref, rewriteWikiLinks } from "@/services/markdown/markdown-preview-utils"
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
        urlTransform={(url) => parseWikiHref(url) ? url : defaultUrlTransform(url)}
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
    const resolvedSource = parseWikiHref(source) ?? source
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
