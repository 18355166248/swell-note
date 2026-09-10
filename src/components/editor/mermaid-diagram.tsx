import { useEffect, useId, useRef, useState } from "react"

// 官方 default/dark 主题出现过浅色页下节点深底配深字、标签难以辨认的问题；
// 用 base 主题并显式给出两套配色，节点底色与文字对比度不再依赖 mermaid 内置主题的取值。
// 导出仅供归因测试复用同一份配色，避免测试与实现各写一份漂移。
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

// Tauri 经响应头下发的 CSP 会在 style-src 上附加随机 nonce（tauri 为 index.html 内联样式注入
// nonce 后的连带结果）；按 CSP 规则此时 'unsafe-inline' 被忽略，mermaid 输出中无 nonce 的
// <style> 会被整体拦截——节点回落默认黑色填充、连线失去描边（iOS 真机浅色页黑底的根因）。
// 样式元素在插入瞬间即完成 CSP 校验，只能换入一个带 nonce 的新元素，不能事后补属性。
// 导出供测试直接调用。
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

export default function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "")
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  // 主题切换后要用对应的配色重画。
  const [theme, setTheme] = useState<"dark" | "light">(() => document.documentElement.classList.contains("dark") ? "dark" : "light")
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light"))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false
    setState("loading")
    // strict 禁止笔记中的点击脚本；迟到的异步结果不能覆盖已经切换的笔记。
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: MERMAID_THEME_VARIABLES[theme], suppressErrorRendering: true })
      // render id 带主题后缀：mermaid 内部按 id 缓存，主题切换后要强制重画。
      const { svg } = await mermaid.render(`noteDiagram${id}${theme}`, source)
      if (!cancelled && host.current) {
        host.current.innerHTML = svg
        authorizeMermaidStyles(host.current)
        setState("ready")
      }
    }).catch(() => { if (!cancelled) setState("error") })
    return () => { cancelled = true }
  }, [id, source, theme])
  return <div className="markdown-diagram">
    <div ref={host} role="img" aria-label="Mermaid 流程图" hidden={state !== "ready"} />
    {state !== "ready" ? <p role="status">{state === "loading" ? "正在绘制图表…" : "图表语法有误，请检查源码"}</p> : null}
    <details open={state === "error"}><summary>图表源码</summary><pre><code>{source}</code></pre></details>
  </div>
}
