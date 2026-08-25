import { isExcalidrawMarkdown } from "@/services/markdown/markdown-preview-utils"
import type { Note } from "@/types/note"

const TASK_PATTERN = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/

export function canReceiveQuickTask(note: Note) {
  // 画布类文档的正文由绘图数据结构托管，追加 Markdown 任务行会破坏源文件语义。
  return Boolean(note.contentLoaded)
    && !note.readOnly
    && note.format !== "canvas"
    && note.pendingOperation !== "delete"
    && !isExcalidrawMarkdown(note.content)
}

export function resolveQuickTaskTarget(activeNote: Note | null | undefined, candidates: readonly Note[]) {
  if (activeNote && canReceiveQuickTask(activeNote)) return activeNote
  return candidates.find(canReceiveQuickTask) ?? null
}

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

export function setMarkdownTaskChecked(content: string, lineNumber: number, checked: boolean) {
  const lines = content.split("\n")
  const lineIndex = lineNumber - 1
  const line = lines[lineIndex]
  if (line === undefined || !TASK_PATTERN.test(line)) {
    throw new Error("待办来源已经变化，请重新加载笔记")
  }
  lines[lineIndex] = line.replace(/\[([ xX])\]/, checked ? "[x]" : "[ ]")
  return lines.join("\n")
}
