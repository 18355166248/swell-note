import { describe, expect, it } from "vitest"

import { sortNotes } from "@/services/search/note-sort"
import type { Note } from "@/types/note"

function note(id: string, title: string, modifiedAt?: number): Note {
  return {
    content: "",
    id,
    modifiedAt,
    preview: "",
    starred: false,
    title,
    updatedAt: "",
  }
}

describe("sortNotes", () => {
  it("按最新与最早修改时间排序", () => {
    const notes = [note("a", "A", 10), note("b", "B", 30), note("c", "C", 20)]

    expect(sortNotes(notes, "updated-desc").map(({ id }) => id)).toEqual(["b", "c", "a"])
    expect(sortNotes(notes, "updated-asc").map(({ id }) => id)).toEqual(["a", "c", "b"])
  })

  it("按标题自然排序", () => {
    const notes = [note("a", "Note 10"), note("b", "note 2"), note("c", "Alpha")]

    expect(sortNotes(notes, "title-asc").map(({ id }) => id)).toEqual(["c", "b", "a"])
  })

  it("旧缓存缺少修改时间时保持原顺序", () => {
    const notes = [note("a", "A"), note("b", "B", 30), note("c", "C")]

    expect(sortNotes(notes, "updated-desc").map(({ id }) => id)).toEqual(["a", "b", "c"])
  })

  it.each(["updated-desc", "updated-asc", "title-asc"] as const)("%s 始终置顶优先，组内遵循所选排序", (sort) => {
    const notes = [
      note("a", "A", 30),
      { ...note("c", "C", 10), pinned: true },
      { ...note("b", "B", 20), pinned: true },
      note("d", "D", 40),
    ]
    const expected = sort === "updated-desc" ? ["b", "c", "d", "a"]
      : sort === "updated-asc" ? ["c", "b", "a", "d"] : ["b", "c", "a", "d"]

    expect(sortNotes(notes, sort).map(({ id }) => id)).toEqual(expected)
    expect(notes.map(({ id }) => id)).toEqual(["a", "c", "b", "d"])
  })

  it("旧缓存缺时间时仍置顶，但不打乱各组的原始顺序", () => {
    const notes = [note("a", "A"), { ...note("b", "B", 30), pinned: true }, note("c", "C", 10)]
    expect(sortNotes(notes, "updated-desc").map(({ id }) => id)).toEqual(["b", "a", "c"])
  })

  it("取消置顶恢复正常排序，收藏不等同于置顶", () => {
    const notes = [{ ...note("old", "A", 10), pinned: false, starred: true }, note("new", "B", 20)]
    expect(sortNotes(notes, "updated-desc").map(({ id }) => id)).toEqual(["new", "old"])
  })

  it("最近笔记筛选可忽略置顶，避免把旧笔记挤入最近范围", () => {
    const notes = [{ ...note("old", "A", 10), pinned: true }, note("new", "B", 20)]
    expect(sortNotes(notes, "updated-desc", { pinnedFirst: false }).slice(0, 1).map(({ id }) => id)).toEqual(["new"])
  })
})
