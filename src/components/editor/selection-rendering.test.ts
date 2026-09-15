// @vitest-environment jsdom
import { EditorView, getDrawSelectionConfig } from "@codemirror/view"
import { afterEach, describe, expect, it } from "vitest"

import { selectionRenderingExtensions, shouldDrawCodeMirrorSelection } from "./selection-rendering"

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

})
