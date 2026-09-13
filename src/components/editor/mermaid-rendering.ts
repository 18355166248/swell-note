// 官方 default/dark 主题出现过浅色页下节点深底配深字、标签难以辨认的问题；
// 用 base 主题并显式给出两套配色，编辑态与阅读态共用，避免两处配置漂移。
export const MERMAID_THEME_VARIABLES = {
  dark: {
    lineColor: "#9aa5bb",
    primaryBorderColor: "#56648a",
    primaryColor: "#2b3245",
    primaryTextColor: "#e8ecf4",
    secondaryColor: "#252b3b",
    tertiaryColor: "#1f2431",
    textColor: "#e8ecf4",
  },
  light: {
    lineColor: "#5b6472",
    primaryBorderColor: "#b9cdf5",
    primaryColor: "#eaf1fd",
    primaryTextColor: "#1d2530",
    secondaryColor: "#f4f6fa",
    tertiaryColor: "#ffffff",
    textColor: "#1d2530",
  },
} as const

// Tauri 经响应头下发的 CSP 会在 style-src 上附加随机 nonce；Mermaid 输出中的内联样式
// 需要换成带同一 nonce 的节点，否则真机上会丢失节点填充与连线样式。
export function authorizeMermaidStyles(host: HTMLElement): void {
  const nonce = document.querySelector<HTMLStyleElement>("style[nonce]")?.nonce
    || document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce
  if (!nonce) return
  for (const styleEl of Array.from(host.querySelectorAll("style"))) {
    const replacement = document.createElement("style")
    replacement.setAttribute("nonce", nonce)
    replacement.textContent = styleEl.textContent
    styleEl.replaceWith(replacement)
  }
}
