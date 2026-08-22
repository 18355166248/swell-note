import { describe, expect, it } from "vitest"

import { extractWikiLinks, normalizeNoteTarget } from "@/services/search/note-index"

describe("note index", () => {
  it("标准化 Obsidian 链接目标、标题锚点和别名", () => {
    expect(normalizeNoteTarget("docs/产品规划.md#目标|查看规划")).toBe("产品规划")
  })

  it("提取去重后的双向链接目标", () => {
    expect(extractWikiLinks("关联 [[产品规划]]、[[docs/技术方案.md|方案]] 和 [[产品规划#目标]]"))
      .toEqual(["产品规划", "技术方案"])
  })
})
