import { describe, expect, it } from "vitest"

import { buildMarkdownNoteLink, buildRelativeMarkdownHref } from "./markdown-link"

describe("Markdown note links", () => {
  it("builds encoded relative paths between notes", () => {
    expect(buildRelativeMarkdownHref("/Swell/项目/首页.md", "/Swell/资料/方案 A.md"))
      .toBe("../%E8%B5%84%E6%96%99/%E6%96%B9%E6%A1%88%20A.md")
    expect(buildRelativeMarkdownHref("docs/index.md", "docs/detail.md")).toBe("detail.md")
  })

  it("escapes the Markdown label", () => {
    expect(buildMarkdownNoteLink("计划 [H1]", "plan.md")).toBe("[计划 \\[H1\\]](plan.md)")
  })
})
