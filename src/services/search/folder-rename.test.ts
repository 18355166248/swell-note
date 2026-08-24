import { describe, expect, it } from "vitest"

import { getFolderRenameTarget } from "@/services/search/folder-rename"

describe("folder rename", () => {
  it("重命名目录时保留子目录和文件名", () => {
    expect(getFolderRenameTarget("工作 / 项目 / 客户端", "工作 / 项目", "产品", "首页.md"))
      .toEqual({ folder: "工作 / 产品 / 客户端", relativePath: "工作/产品/客户端/首页.md" })
  })

  it("忽略不属于目标目录的笔记并清理非法字符", () => {
    expect(getFolderRenameTarget("生活", "工作", "产品", "首页.md")).toBeNull()
    expect(getFolderRenameTarget("工作", "工作", "产品/一期", "首页.md")?.folder).toBe("产品-一期")
  })
})
