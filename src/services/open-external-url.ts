import { isTauri } from "@tauri-apps/api/core"

// Tauri WebView 默认拒绝 window.open 与 target=_blank 的新窗口请求，外链在桌面与 iOS
// 端必须显式交给 opener 插件，由系统浏览器打开；纯 Web 环境维持新开标签页。
export async function openExternalUrl(href: string) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener")
    await openUrl(href)
    return
  }
  window.open(href, "_blank", "noopener,noreferrer")
}
