import { useEffect, useId, useRef, useState } from "react"

export default function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "")
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  useEffect(() => {
    let cancelled = false
    setState("loading")
    // strict 禁止笔记中的点击脚本；迟到的异步结果不能覆盖已经切换的笔记。
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.classList.contains("dark") ? "dark" : "default", suppressErrorRendering: true })
      const { svg } = await mermaid.render(`noteDiagram${id}`, source)
      if (!cancelled && host.current) { host.current.innerHTML = svg; setState("ready") }
    }).catch(() => { if (!cancelled) setState("error") })
    return () => { cancelled = true }
  }, [id, source])
  return <div className="markdown-diagram">
    <div ref={host} role="img" aria-label="Mermaid 流程图" hidden={state !== "ready"} />
    {state !== "ready" ? <p role="status">{state === "loading" ? "正在绘制图表…" : "图表语法有误，请检查源码"}</p> : null}
    <details open={state === "error"}><summary>图表源码</summary><pre><code>{source}</code></pre></details>
  </div>
}
