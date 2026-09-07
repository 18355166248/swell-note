import { useEffect } from "react"

export function useNativeContextMenuSuppression(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const suppress = (event: MouseEvent) => {
      // 自定义右键菜单会先在 React 树里 preventDefault，这里不再重复接管。
      if (event.defaultPrevented) return
      event.preventDefault()
    }
    document.addEventListener("contextmenu", suppress)
    return () => document.removeEventListener("contextmenu", suppress)
  }, [enabled])
}
