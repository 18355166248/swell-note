// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import MermaidDiagram from "./mermaid-diagram"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const initialize = vi.fn()
const render = vi.fn().mockResolvedValue({ svg: "<svg></svg>" })

vi.mock("mermaid", () => ({
  default: { initialize, render },
}))

let container: HTMLElement | null = null
let root: Root | null = null

async function mount() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<MermaidDiagram source="graph TD; A-->B" />)
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

afterEach(() => {
  root?.unmount()
  container?.remove()
  container = null
  root = null
  initialize.mockClear()
  render.mockClear()
  document.documentElement.classList.remove("dark")
})

describe("MermaidDiagram 主题", () => {
  it("浅色页用浅色配色渲染，节点浅底深字", async () => {
    await mount()
    await flush()
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      theme: "base",
      themeVariables: expect.objectContaining({ primaryColor: "#eaf1fd", primaryTextColor: "#1d2530" }),
    }))
    expect(render.mock.calls[0][0]).toContain("light")
  })

  it("深色模式下用深色配色渲染", async () => {
    document.documentElement.classList.add("dark")
    await mount()
    await flush()
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      theme: "base",
      themeVariables: expect.objectContaining({ primaryColor: "#2b3245", primaryTextColor: "#e8ecf4" }),
    }))
    expect(render.mock.calls[0][0]).toContain("dark")
  })

  it("切换主题后按新配色重画", async () => {
    await mount()
    await flush()
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      themeVariables: expect.objectContaining({ primaryColor: "#eaf1fd" }),
    }))
    await act(async () => {
      document.documentElement.classList.add("dark")
    })
    await flush()
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      themeVariables: expect.objectContaining({ primaryColor: "#2b3245" }),
    }))
    expect(render).toHaveBeenCalledTimes(2)
  })
})
