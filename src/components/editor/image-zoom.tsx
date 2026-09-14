import { useRef, useSyncExternalStore } from "react"
import { Dialog } from "radix-ui"

type Zoom = { src: string; alt: string; origin: HTMLElement | null; fallback: HTMLElement | null }
let zoom: Zoom | null = null
const listeners = new Set<() => void>()
export function openImageZoom(src: string, alt: string, origin?: HTMLElement | null, fallback?: HTMLElement | null) {
  zoom = {
    src,
    alt,
    origin: origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    fallback: fallback ?? null,
  }
  listeners.forEach((listener) => listener())
}
function close() { zoom = null; listeners.forEach((listener) => listener()) }
export function ImageZoomOverlay() {
  const value = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => zoom, () => null)
  const origin = useRef<HTMLElement | null>(null)
  const fallback = useRef<HTMLElement | null>(null)
  if (value) { origin.current = value.origin; fallback.current = value.fallback }
  // Radix 接管焦点约束和 Esc；没有 Trigger 的程序式打开需要显式归还焦点。
  return <Dialog.Root open={Boolean(value)} onOpenChange={(open) => { if (!open) close() }}>
    <Dialog.Portal><Dialog.Overlay className="image-zoom-backdrop" />
      <Dialog.Content className="image-zoom-content" aria-describedby={undefined} onCloseAutoFocus={(event) => {
        event.preventDefault()
        // 图片装饰可能在预览期间因编辑/重载卸载，只回退到发起预览的同一个编辑器。
        if (origin.current?.isConnected) {
          origin.current.focus()
        } else if (fallback.current?.isConnected) {
          const fallbackTarget = fallback.current
          // Modal 清理完成前背景仍可能处于 inert；延后一拍再聚焦编辑器才可靠。
          queueMicrotask(() => { if (fallbackTarget.isConnected) fallbackTarget.focus() })
        }
      }}>
        <Dialog.Title className="sr-only">{value?.alt || "图片预览"}</Dialog.Title>
        <Dialog.Close className="image-zoom-close" aria-label="关闭图片预览">关闭 ×</Dialog.Close>
        {value ? <img src={value.src} alt={value.alt} /> : null}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
