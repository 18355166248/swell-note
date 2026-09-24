import { describe, expect, it } from "vitest"

import type { Note } from "@/types/note"
import { matchesGlobalSearchFilters, ROOT_FOLDER_FILTER } from "./global-search-filter"

const note: Note = {
  content: "正在编辑的最新正文",
  contentLoaded: true,
  folder: "项目 / 方案",
  id: "n",
  preview: "最新正文",
  remotePath: "/Swell/项目/方案/n.md",
  source: "webdav",
  starred: false,
  syncStatus: "modified",
  tags: ["规划"],
  title: "会议纪要",
  updatedAt: "刚刚",
}

const filters = { folder: "", query: "", scope: "all" as const, tag: "" }

describe("global search filters", () => {
  it("标题和正文范围独立，始终以已加载的新正文覆盖旧索引", () => {
    const staleIndex = new Set([note.remotePath!])
    expect(matchesGlobalSearchFilters(note, { ...filters, query: "会议", scope: "title" }, staleIndex)).toBe(true)
    expect(matchesGlobalSearchFilters(note, { ...filters, query: "会议", scope: "body" }, staleIndex)).toBe(false)
    expect(matchesGlobalSearchFilters(note, { ...filters, query: "旧正文", scope: "body" }, staleIndex)).toBe(false)
    expect(matchesGlobalSearchFilters(note, { ...filters, query: "最新正文", scope: "body" }, staleIndex)).toBe(true)
  })

  it("未加载正文使用缓存路径；未同步工作副本不相信过期索引", () => {
    const indexed = new Set([note.remotePath!])
    expect(matchesGlobalSearchFilters({ ...note, content: "", contentLoaded: false, syncStatus: "synced" }, { ...filters, query: "缓存正文", scope: "body" }, indexed)).toBe(true)
    expect(matchesGlobalSearchFilters({ ...note, content: "", contentLoaded: false }, { ...filters, query: "缓存正文", scope: "body" }, indexed)).toBe(false)
    expect(matchesGlobalSearchFilters({ ...note, content: "", contentLoaded: false, syncStatus: "synced", searchText: "旧版兼容索引" }, { ...filters, query: "兼容索引" }, null)).toBe(true)
  })

  it("标签精确筛选，父目录包含子目录，根目录只含根笔记", () => {
    expect(matchesGlobalSearchFilters(note, { ...filters, tag: "规划", folder: "项目" }, null)).toBe(true)
    expect(matchesGlobalSearchFilters(note, { ...filters, tag: "规划中" }, null)).toBe(false)
    expect(matchesGlobalSearchFilters(note, { ...filters, folder: ROOT_FOLDER_FILTER }, null)).toBe(false)
    expect(matchesGlobalSearchFilters({ ...note, folder: undefined }, { ...filters, folder: ROOT_FOLDER_FILTER }, null)).toBe(true)
  })

  it("收藏与更新时间可以和目录、标签同时筛选", () => {
    const recent = { ...note, modifiedAt: 200, starred: true }
    expect(matchesGlobalSearchFilters(recent, { ...filters, folder: "项目", tag: "规划", starredOnly: true, updatedAfter: 100 }, null)).toBe(true)
    expect(matchesGlobalSearchFilters({ ...recent, starred: false }, { ...filters, starredOnly: true }, null)).toBe(false)
    expect(matchesGlobalSearchFilters({ ...recent, modifiedAt: 99 }, { ...filters, updatedAfter: 100 }, null)).toBe(false)
    expect(matchesGlobalSearchFilters({ ...recent, modifiedAt: undefined }, { ...filters, updatedAfter: 100 }, null)).toBe(false)
  })
})
