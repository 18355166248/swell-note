import { useEffect, useId, useMemo, useRef, useState } from "react"
import { CircleX, FileSearch, LoaderCircle, Search, X } from "lucide-react"

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
  onSelectNote: (note: Note, query: string) => void
  open: boolean
  placement?: "bottom" | "center"
}

// 全局搜索始终扫全库（allNotes），不受当前选中的文件夹 / 标签 / 视图影响；
// 这一点是它和列表顶部那个仅过滤当前候选集的搜索框最本质的区别。
export function GlobalSearchDialog({ cacheId, notes, onOpenChange, onSelectNote, open, placement = "center" }: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [nativeMatch, setNativeMatch] = useState<{ paths: Set<string>; query: string } | null>(null)
  const [visibleCount, setVisibleCount] = useState(RESULT_LIMIT)
  const [completedQuery, setCompletedQuery] = useState("")
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
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
    if (!open || !normalizedQuery || !cacheId) {
      setNativeMatch(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      const search = supportsNativeSearchIndex()
        ? searchNativeNoteIndex(cacheId, normalizedQuery, Math.max(5_000, notes.length))
        : searchCachedNoteDocuments(cacheId, normalizedQuery, Math.max(5_000, notes.length))
      void search
        .then((paths) => { if (!cancelled && paths) setNativeMatch({ paths: new Set(paths), query: normalizedQuery }) })
        .catch(() => { if (!cancelled) setNativeMatch(null) })
        .finally(() => { if (!cancelled) setCompletedQuery(normalizedQuery) })
    }, 120)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [cacheId, normalizedQuery, open, notes.length])

  const nativePaths = nativeMatch?.query === normalizedQuery ? nativeMatch.paths : null

  const searching = Boolean(open && cacheId && normalizedQuery && completedQuery !== normalizedQuery)
  const matches = useMemo(() => {
    if (!normalizedQuery) return sortNotes(notes, "updated-desc").slice(0, RECENT_LIMIT)
    const matched = notes.filter((note) => {
      if (`${note.title} ${note.preview}`.toLocaleLowerCase().includes(normalizedQuery)) return true
      return nativePaths
        ? Boolean(note.remotePath && nativePaths.has(note.remotePath))
        : Boolean(note.searchText?.includes(normalizedQuery))
    })
    return sortNotes(matched, "updated-desc")
  }, [normalizedQuery, notes, nativePaths])

  const results = matches.slice(0, visibleCount)
  useEffect(() => { setActiveIndex(0); setVisibleCount(RESULT_LIMIT); setCompletedQuery("") }, [normalizedQuery, open, cacheId])
  useEffect(() => { setActiveIndex((index) => Math.max(0, Math.min(index, matches.length - 1))) }, [matches])
  useEffect(() => {
    // 焦点留在输入框，活动结果滚入视野；不能只更新颜色而让键盘用户丢失位置。
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: "nearest" })
  }, [activeIndex, visibleCount, normalizedQuery, matches])

  const selectResult = (note: Note) => {
    onOpenChange(false)
    onSelectNote(note, query.trim())
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="global-search-dialog"
        onKeyDown={(event) => {
          // 候选词确认的回车只交给输入法，不能打开笔记；按钮上的回车保留其原生语义。
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.target !== inputRef.current) return
          if (event.key === "ArrowDown") {
            event.preventDefault()
            const next = Math.max(0, Math.min(activeIndex + 1, matches.length - 1))
            if (next >= visibleCount) setVisibleCount((count) => count + RESULT_LIMIT)
            setActiveIndex(next)
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
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={results.length ? listId : undefined}
            aria-activedescendant={results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索所有笔记的标题、标签与正文"
            ref={inputRef}
            value={query}
          />
          {query && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => { setQuery(""); inputRef.current?.focus() }}><CircleX /></button>}
          <button type="button" aria-label="关闭全局搜索" title="关闭（Esc）" onClick={() => onOpenChange(false)}><X /></button>
        </div>
        <div className="global-search-summary" role="status">
          {searching ? <><LoaderCircle className="animate-spin" />正在搜索正文…</> : normalizedQuery ? `找到 ${matches.length} 篇，已显示 ${results.length} 篇` : "最近更新"}
        </div>
        <ScrollArea className="global-search-results">
          {results.length === 0 ? (
            <p className="global-search-empty">
              <FileSearch />
              {searching ? "正在查找，请稍候…" : normalizedQuery ? "没有找到匹配的笔记" : "最近更新的笔记会显示在这里"}
            </p>
          ) : (
            <ul id={listId} ref={listRef} role="listbox" aria-label="搜索结果">
              {results.map((note, index) => (
                <GlobalSearchResultRow
                  active={index === activeIndex}
                  id={`${listId}-${index}`}
                  index={index}
                  key={note.id}
                  note={note}
                  onHover={() => setActiveIndex(index)}
                  onSelect={() => selectResult(note)}
                  query={normalizedQuery}
                />
              ))}
            </ul>
          )}
          {results.length < matches.length && <button className="global-search-more" type="button" onClick={() => setVisibleCount((count) => count + RESULT_LIMIT)}>加载更多（剩余 {matches.length - results.length} 篇）</button>}
        </ScrollArea>
        <div className="global-search-help">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </DialogContent>
    </Dialog>
  )
}

function GlobalSearchResultRow({ active, id, index, note, onHover, onSelect, query }: {
  active: boolean
  id: string
  index: number
  note: Note
  onHover: () => void
  onSelect: () => void
  query: string
}) {
  const snippet = useSearchMatch(note, query)
  return (
    <li role="presentation">
      <button
        id={id}
        data-index={index}
        role="option"
        aria-selected={active}
        tabIndex={-1}
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
