import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import CanvasPreview from "./canvas-preview"

describe("JSON Canvas preview", () => {
  it("renders Markdown text, file kinds, edge labels and arrows", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "a", type: "text", text: "## 计划", x: 0, y: 0, width: 180, height: 100 },
        { id: "b", type: "file", file: "资料.pdf", x: 260, y: 0, width: 180, height: 100 },
      ],
      edges: [{ id: "edge", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", label: "下一步" }],
    })

    const output = renderToStaticMarkup(
      <CanvasPreview content={content} onResolveAsset={vi.fn()} onWikiLink={vi.fn()} />,
    )

    expect(output).toContain("<h2>计划</h2>")
    expect(output).toContain("资料.pdf")
    expect(output).toContain("下一步")
    expect(output).toContain("marker-end")
  })

  it("fails safely for malformed node geometry", () => {
    const output = renderToStaticMarkup(
      <CanvasPreview
        content={JSON.stringify({ nodes: [{ id: "bad", type: "text", text: "坏节点" }] })}
        onResolveAsset={vi.fn()}
        onWikiLink={vi.fn()}
      />,
    )
    expect(output).toContain("无效节点尺寸")
  })
})
