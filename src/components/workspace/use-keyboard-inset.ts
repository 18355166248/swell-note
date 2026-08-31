import { useEffect } from "react"

import { getKeyboardInset } from "@/services/navigation/keyboard-inset"

// 键盘高度只用于布局，写进根节点的自定义属性即可，不进 React 状态，避免每次键盘动画都重渲染整个工作区。
export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    let frame = 0
    const sync = () => {
      frame = 0
      const inset = getKeyboardInset({
        layoutHeight: root.clientHeight || window.innerHeight,
        visualHeight: viewport.height,
        visualOffsetTop: viewport.offsetTop,
      })
      root.style.setProperty("--keyboard-inset", `${inset}px`)
    }
    // 键盘动画期间 resize 会连续触发，合并到同一帧再写样式，避免布局抖动。
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(sync)
    }
    sync()
    viewport.addEventListener("resize", schedule)
    viewport.addEventListener("scroll", schedule)
    window.addEventListener("orientationchange", schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      viewport.removeEventListener("resize", schedule)
      viewport.removeEventListener("scroll", schedule)
      window.removeEventListener("orientationchange", schedule)
      root.style.removeProperty("--keyboard-inset")
    }
  }, [])
}
