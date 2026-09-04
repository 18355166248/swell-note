import { describe, expect, it } from "vitest"

import { splitByQuery } from "@/services/search/note-search-highlight"

describe("splitByQuery", () => {
  it("query 为空时整段原样返回", () => {
    expect(splitByQuery("笔记 06 周报", "")).toEqual([{ matched: false, text: "笔记 06 周报" }])
  })

  it("按命中处切片，保留原文大小写", () => {
    expect(splitByQuery("笔记 06 周报", "周报")).toEqual([
      { matched: false, text: "笔记 06 " },
      { matched: true, text: "周报" },
    ])
  })

  it("不区分大小写匹配", () => {
    expect(splitByQuery("Weekly Report", "report")).toEqual([
      { matched: false, text: "Weekly " },
      { matched: true, text: "Report" },
    ])
  })

  it("命中多处时逐一切片", () => {
    expect(splitByQuery("周报周报", "周报")).toEqual([
      { matched: true, text: "周报" },
      { matched: true, text: "周报" },
    ])
  })

  it("没有命中时整段原样返回", () => {
    expect(splitByQuery("笔记 06 周报", "会议")).toEqual([{ matched: false, text: "笔记 06 周报" }])
  })
})
