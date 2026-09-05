import { Fragment, useMemo } from "react"

import { buildNoteSearchSnippet } from "@/services/markdown/note-preview"
import { splitByQuery } from "@/services/search/note-search-highlight"
import type { Note } from "@/types/note"

// 命中词经常落在固定摘要之外，用户看着列表想不明白这篇为什么会搜到；
// 标题命中就够了，标题和默认摘要都没命中才去正文里现摘一段带关键词的片段。
export function useSearchMatch(note: Note, query: string) {
  return useMemo(() => {
    const needle = query.trim()
    if (!needle) return note.preview
    const haystack = `${note.title} ${note.preview}`.toLocaleLowerCase()
    if (haystack.includes(needle.toLocaleLowerCase())) return note.preview
    return buildNoteSearchSnippet(note.content, needle, note.format) ?? note.preview
  }, [note.content, note.format, note.preview, note.title, query])
}

// query 为空、或这段文字压根没命中时直接原样渲染，避免给列表里每一行都套一层 <mark> 开销。
export function HighlightedText({ query, text }: { query: string; text: string }) {
  if (!query.trim()) return <>{text}</>
  const segments = splitByQuery(text, query)
  if (!segments.some((segment) => segment.matched)) return <>{text}</>
  return (
    <>
      {segments.map((segment, index) => segment.matched
        ? <mark key={index}>{segment.text}</mark>
        : <Fragment key={index}>{segment.text}</Fragment>)}
    </>
  )
}
