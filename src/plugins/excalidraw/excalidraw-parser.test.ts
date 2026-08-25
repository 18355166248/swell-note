import LZString from "lz-string"
import { describe, expect, it } from "vitest"

import { parseExcalidrawMarkdown, serializeExcalidrawMarkdown } from "./excalidraw-parser"

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

  it("updates compressed drawing data while preserving surrounding Obsidian Markdown", () => {
    const original = { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }
    const content = `---\ntags: [excalidraw]\n---\n# Text Elements\nold text ^old-id\n%%\n## Drawing\n\`\`\`compressed-json\n${LZString.compressToBase64(JSON.stringify(original))}\n\`\`\`\nfooter`
    const updated = { ...original, elements: [{ id: "text-2", type: "text", text: "new text" }] }

    const result = serializeExcalidrawMarkdown(content, updated)

    expect(result).toContain("# Text Elements\nnew text ^text-2")
    expect(result).not.toContain("old text")
    expect(result).toContain("footer")
    expect(parseExcalidrawMarkdown(result).elements).toEqual(updated.elements)
  })

  it("keeps an uncompressed drawing uncompressed", () => {
    const content = '## Drawing\n```json\n{"type":"excalidraw","elements":[]}\n```'
    const result = serializeExcalidrawMarkdown(content, { type: "excalidraw", elements: [{ id: "text-1" }] })

    expect(result).toContain("```json")
    expect(result).not.toContain("```compressed-json")
    expect(parseExcalidrawMarkdown(result).elements).toEqual([{ id: "text-1" }])
  })
})
