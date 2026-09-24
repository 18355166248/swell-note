// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { deleteSavedSearch, readSavedSearches, saveSavedSearch, type SavedSearch } from "./saved-searches"

const entry: SavedSearch = { name: "本周计划", query: "tag:计划 -body:草稿", scope: "body", tag: "计划", folder: "项目", updatedDays: "7", starredOnly: true }

beforeEach(() => localStorage.clear())

describe("saved searches", () => {
  it("按笔记库隔离，保存完整筛选条件并可删除", () => {
    expect(saveSavedSearch("库甲", entry)).toEqual([entry])
    expect(readSavedSearches("库甲")).toEqual([entry])
    expect(readSavedSearches("库乙")).toEqual([])
    expect(deleteSavedSearch("库甲", entry.name)).toEqual([])
  })

  it("拒绝重复名称和超过数量上限", () => {
    saveSavedSearch("库", entry)
    expect(() => saveSavedSearch("库", { ...entry, name: " 本周计划 " })).toThrow("已有同名搜索")
    for (let index = 1; index < 20; index += 1) saveSavedSearch("库", { ...entry, name: `搜索 ${index}` })
    expect(() => saveSavedSearch("库", { ...entry, name: "第 21 个" })).toThrow("最多保存 20 个")
  })

  it("损坏或未知版本的数据不影响搜索，非法条目不会加载", () => {
    const key = "swell-note:saved-searches:cache"
    localStorage.setItem(key, "{bad json")
    expect(readSavedSearches("cache")).toEqual([])
    localStorage.setItem(key, JSON.stringify({ version: 2, items: [entry] }))
    expect(readSavedSearches("cache")).toEqual([])
    localStorage.setItem(key, JSON.stringify({ version: 1, items: [{ ...entry, scope: "invalid" }, entry] }))
    expect(readSavedSearches("cache")).toEqual([entry])
  })
})
