import type { EditorLinkTarget } from "./markdown-input"
import type { TableEditTarget } from "./table-edit-target"

export type LinkCellSnapshot = {
  from: number
  target: TableEditTarget
  to: number
  value: string
}

export type MarkdownFindResult = {
  current: number
  total: number
}

export type MarkdownEditorHandle = {
  applyLink: (target: EditorLinkTarget | null, label: string, url: string, cell?: LinkCellSnapshot | null) => boolean
  captureInsertion: (position?: number) => { insert: (text: string) => boolean; dispose: () => void }
  collapseSelection: () => void
  copySelection: () => Promise<boolean>
  cutSelection: () => Promise<boolean>
  focus: () => void
  findText: (query: string, direction?: "next" | "previous", fromStart?: boolean) => MarkdownFindResult
  insertText: (text: string) => void
  lineAtViewportTop: (clientY: number) => number | null
  pasteAtSelection: () => Promise<boolean>
  readLinkContext: () => { cell?: LinkCellSnapshot; hadFocus: boolean; selectedText: string; target: EditorLinkTarget | null } | null
  redo: () => void
  removeLink: (target: EditorLinkTarget, cell?: LinkCellSnapshot | null) => boolean
  replaceAll: (query: string, replacement: string) => number
  replaceCurrent: (query: string, replacement: string) => MarkdownFindResult
  restoreCellFocus: (cell?: LinkCellSnapshot | null) => boolean
  revealLine: (line: number) => void
  scrollLineToTop: (line: number) => boolean
  selectAll: () => void
  undo: () => void
}

export const TABLE_INSERT_TEMPLATE = "\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n"
