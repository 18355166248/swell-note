import type { Note } from "@/types/note"

export type NoteSort = "title-asc" | "updated-asc" | "updated-desc"

export function sortNotes(notes: Note[], sort: NoteSort, { pinnedFirst = true } = {}) {
  // 旧缓存缺时间时保留原有相对顺序，但仍让置顶笔记排在前面。
  const preserveTimeOrder = sort !== "title-asc" && notes.some((note) => note.modifiedAt === undefined)

  return notes
    .map((note, index) => ({ index, note }))
    .sort((left, right) => {
      const pinOrder = Number(Boolean(right.note.pinned)) - Number(Boolean(left.note.pinned))
      if (pinnedFirst && pinOrder) return pinOrder
      if (preserveTimeOrder) return left.index - right.index
      if (sort === "title-asc") {
        const titleOrder = left.note.title.localeCompare(right.note.title, "zh-CN", {
          numeric: true,
          sensitivity: "base",
        })
        return titleOrder || left.index - right.index
      }

      const leftModifiedAt = left.note.modifiedAt ?? 0
      const rightModifiedAt = right.note.modifiedAt ?? 0
      const timeOrder = leftModifiedAt - rightModifiedAt
      return (sort === "updated-desc" ? -timeOrder : timeOrder) || left.index - right.index
    })
    .map(({ note }) => note)
}
