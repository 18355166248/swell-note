// @vitest-environment jsdom
import { EditorView, getDrawSelectionConfig } from "@codemirror/view"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { afterEach, describe, expect, it, vi } from "vitest"

import { selectionRenderingExtensions, shouldDrawCodeMirrorSelection } from "./selection-rendering"
import { markdownLivePreview } from "./live-preview"

const macOS = {
  maxTouchPoints: 0,
  platform: "MacIntel",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
}

const iPhone = {
  maxTouchPoints: 5,
  platform: "iPhone",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
}

let host: HTMLElement | null = null

afterEach(() => {
  host?.remove()
  host = null
})

function createView(platform: typeof macOS) {
  host = document.createElement("div")
  document.body.appendChild(host)
  return new EditorView({
    doc: "第一行\n第二行",
    extensions: [selectionRenderingExtensions(platform)],
    parent: host,
    selection: { anchor: 0, head: 3 },
  })
}

describe("CodeMirror selection rendering", () => {
  it("桌面端启用自绘选区，并隐藏非空范围尾部的额外光标", () => {
    const view = createView(macOS)

    expect(view.dom.dataset.selectionRendering).toBe("drawn")
    expect(view.dom.querySelector(".cm-selectionLayer")).not.toBeNull()
    expect(getDrawSelectionConfig(view.state).drawRangeCursor).toBe(false)

    view.destroy()
  })

  it("iOS 使用原生选区，不挂 CodeMirror 自绘层", () => {
    const view = createView(iPhone)

    expect(shouldDrawCodeMirrorSelection(iPhone)).toBe(false)
    expect(view.dom.dataset.selectionRendering).toBe("native")
    expect(view.dom.querySelector(".cm-selectionLayer")).toBeNull()
    expect(view.dom.querySelector(".cm-cursorLayer")).toBeNull()

    view.destroy()
  })

  it.each([
    ["iOS", iPhone, "开头\n\n", "\n\n结尾"],
    ["桌面首表", macOS, "", "\n\n结尾"],
    ["桌面尾表", macOS, "开头\n\n", ""],
    ["桌面仅表格", macOS, "", ""],
  ] as const)("%s 全选覆盖异步挂载的整表，局部选择与收起时清除补充高亮", async (_name, platform, before, after) => {
    const doc = `${before}| 名称 | 状态 |\n| --- | --- |\n| 苹果 | 新鲜 |${after}`
    host = document.createElement("div")
    document.body.appendChild(host)
    const view = new EditorView({
      parent: host,
      doc,
      selection: { anchor: doc.length, head: 0 },
      extensions: [markdown({ base: markdownLanguage }), markdownLivePreview(), selectionRenderingExtensions(platform)],
    })
    try {
      await vi.waitFor(() => expect(view.contentDOM.querySelector(".cm-md-table-wrap[data-document-selected]")).not.toBeNull())
      const table = view.contentDOM.querySelector<HTMLElement>(".cm-md-table-wrap")!
      const from = Number(table.dataset.tableFrom)
      const to = Number(table.dataset.tableTo)
      view.dispatch({ selection: { anchor: from + 1, head: to } })
      expect(table.hasAttribute("data-document-selected")).toBe(false)
      view.dispatch({ selection: { anchor: from, head: to } })
      expect(table.hasAttribute("data-document-selected")).toBe(true)
      view.dispatch({ selection: { anchor: to } })
      expect(table.hasAttribute("data-document-selected")).toBe(false)
    } finally {
      view.destroy()
    }
  })

})
