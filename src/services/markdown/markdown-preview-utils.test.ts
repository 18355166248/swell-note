import { describe, expect, it } from "vitest"

import {
  isRelativeAttachmentHref,
  extractEmbeddedSection,
  extractExcalidrawTextElements,
  frontmatterLineCount,
  obsidianAnchorId,
  parseMarkdownNoteHref,
  parseVaultAssetHref,
  parseWikiEmbedHref,
  parseWikiHref,
  rewriteWikiLinks,
  stripMarkdownFrontmatter,
} from "./markdown-preview-utils"

describe("Markdown preview wiki links", () => {
  it("rewrites wiki links, aliases, and heading targets", () => {
    const output = rewriteWikiLinks("[[产品灵感]] [[WebDAV 同步设计#冲突|同步冲突]]")

    expect(output).toContain("[产品灵感](swell-note://wiki/%E4%BA%A7%E5%93%81%E7%81%B5%E6%84%9F)")
    expect(output).toContain("[同步冲突](swell-note://wiki/WebDAV%20%E5%90%8C%E6%AD%A5%E8%AE%BE%E8%AE%A1%23%E5%86%B2%E7%AA%81)")
  })

  it("keeps fenced code blocks unchanged", () => {
    const content = "正文 [[产品灵感]]\n```md\n[[代码示例]]\n```"

    expect(rewriteWikiLinks(content)).toContain("```md\n[[代码示例]]\n```")
  })

  it("parses only valid internal wiki hrefs", () => {
    expect(parseWikiHref("swell-note://wiki/%E4%BA%A7%E5%93%81%E7%81%B5%E6%84%9F")).toBe("产品灵感")
    expect(parseWikiHref("https://example.com")).toBeNull()
    expect(parseWikiHref("swell-note://wiki/%E0%A4%A")).toBeNull()
  })

  it("recognizes standard Markdown note links as internal routes", () => {
    expect(parseMarkdownNoteHref("../docs/方案%20A.md#目标")).toBe("../docs/方案 A.md#目标")
    expect(parseMarkdownNoteHref("<../docs/方案 A.md#目标>")).toBe("../docs/方案 A.md#目标")
    expect(parseMarkdownNoteHref("/Swell/README.MD")).toBe("/Swell/README.MD")
    expect(parseMarkdownNoteHref("#目标")).toBeNull()
    expect(parseMarkdownNoteHref("https://example.com/readme.md")).toBeNull()
    expect(parseMarkdownNoteHref("//example.com/readme.md")).toBeNull()
    expect(parseMarkdownNoteHref("../attachments/image.png")).toBeNull()
  })

  it("rewrites Obsidian embedded files as local assets", () => {
    const output = rewriteWikiLinks("![[assets/封面.png]]\n![[资料/方案.pdf|查看方案]]\n![[产品灵感]]")

    expect(output).toContain("![封面.png](swell-note://asset/assets%2F%E5%B0%81%E9%9D%A2.png)")
    expect(output).toContain("[查看方案](swell-note://asset/%E8%B5%84%E6%96%99%2F%E6%96%B9%E6%A1%88.pdf)")
    expect(output).toContain("[产品灵感](swell-note://embed/%E4%BA%A7%E5%93%81%E7%81%B5%E6%84%9F)")
    expect(parseVaultAssetHref("swell-note://asset/docs%2Fdemo.pdf")).toBe("docs/demo.pdf")
    expect(parseWikiEmbedHref("swell-note://embed/%E4%BA%A7%E5%93%81%E7%81%B5%E6%84%9F")).toBe("产品灵感")
  })

  it("turns image size aliases into markdown titles", () => {
    const output = rewriteWikiLinks("![[截图.png|300]]\n![[assets/封面.jpg|640x480]]\n![[示意图.png|产品截图]]")

    expect(output).toContain('![截图.png](swell-note://asset/%E6%88%AA%E5%9B%BE.png "300")')
    expect(output).toContain('![封面.jpg](swell-note://asset/assets%2F%E5%B0%81%E9%9D%A2.jpg "640x480")')
    // 非尺寸别名仍作为替代文本使用。
    expect(output).toContain("![产品截图](swell-note://asset/%E7%A4%BA%E6%84%8F%E5%9B%BE.png)")
  })

  it("normalizes hybrid Obsidian labels with Markdown image paths", () => {
    const output = rewriteWikiLinks([
      "![[截图.png]](../attachments/IMG.png)",
      "![[截图.png|300]](../attachments/IMG.png)",
      "![[截图.png|640x360]](../attachments/IMG.png)",
    ].join("\n"))

    expect(output).toContain("![截图.png](../attachments/IMG.png)")
    expect(output).toContain("![截图.png|300](../attachments/IMG.png)")
    expect(output).toContain("![截图.png|640x360](../attachments/IMG.png)")
  })

  it("creates stable heading and block anchors", () => {
    expect(obsidianAnchorId("同步 设计 / 冲突！")).toBe("同步-设计-冲突")
    expect(obsidianAnchorId("^task-01")).toBe("block-task-01")
  })

  it("extracts readable text from Excalidraw markdown", () => {
    const content = "---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n## Text Elements\n方案 A ^abc123\n第二行\n%%\n## Drawing\n```compressed-json\nN4K\n```"
    expect(extractExcalidrawTextElements(content)).toEqual(["方案 A", "第二行"])
  })

  it("hides YAML frontmatter only from the rendered Markdown body", () => {
    expect(stripMarkdownFrontmatter("---\ntitle: 示例\ntags: [a]\n---\n# 正文")).toBe("# 正文")
    expect(stripMarkdownFrontmatter("---\n正文没有闭合")).toBe("---\n正文没有闭合")
  })

  it("counts frontmatter lines for preview-to-source line mapping", () => {
    expect(frontmatterLineCount("---\ntitle: 示例\ntags: [a]\n---\n- [ ] 任务")).toBe(4)
    expect(frontmatterLineCount("无 frontmatter\n- [ ] 任务")).toBe(0)
  })

  it("detects relative attachment links of any uploaded file type", () => {
    expect(isRelativeAttachmentHref("../assets/demo.pdf")).toBe(true)
    expect(isRelativeAttachmentHref("recording.mp3?download=1")).toBe(true)
    expect(isRelativeAttachmentHref("attachments/方案-20260824150405.docx")).toBe(true)
    expect(isRelativeAttachmentHref("attachments/素材.zip")).toBe(true)
    expect(isRelativeAttachmentHref("../attachments/说明.md")).toBe(true)
    expect(isRelativeAttachmentHref("https://example.com/demo.pdf")).toBe(false)
    expect(isRelativeAttachmentHref("notes/next.md")).toBe(false)
    expect(isRelativeAttachmentHref("notes/NEXT.MD")).toBe(false)
    expect(isRelativeAttachmentHref("docs/readme")).toBe(false)
  })
})

describe("Embedded section extraction", () => {
  const content = [
    "---",
    "title: 示例笔记",
    "---",
    "# 概述",
    "",
    "开头段落。",
    "",
    "## 方案",
    "",
    "第一段引用目标 ^para-01",
    "",
    "- 第一项 ^task-01",
    "  - 子项 A",
    "- 第二项",
    "",
    "| 列 A | 列 B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "^table-01",
    "",
    "```md",
    "代码块里的 ^fake-id",
    "```",
    "",
    "## 风险",
    "",
    "后续内容。",
  ].join("\n")

  it("extracts a paragraph block reference and strips the block id", () => {
    expect(extractEmbeddedSection(content, "^para-01")).toBe("第一段引用目标")
  })

  it("extracts a list item block with its nested children only", () => {
    expect(extractEmbeddedSection(content, "^task-01")).toBe("- 第一项\n  - 子项 A")
  })

  it("extracts the whole preceding block for a standalone block id line", () => {
    expect(extractEmbeddedSection(content, "^table-01")).toBe("| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |")
  })

  it("ignores block ids inside fenced code blocks", () => {
    expect(extractEmbeddedSection(content, "^fake-id")).toBeNull()
  })

  it("extracts a heading section up to the next same-level heading", () => {
    const section = extractEmbeddedSection(content, "方案")
    expect(section).toContain("## 方案")
    expect(section).toContain("第一段引用目标")
    expect(section).toContain("| 列 A | 列 B |")
    expect(section).not.toContain("## 风险")
    expect(section).not.toContain("后续内容")
    expect(section).not.toContain("title: 示例笔记")
  })

  it("matches headings case-insensitively and supports chained anchors", () => {
    expect(extractEmbeddedSection(content, "#概述")).toContain("# 概述")
    const chained = extractEmbeddedSection(content, "概述#方案")
    expect(chained).toContain("第一段引用目标")
    expect(chained).not.toContain("## 风险")
    expect(extractEmbeddedSection(content, "不存在的章节#方案")).toBeNull()
  })

  it("returns null for missing or empty anchors", () => {
    expect(extractEmbeddedSection(content, "")).toBeNull()
    expect(extractEmbeddedSection(content, "^missing")).toBeNull()
    expect(extractEmbeddedSection(content, "不存在的标题")).toBeNull()
  })

  it("extracts from a sub-heading until the parent-level heading", () => {
    const nested = [
      "# 父级",
      "",
      "父级正文。",
      "",
      "## 子级",
      "",
      "子级正文。",
      "",
      "# 兄弟",
    ].join("\n")
    const section = extractEmbeddedSection(nested, "子级")
    expect(section).toBe("## 子级\n\n子级正文。")
  })
})
