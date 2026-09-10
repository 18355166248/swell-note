import { useEffect, useState } from "react"

// 移动工作区的唯一判据：竖屏手机按宽度（<768px），横屏手机逻辑宽 850-960px 会越过该断点，
// 需要靠"粗指针 + 无悬停 + 高度不足 500px"识别（iPhone 横屏高 350-430pt；
// iPad 横屏高 ≥744、桌面窄窗口是指针精确的鼠标环境，都不会误命中）。
export const MOBILE_LAYOUT_QUERY = "(max-width: 767px), (pointer: coarse) and (hover: none) and (max-height: 500px)"

export function matchesMobileLayout() {
  return window.matchMedia(MOBILE_LAYOUT_QUERY).matches
}

export function useMobileLayoutQuery() {
  const [mobile, setMobile] = useState(() => matchesMobileLayout())

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  return mobile
}
