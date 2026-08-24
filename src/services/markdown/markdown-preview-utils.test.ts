import { describe, expect, it } from "vitest"

import {
  isRelativeAttachmentHref,
  parseVaultAssetHref,
  parseWikiHref,
  rewriteWikiLinks,
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

  it("rewrites Obsidian embedded files as local assets", () => {
    const output = rewriteWikiLinks("![[assets/封面.png]]\n![[资料/方案.pdf|查看方案]]")

    expect(output).toContain("![封面.png](swell-note://asset/assets%2F%E5%B0%81%E9%9D%A2.png)")
    expect(output).toContain("[查看方案](swell-note://asset/%E8%B5%84%E6%96%99%2F%E6%96%B9%E6%A1%88.pdf)")
    expect(parseVaultAssetHref("swell-note://asset/docs%2Fdemo.pdf")).toBe("docs/demo.pdf")
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
