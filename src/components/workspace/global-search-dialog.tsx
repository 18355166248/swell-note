import { useEffect, useMemo, useRef, useState } from "react"
import { FileSearch, Search } from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { HighlightedText, useSearchMatch } from "@/components/workspace/note-search-match"
import { searchCachedNoteDocuments } from "@/services/cache/vault-cache"
import { sortNotes } from "@/services/search/note-sort"
import { searchNativeNoteIndex, supportsNativeSearchIndex } from "@/services/search/sqlite-note-index"
import type { Note } from "@/types/note"

const RESULT_LIMIT = 50
const RECENT_LIMIT = 8

type GlobalSearchDialogProps = {
  cacheId: string | null
  notes: Note[]
  onOpenChange: (open: boolean) => void
  onSelectNote: (note: Note) => void
  open: boolean
  placement?: "bottom" | "center"
}

// 全局搜索始终扫全库（allNotes），不受当前选中的文件夹 / 标签 / 视图影响；
// 这一点是它和列表顶部那个仅过滤当前候选集的搜索框最本质的区别。
export function GlobalSearchDialog({ cacheId, notes, onOpenChange, onSelectNote, open, placement = "center" }: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [nativeMatch, setNativeMatch] = useState<{ paths: Set<string>; query: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setActiveIndex(0)
    setNativeMatch(null)
    // 弹窗打开动画与聚焦挤在同一帧时，部分浏览器会把焦点请求吞掉。
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const normalizedQuery = query.trim().toLocaleLowerCase()

  useEffect(() => {
    if (!normalizedQuery || !cacheId) {
      setNativeMatch(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const search = supportsNativeSearchIndex()
        ? searchNativeNoteIndex(cacheId, normalizedQuery)
        : searchCachedNoteDocuments(cacheId, normalizedQuery)
      void search
        .then((paths) => { if (!cancelled && paths) setNativeMatch({ paths: new Set(paths), query: normalizedQuery }) })
        .catch(() => { if (!cancelled) setNativeMatch(null) })
    }, 120)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [cacheId, normalizedQuery])

  const nativePaths = nativeMatch?.query === normalizedQuery ? nativeMatch.paths : null

  const results = useMemo(() => {
    if (!normalizedQuery) return sortNotes(notes, "updated-desc").slice(0, RECENT_LIMIT)
    const matched = notes.filter((note) => {
      if (`${note.title} ${note.preview}`.toLocaleLowerCase().includes(normalizedQuery)) return true
      return nativePaths
        ? Boolean(note.remotePath && nativePaths.has(note.remotePath))
        : Boolean(note.searchText?.includes(normalizedQuery))
    })
    return sortNotes(matched, "updated-desc").slice(0, RESULT_LIMIT)
  }, [normalizedQuery, notes, nativePaths])

  useEffect(() => { setActiveIndex(0) }, [results])

  const selectResult = (note: Note) => {
    onOpenChange(false)
    onSelectNote(note)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="global-search-dialog"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault()
            setActiveIndex((index) => Math.min(index + 1, results.length - 1))
          } else if (event.key === "ArrowUp") {
            event.preventDefault()
            setActiveIndex((index) => Math.max(index - 1, 0))
          } else if (event.key === "Enter") {
            event.preventDefault()
            const note = results[activeIndex]
            if (note) selectResult(note)
          }
        }}
        placement={placement}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">全局搜索</DialogTitle>
        <div className="global-search-input-wrap">
          <Search />
          <Input
            aria-label="全局搜索笔记"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索所有笔记的标题、标签与正文"
            ref={inputRef}
            value={query}
          />
        </div>
        <ScrollArea className="global-search-results">
          {results.length === 0 ? (
            <p className="global-search-empty">
              <FileSearch />
              {normalizedQuery ? "没有找到匹配的笔记" : "最近更新的笔记会显示在这里"}
            </p>
          ) : (
            <ul>
              {results.map((note, index) => (
                <GlobalSearchResultRow
                  active={index === activeIndex}
                  key={note.id}
                  note={note}
                  onHover={() => setActiveIndex(index)}
                  onSelect={() => selectResult(note)}
                  query={normalizedQuery}
                />
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function GlobalSearchResultRow({ active, note, onHover, onSelect, query }: {
  active: boolean
  note: Note
  onHover: () => void
  onSelect: () => void
  query: string
}) {
  const snippet = useSearchMatch(note, query)
  return (
    <li>
      <button
        className="global-search-result"
        data-active={active}
        onClick={onSelect}
        onMouseEnter={onHover}
        type="button"
      >
        <span className="global-search-result-heading">
          <strong><HighlightedText query={query} text={note.title || "未命名笔记"} /></strong>
          <span className="global-search-result-folder">{note.folder ?? "根目录"}</span>
        </span>
        <p><HighlightedText query={query} text={snippet} /></p>
      </button>
    </li>
  )
}
