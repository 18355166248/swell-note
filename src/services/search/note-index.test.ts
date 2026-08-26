import { describe, expect, it } from "vitest"

import { extractFrontmatter, extractWikiLinks, indexVaultFiles, normalizeNoteTarget } from "@/services/search/note-index"
import type { VaultAdapter } from "@/services/vault/vault-adapter"

describe("note index", () => {
  it("标准化 Obsidian 链接目标、标题锚点和别名", () => {
    expect(normalizeNoteTarget("docs/产品规划.md#目标|查看规划")).toBe("产品规划")
  })

  it("提取标准 Markdown 笔记链接，并兼容旧双链", () => {
    const content = [
      "关联 [产品规划](../docs/产品规划.md#目标) 与 [技术方案](<../docs/技术 方案.md>)",
      "旧内容 [[产品规划]] 和 [[docs/历史方案.md|历史方案]]",
      "排除 ![图片](../attachments/产品规划.md) 与 [外站](https://example.com/readme.md)",
    ].join("\n")

    expect(extractWikiLinks(content)).toEqual(["产品规划", "历史方案", "技术 方案"])
  })

  it("解析 Obsidian Frontmatter 的行内与列表标签", () => {
    expect(extractFrontmatter("---\ntags: [工作, '#计划']\nstatus: active\n---\n# 正文"))
      .toEqual({ properties: { status: "active", tags: ["工作", "#计划"] }, tags: ["工作", "计划"] })
    expect(extractFrontmatter("---\ntags:\n  - 项目\n  - 周报\n---\n正文").tags)
      .toEqual(["项目", "周报"])
  })

  it("按配置分批索引，并允许单个文件读取失败", async () => {
    const adapter: VaultAdapter = {
      cacheIdentity: "test",
      cacheLabel: "测试",
      displayName: "测试",
      kind: "browser",
      listMarkdownFiles: async () => [],
      readOnly: true,
      async readTextFile(path) {
        if (path === "broken.md") throw new Error("读取失败")
        return { content: `# ${path}\n\n关联 [[目标]]` }
      },
    }
    const progress: number[] = []
    const indexedPaths: string[] = []

    await indexVaultFiles(
      adapter,
      ["one.md", "broken.md", "two.md"].map((path) => ({ name: path, path })),
      (batch, indexed) => {
        progress.push(indexed)
        indexedPaths.push(...batch.map((item) => item.path))
      },
      () => false,
      { batchSize: 2 },
    )

    expect(progress).toEqual([2, 3])
    expect(indexedPaths).toEqual(["one.md", "two.md"])
  })
})
