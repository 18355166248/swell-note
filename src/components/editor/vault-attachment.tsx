import { useEffect, useRef, useState, type ReactNode } from "react"
import type { VaultAsset } from "@/services/vault/vault-adapter"

type VaultAttachmentProps = {
  children: ReactNode
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  source: string
}

export function VaultAttachment({ children, onResolveAsset, source }: VaultAttachmentProps) {
  const [attempt, setAttempt] = useState(0)
  const [previewError, setPreviewError] = useState(false)
  const resolveAssetRef = useRef(onResolveAsset)
  resolveAssetRef.current = onResolveAsset
  const [state, setState] = useState<{
    mimeType?: string
    origin?: VaultAsset["origin"]
    status: "idle" | "loading" | "ready" | "error"
    url?: string
  }>({ status: "idle" })

  useEffect(() => {
    setPreviewError(false)
    if (!attempt) { setState({ status: "idle" }); return }
    let disposed = false
    let objectUrl: string | undefined
    setState({ status: "loading" })

    // 附件可能很大，只在用户主动点击后读取；对象 URL 在卸载时释放，避免长时间预览造成内存泄漏。
    // 父组件重新渲染可能换掉回调身份；一次点击只对应一次读取，重试由 attempt 明确触发。
    void resolveAssetRef.current(source)
      .then((asset) => {
        if (!asset || disposed) {
          if (!disposed) setState({ status: "error" })
          return
        }
        const mimeType = asset.mimeType && asset.mimeType !== "application/octet-stream" ? asset.mimeType : inferAttachmentMimeType(source)
        const data = new Uint8Array(asset.data).buffer
        objectUrl = URL.createObjectURL(new Blob([data], { type: mimeType }))
        setState({ mimeType, origin: asset.origin, status: "ready", url: objectUrl })
      })
      .catch(() => {
        if (!disposed) setState({ status: "error" })
      })

    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attempt, source])

  if (state.status === "ready" && state.url) {
    const label = attachmentLabel(children, source)
    const name = decodeAttachmentName(source)
    return <span className="markdown-attachment-open">
      <span className="markdown-attachment-actions">
        <a download={name} href={state.url}>下载：{label}</a>
        <button type="button" onClick={() => setAttempt(0)}>关闭预览</button>
        <span role="status">{state.origin === "cache" ? "本机缓存" : state.origin === "remote" ? "远端文件" : state.origin === "local" ? "本地文件" : "附件已就绪"}</span>
      </span>
      {previewError ? <span role="alert">此设备暂时无法预览，可下载后打开。<button type="button" onClick={() => setAttempt((value) => value + 1)}>重试预览</button></span> : null}
      {state.mimeType === "application/pdf" ? <iframe className="markdown-attachment-frame" src={state.url} title={label} />
        : state.mimeType?.startsWith("audio/") ? <audio aria-label={label} className="markdown-attachment-media" controls onError={() => setPreviewError(true)} preload="metadata" src={state.url} />
          : state.mimeType?.startsWith("video/") ? <video aria-label={label} className="markdown-attachment-media" controls onError={() => setPreviewError(true)} preload="metadata" src={state.url} />
            : <span>附件已就绪，可下载后打开。</span>}
    </span>
  }

  return (
    <button
      className="markdown-attachment-button"
      disabled={state.status === "loading"}
      onClick={() => setAttempt((value) => value + 1)}
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

function decodeAttachmentName(source: string) {
  const name = source.split(/[?#]/, 1)[0].split("/").pop() || "附件"
  try { return decodeURIComponent(name) } catch { return name }
}
