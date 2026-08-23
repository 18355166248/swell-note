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
})
