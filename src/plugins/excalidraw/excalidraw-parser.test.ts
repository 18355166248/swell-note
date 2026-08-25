import LZString from "lz-string"
import { describe, expect, it } from "vitest"

import { parseExcalidrawMarkdown } from "./excalidraw-parser"

describe("Excalidraw markdown parser", () => {
  it("restores Obsidian compressed-json scenes", () => {
    const scene = { type: "excalidraw", version: 2, elements: [{ id: "shape-1", type: "rectangle" }], appState: {}, files: {} }
    const content = `## Drawing\n\`\`\`compressed-json\n${LZString.compressToBase64(JSON.stringify(scene))}\n\`\`\``

    expect(parseExcalidrawMarkdown(content)).toMatchObject(scene)
  })

  it("accepts uncompressed JSON scenes", () => {
    const content = '```json\n{"elements":[{"id":"not-the-drawing"}]}\n```\n## Drawing\n```json\n{"type":"excalidraw","elements":[]}\n```'
    expect(parseExcalidrawMarkdown(content).elements).toEqual([])
  })

  it("rejects invalid drawings without mutating the source", () => {
    expect(() => parseExcalidrawMarkdown("## Drawing\n```compressed-json\nbroken\n```"))
      .toThrow("找不到可读取的 Excalidraw 画布数据")
  })
})
