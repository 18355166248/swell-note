import { ensureSyntaxTree, foldEffect, foldService } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"

export function markdownHeadings(state: EditorState) {
  // 未完成解析时不能把后面的同级标题当成不存在，否则会误折整篇余下内容。
  const tree = ensureSyntaxTree(state, state.doc.length, 30)
  if (!tree) return []
  const headings: { from: number; to: number; level: number }[] = []
  tree.iterate({ enter(node) {
    const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name)
    if (match && state.doc.lineAt(node.from).from === node.from) headings.push({ from: node.from, to: node.to, level: Number(match[1]) })
  } })
  return headings
}
export function chapterRange(state: EditorState, headingFrom: number) {
  const headings = markdownHeadings(state), index = headings.findIndex((heading) => heading.from === headingFrom)
  if (index < 0) return null
  const heading = headings[index], next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
  const to = next ? Math.max(heading.to, next.from - 1) : state.doc.length
  return to > heading.to ? { from: heading.to, to } : null
}
export const chapterFolding = foldService.of((state, from) => chapterRange(state, from))
export { foldEffect }
