import { useEffect, useId, useRef, useState } from "react"

import { authorizeMermaidStyles, MERMAID_THEME_VARIABLES } from "./mermaid-rendering"

// 保留旧导出供归因测试和现有调用方使用；实现放在无 React 依赖的轻量模块中，编辑器不会
// 因共享主题常量而提前加载 Mermaid 阅读态组件。
export { authorizeMermaidStyles, MERMAID_THEME_VARIABLES } from "./mermaid-rendering"

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
