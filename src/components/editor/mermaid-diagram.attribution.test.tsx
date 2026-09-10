// @vitest-environment jsdom
// 归因测试：不 mock mermaid，验证「组件配置 + 真实渲染管线」产出的 SVG 配色。
// 背景：浅色阅读态流程图黑底深字，两轮 themeVariables 修复在真机上均未生效，
// 需要区分「组件代码没生效」与「笔记源码自带 %%{init}%%/classDef 覆盖了全局配色」。
import { beforeAll, describe, expect, it } from "vitest"

import { authorizeMermaidStyles, MERMAID_THEME_VARIABLES } from "./mermaid-diagram"

beforeAll(() => {
  // jsdom 没有布局引擎，mermaid 渲染文本尺寸时依赖这些 API，全部 stub 成固定值。
  // TS 的 DOM 类型里没有这两个方法，走 Record 写入。
  const proto = SVGElement.prototype as unknown as Record<string, unknown>
  if (!proto.getBBox) {
    proto.getBBox = () => ({ x: 0, y: 0, width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, toJSON: () => ({}) }) as DOMRect
  }
  if (!proto.getComputedTextLength) {
    proto.getComputedTextLength = () => 100
  }
})

async function renderWithLightTheme(source: string): Promise<string> {
  const { default: mermaid } = await import("mermaid")
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: MERMAID_THEME_VARIABLES.light,
    suppressErrorRendering: true,
  })
  const { svg } = await mermaid.render(`attrTest${Math.random().toString(36).slice(2)}`, source)
  return svg
}

describe("mermaid 真实渲染配色归因", () => {
  it("普通流程图按浅色配色渲染：节点浅底 #eaf1fd、文字深色", async () => {
    const svg = await renderWithLightTheme("graph LR; 新建 --> 编辑 --> 同步")
    expect(svg).toContain("#eaf1fd")
  }, 20000)

  it("笔记源码自带 init 指定 dark 主题时会覆盖组件的浅色配色", async () => {
    const source = `%%{init: {"theme": "dark"}}%%
graph LR; 新建 --> 编辑 --> 同步`
    const svg = await renderWithLightTheme(source)
    // init 指令优先级高于 initialize 的全局配置；若 SVG 不含浅色节点色，
    // 说明真机黑底可由笔记源码解释，而非组件配置失效。
    expect(svg).not.toContain("#eaf1fd")
  }, 20000)
})

describe("authorizeMermaidStyles（Tauri CSP nonce 适配）", () => {
  // 背景：Tauri 经响应头下发的 CSP 在 style-src 带随机 nonce，'unsafe-inline' 随之失效，
  // mermaid 输出的 <style> 无 nonce 会被整体拦截（iOS 真机黑底根因）。

  it("把页面已有的 CSP nonce 换入 mermaid 的 style 元素，内容不丢", () => {
    const bootstrap = document.createElement("style")
    bootstrap.setAttribute("nonce", "nonce-test-1")
    document.head.appendChild(bootstrap)
    try {
      const host = document.createElement("div")
      host.innerHTML = `<svg><style>#noteDiagramx .node rect{fill:#eaf1fd}</style><rect class="node"/></svg>`
      authorizeMermaidStyles(host)
      const styleEl = host.querySelector("style")
      expect(styleEl?.nonce).toBe("nonce-test-1")
      expect(styleEl?.textContent).toContain("#eaf1fd")
    } finally {
      bootstrap.remove()
    }
  })

  it("页面没有 nonce（开发态/纯 Web）时不改动样式", () => {
    const host = document.createElement("div")
    host.innerHTML = `<svg><style>#a{fill:#000}</style></svg>`
    const before = host.querySelector("style")
    authorizeMermaidStyles(host)
    expect(host.querySelector("style")).toBe(before)
  })
})
