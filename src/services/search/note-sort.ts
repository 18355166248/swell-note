import type { Note } from "@/types/note"

export type NoteSort = "title-asc" | "updated-asc" | "updated-desc"

export function sortNotes(notes: Note[], sort: NoteSort) {
  if (sort !== "title-asc" && notes.some((note) => note.modifiedAt === undefined)) {
    // 旧版离线缓存没有 modifiedAt；整组保持原顺序，避免不完整时间造成不稳定比较和列表跳动。
    return [...notes]
  }

  return notes
    .map((note, index) => ({ index, note }))
    .sort((left, right) => {
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
