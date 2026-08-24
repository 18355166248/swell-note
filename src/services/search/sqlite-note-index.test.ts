import { describe, expect, it, vi } from "vitest"

import { getNativeSearchIndexStatus, rebuildNativeSearchIndex, toNativeSearchEntry } from "./sqlite-note-index"

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }))
vi.mock("@tauri-apps/api/core", () => tauriMocks)

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

  it("通过原生命令查询和重建可恢复索引", async () => {
    const status = { cacheCount: 1, databaseSizeBytes: 4096, healthy: true, indexedNotes: 81, schemaVersion: 1 }
    tauriMocks.invoke.mockResolvedValue(status)

    await expect(getNativeSearchIndexStatus()).resolves.toEqual(status)
    await expect(rebuildNativeSearchIndex()).resolves.toEqual(status)
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, "get_search_index_status")
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, "rebuild_note_search_index")
  })
})
