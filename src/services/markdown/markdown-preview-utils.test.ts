import { describe, expect, it } from "vitest"

import { parseWikiHref, rewriteWikiLinks } from "./markdown-preview-utils"

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
})
