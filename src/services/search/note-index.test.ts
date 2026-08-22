import { describe, expect, it } from "vitest"

import { extractWikiLinks, indexVaultFiles, normalizeNoteTarget } from "@/services/search/note-index"
import type { VaultAdapter } from "@/services/vault/vault-adapter"

describe("note index", () => {
  it("标准化 Obsidian 链接目标、标题锚点和别名", () => {
    expect(normalizeNoteTarget("docs/产品规划.md#目标|查看规划")).toBe("产品规划")
  })

  it("提取去重后的双向链接目标", () => {
    expect(extractWikiLinks("关联 [[产品规划]]、[[docs/技术方案.md|方案]] 和 [[产品规划#目标]]"))
      .toEqual(["产品规划", "技术方案"])
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
