import { describe, expect, it } from "vitest"

import { groupNotesByDate } from "@/services/search/note-groups"
import type { Note } from "@/types/note"

const NOW = new Date("2026-08-25T12:00:00").getTime()
const DAY = 86400000

function note(id: string, modifiedAt?: number): Note {
  return { content: "", id, modifiedAt, preview: "", starred: false, title: id, updatedAt: "" }
}

function summarize(groups: ReturnType<typeof groupNotesByDate>) {
  return groups.map((group) => [group.label, group.notes.map(({ id }) => id)] as const)
}

describe("groupNotesByDate", () => {
  it("按真实修改时间分组，而不是按列表下标", () => {
    const notes = [
      note("a", NOW - 3600000),
      note("b", NOW - 5 * 3600000),
      note("c", NOW - 30 * 3600000),
      note("d", NOW - 5 * DAY),
      note("e", NOW - 200 * DAY),
    ]

    expect(summarize(groupNotesByDate(notes, "updated-desc", NOW))).toEqual([
      ["今天", ["a", "b"]],
      ["昨天", ["c"]],
      ["过去 7 天", ["d"]],
      ["更早", ["e"]],
    ])
  })

  it("同一天的笔记不会因为条数超过两条被拆到昨天", () => {
    const notes = [1, 2, 3, 4, 5].map((hour) => note(`n${hour}`, NOW - hour * 3600000))

    expect(summarize(groupNotesByDate(notes, "updated-desc", NOW))).toEqual([
      ["今天", ["n1", "n2", "n3", "n4", "n5"]],
    ])
  })

  it("升序排列时分组顺序跟随排序方向", () => {
    const notes = [note("old", NOW - 200 * DAY), note("new", NOW - 3600000)]

    expect(summarize(groupNotesByDate(notes, "updated-asc", NOW))).toEqual([
      ["更早", ["old"]],
      ["今天", ["new"]],
    ])
  })

  it("按标题排序时不产生日期分组标题", () => {
    const notes = [note("a", NOW), note("b", NOW - 200 * DAY)]

    expect(summarize(groupNotesByDate(notes, "title-asc", NOW))).toEqual([[null, ["a", "b"]]])
  })

  it("旧缓存整体缺少修改时间时退化为单个无标题分组", () => {
    expect(summarize(groupNotesByDate([note("a"), note("b")], "updated-desc", NOW)))
      .toEqual([[null, ["a", "b"]]])
  })

  it("个别笔记缺少修改时间时单独归入未知时间", () => {
    const notes = [note("a", NOW), note("b")]

    expect(summarize(groupNotesByDate(notes, "updated-desc", NOW))).toEqual([
      ["今天", ["a"]],
      ["未知时间", ["b"]],
    ])
  })

  it("同一档位被缺时间的笔记隔开时仍产生唯一分组 key", () => {
    // sortNotes 在存在缺失 modifiedAt 时原样返回，档位可能交错出现。
    const notes = [note("a", NOW), note("b"), note("c", NOW)]
    const groups = groupNotesByDate(notes, "updated-desc", NOW)

    expect(groups.map((group) => group.label)).toEqual(["今天", "未知时间", "今天"])
    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length)
  })

  it("远端时钟超前的笔记按今天处理", () => {
    expect(summarize(groupNotesByDate([note("a", NOW + 2 * DAY)], "updated-desc", NOW)))
      .toEqual([["今天", ["a"]]])
  })

  it("空列表不产生分组", () => {
    expect(groupNotesByDate([], "updated-desc", NOW)).toEqual([])
  })

  it("夏令时前进日不会把昨天算成今天", () => {
    // 2026-03-08 是美国夏令时开始日，当天只有 23 小时。
    const mar8Noon = new Date("2026-03-08T12:00:00-05:00").getTime()
    const mar9Noon = new Date("2026-03-09T12:00:00-04:00").getTime()

    expect(summarize(groupNotesByDate([note("x", mar8Noon)], "updated-desc", mar9Noon)))
      .toEqual([["昨天", ["x"]]])
  })
})
