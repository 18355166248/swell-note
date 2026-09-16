import { markdownLanguage } from "@codemirror/lang-markdown"

import { isExcalidrawMarkdown } from "@/services/markdown/markdown-preview-utils"
import type { Note } from "@/types/note"

// 语法树先判定 TaskMarker，正则只负责提取该行文本；因此围栏/缩进代码不会被当成可操作任务。
const TASK_LINE_PATTERN = /^(?:(?: {0,3}>\s*)*)(?:\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*?)\s*$/

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

function parseMarkdownTasks(content: string) {
  const lines = content.split("\n")
  const lineStarts: number[] = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }
  const tasks = new Map<number, { checked: boolean; text: string }>()
  markdownLanguage.parser.parse(content).iterate({
    enter(node) {
      if (node.name !== "TaskMarker") return
      let low = 0
      let high = lineStarts.length - 1
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (lineStarts[middle] <= node.from) low = middle
        else high = middle - 1
      }
      const match = lines[low]?.match(TASK_LINE_PATTERN)
      if (match) tasks.set(low + 1, {
        checked: match[1].toLocaleLowerCase() === "x",
        text: match[2] ?? "",
      })
    },
  })
  return tasks
}

export function extractMarkdownTasks(notes: Note[]) {
  return notes.flatMap((note) => {
    if (!note.contentLoaded) return []
    return [...parseMarkdownTasks(note.content)].map(([line, task]): MarkdownTask => ({
        checked: task.checked,
        id: `${note.id}:${line}`,
        line,
        noteId: note.id,
        noteTitle: note.title,
        text: task.text,
      }))
  })
}

export function setMarkdownTaskChecked(content: string, lineNumber: number, checked: boolean) {
  const lines = content.split("\n")
  const lineIndex = lineNumber - 1
  const line = lines[lineIndex]
  if (line === undefined || !parseMarkdownTasks(content).has(lineNumber)) {
    throw new Error("待办来源已经变化，请重新加载笔记")
  }
  lines[lineIndex] = line.replace(/\[([ xX])\]/, checked ? "[x]" : "[ ]")
  return lines.join("\n")
}
