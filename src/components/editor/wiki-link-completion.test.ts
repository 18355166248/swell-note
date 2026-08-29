import { describe, expect, it } from "vitest"

import { filterWikiLinkSuggestions, getWikiLinkQuery } from "./wiki-link-completion"

describe("wiki link completion", () => {
  it("detects an unfinished wiki link at the cursor", () => {
    expect(getWikiLinkQuery("参见 [[项目计", 0, 8)).toEqual({ from: 5, query: "项目计", to: 8 })
    expect(getWikiLinkQuery("[[完成]]", 0, 6)).toBeNull()
  })

  it("filters, prioritizes prefix matches, and removes duplicate targets", () => {
    const result = filterWikiLinkSuggestions([
      { detail: "工作/计划.md", target: "工作/计划", title: "计划" },
      { detail: "归档/项目计划.md", target: "归档/项目计划", title: "项目计划" },
      { detail: "重复", target: "工作/计划", title: "计划副本" },
    ], "项目")
    expect(result.map((item) => item.title)).toEqual(["项目计划"])
  })
})
