import { describe, expect, it } from "vitest"

import { toNativeSearchEntry } from "./sqlite-note-index"

describe("sqlite note index mapping", () => {
  it("将解析后的笔记转换为原生索引记录", () => {
    expect(toNativeSearchEntry({
      content: "# 周报",
      frontmatter: {},
      outgoingLinks: [],
      path: "工作/周报.md",
      revision: "v1",
      searchText: "周报",
      tags: ["工作", "总结"],
    })).toEqual({
      content: "# 周报",
      noteId: "工作/周报.md",
      path: "工作/周报.md",
      tags: "工作 总结",
      title: "周报",
    })
  })
})
