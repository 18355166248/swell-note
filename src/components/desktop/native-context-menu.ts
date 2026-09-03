import { useEffect } from "react"

const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']"

export function shouldKeepNativeContextMenu(target: EventTarget | null, selection: Selection | null) {
  const element = target instanceof Element ? target : null
  if (!element) return false
  // 可输入区域交还给系统菜单：粘贴、拼写检查、输入法候选都只有原生菜单能提供。
  if (element.closest(EDITABLE_SELECTOR)) return true
  // 选中文字后右键通常是想复制，这一路同样留给系统菜单。
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0)
}

export function useNativeContextMenuSuppression(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const suppress = (event: MouseEvent) => {
      // 自定义右键菜单会先在 React 树里 preventDefault，这里不再重复接管。
      if (event.defaultPrevented) return
      if (shouldKeepNativeContextMenu(event.target, window.getSelection())) return
      event.preventDefault()
    }
    document.addEventListener("contextmenu", suppress)
    return () => document.removeEventListener("contextmenu", suppress)
  }, [enabled])
}
