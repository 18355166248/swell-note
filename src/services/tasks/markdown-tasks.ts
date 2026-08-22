import type { Note } from "@/types/note"

const TASK_PATTERN = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/

export type MarkdownTask = {
  checked: boolean
  id: string
  line: number
  noteId: string
  noteTitle: string
  text: string
}

export function extractMarkdownTasks(notes: Note[]) {
  return notes.flatMap((note) => {
    if (!note.contentLoaded) return []
    return note.content.split("\n").flatMap((line, index): MarkdownTask[] => {
      const match = line.match(TASK_PATTERN)
      if (!match) return []
      return [{
        checked: match[1].toLocaleLowerCase() === "x",
        id: `${note.id}:${index + 1}`,
        line: index + 1,
        noteId: note.id,
        noteTitle: note.title,
        text: match[2],
      }]
    })
  })
}
