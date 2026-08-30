import { describe, expect, it } from "vitest"

import { resolveMarkdownMovedPath, rewriteMarkdownLinksForMoves } from "./markdown-link-rewrite"

describe("rewriteMarkdownLinksForMoves", () => {
  it("rebases note and attachment links when the current document moves", () => {
    const result = rewriteMarkdownLinksForMoves(
      "[方案](../docs/%E6%96%B9%E6%A1%88%20A.md#目标)\n![截图](../attachments/a.png)",
      "Swell/inbox/index.md",
      [{ fromPath: "Swell/inbox/index.md", toPath: "Swell/archive/2026/index.md" }],
    )

    expect(result.content).toBe(
      "[方案](../../docs/%E6%96%B9%E6%A1%88%20A.md#目标)\n![截图](../../attachments/a.png)",
    )
    expect(result.changedCount).toBe(2)
  })

  it("updates inbound links when a target note moves", () => {
    const result = rewriteMarkdownLinksForMoves(
      '[计划](../计划.md "保留标题")',
      "Swell/docs/index.md",
      [{ fromPath: "Swell/计划.md", toPath: "Swell/archive/年度计划.md" }],
    )

    expect(result.content).toBe('[计划](../archive/%E5%B9%B4%E5%BA%A6%E8%AE%A1%E5%88%92.md "保留标题")')
    expect(result.changedCount).toBe(1)
  })

  it("maps nested notes and assets during a directory move", () => {
    const result = rewriteMarkdownLinksForMoves(
      "[详情](topic/detail.md) ![图](topic/assets/a%20b.png)",
      "Swell/index.md",
      [{ fromPath: "Swell/topic", kind: "directory", toPath: "Swell/知识/topic" }],
    )

    expect(result.content).toBe(
      "[详情](%E7%9F%A5%E8%AF%86/topic/detail.md) ![图](%E7%9F%A5%E8%AF%86/topic/assets/a%20b.png)",
    )
    expect(result.changedCount).toBe(2)
  })

  it("skips external links, anchors, fenced code, and inline code", () => {
    const content = [
      "[外链](https://example.com/a.md)",
      "[标题](#section)",
      "`[示例](old.md)`",
      "```md",
      "[示例](old.md)",
      "```",
      "[真实](old.md)",
    ].join("\n")
    const result = rewriteMarkdownLinksForMoves(
      content,
      "Swell/index.md",
      [{ fromPath: "Swell/old.md", toPath: "Swell/new.md" }],
    )

    expect(result.content).toBe(content.replace("[真实](old.md)", "[真实](new.md)"))
    expect(result.changedCount).toBe(1)
  })

  it("rewrites reference definitions and preserves angle brackets", () => {
    const result = rewriteMarkdownLinksForMoves(
      "[方案][plan]\n\n[plan]: <../plan.md> '标题'",
      "Swell/docs/index.md",
      [{ fromPath: "Swell/plan.md", toPath: "Swell/plans/H1.md" }],
    )

    expect(result.content).toBe("[方案][plan]\n\n[plan]: <../plans/H1.md> '标题'")
    expect(result.changedCount).toBe(1)
  })

  it("resolves moved storage paths while preserving a leading slash", () => {
    expect(resolveMarkdownMovedPath("/Swell/topic/a.md", [
      { fromPath: "/Swell/topic", kind: "directory", toPath: "/Swell/archive/topic" },
    ])).toBe("/Swell/archive/topic/a.md")
  })
})
