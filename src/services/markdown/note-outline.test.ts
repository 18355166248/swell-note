import { describe, expect, it } from "vitest"

import { extractNoteOutline } from "./note-outline"

describe("extractNoteOutline", () => {
  it("extracts ATX and setext headings with source lines", () => {
    expect(extractNoteOutline("# 标题\n正文\n## [链接](https://example.com)\n尾部\n---\n")).toEqual([
      { anchor: "标题", level: 1, line: 1, text: "标题" },
      { anchor: "链接", level: 2, line: 3, text: "链接" },
      { anchor: "尾部", level: 2, line: 4, text: "尾部" },
    ])
  })

  it("ignores frontmatter and fenced code headings", () => {
    expect(extractNoteOutline("---\ntitle: # 属性\n---\n```md\n# 代码\n```\n# 正文")).toEqual([
      { anchor: "正文", level: 1, line: 7, text: "正文" },
    ])
  })
})
