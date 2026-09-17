import { describe, expect, it } from "vitest"

import { expandMarkdown, markdownDiffSummary, markdownStats } from "./editor-lab-model"

describe("editor lab model", () => {
  it("统计 Markdown 规模", () => {
    expect(markdownStats("# 标题\n\nhello world")).toEqual({ characters: 17, lines: 3, words: 4 })
  })

  it("区分完全保真与行级改写", () => {
    expect(markdownDiffSummary("a\nb\n", "a\nb\n")).toEqual({ addedLines: 0, exact: true, removedLines: 0 })
    expect(markdownDiffSummary("a\nb\n", "a\nc\n")).toEqual({ addedLines: 1, exact: false, removedLines: 1 })
  })

  it("生成可重复的长文样本", () => {
    const expanded = expandMarkdown("# 标题\n\n正文", 3)
    expect(expanded).toContain("# 长文性能测试 · 3 份")
    expect(expanded.match(/## 长文重复段/g)).toHaveLength(3)
    expect(expandMarkdown("短文", 1)).toBe("短文")
  })
})
