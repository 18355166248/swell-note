import { useEffect, useId, useMemo, useRef, useState } from "react"
import { CircleX, FileSearch, LoaderCircle, Search, X } from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { HighlightedText, useSearchMatch } from "@/components/workspace/note-search-match"
import { searchCachedNoteDocuments } from "@/services/cache/vault-cache"
import { matchesGlobalSearchFilters, ROOT_FOLDER_FILTER, type GlobalSearchScope } from "@/services/search/global-search-filter"
import { sortNotes } from "@/services/search/note-sort"
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
  const [scope, setScope] = useState<GlobalSearchScope>("all")
  const [tag, setTag] = useState("")
  const [folder, setFolder] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [indexedMatch, setIndexedMatch] = useState<{ paths: Set<string>; key: string } | null>(null)
  const [visibleCount, setVisibleCount] = useState(RESULT_LIMIT)
  const [completedQuery, setCompletedQuery] = useState("")
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setScope("all")
    setTag("")
    setFolder("")
    setActiveIndex(0)
    setIndexedMatch(null)
    // 弹窗打开动画与聚焦挤在同一帧时，部分浏览器会把焦点请求吞掉。
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searchKey = `${scope}\u0000${normalizedQuery}`
  const tags = useMemo(() => [...new Set(notes.flatMap((note) => note.tags ?? []))]
    .sort((left, right) => left.localeCompare(right)), [notes])
  const folders = useMemo(() => [...new Set(notes.flatMap((note) => {
    if (!note.folder || note.folder === "根目录") return []
    const parts = note.folder.split(" / ")
    return parts.map((_, index) => parts.slice(0, index + 1).join(" / "))
  }))]
    .sort((left, right) => left.localeCompare(right)), [notes])

  useEffect(() => {
    if (!open || !normalizedQuery || !cacheId || scope === "title") {
      setIndexedMatch(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      // 全局筛选统一以文档缓存为后备索引；原生 FTS 额外搜索路径且分词不同，会让范围筛选两端不一致。
      const search = searchCachedNoteDocuments(cacheId, normalizedQuery, Math.max(5_000, notes.length), scope === "body" ? "body" : "all")
      void search
        .then((paths) => { if (!cancelled) setIndexedMatch({ paths: new Set(paths), key: searchKey }) })
        .catch(() => { if (!cancelled) setIndexedMatch(null) })
        .finally(() => { if (!cancelled) setCompletedQuery(searchKey) })
    }, 120)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [cacheId, normalizedQuery, open, notes, scope, searchKey])

  const indexedPaths = indexedMatch?.key === searchKey ? indexedMatch.paths : null

  const searching = Boolean(open && cacheId && normalizedQuery && scope !== "title" && completedQuery !== searchKey)
  const matches = useMemo(() => {
    if (!normalizedQuery && !tag && !folder) return sortNotes(notes, "updated-desc", { pinnedFirst: false }).slice(0, RECENT_LIMIT)
    const matched = notes.filter((note) => matchesGlobalSearchFilters(note, {
      folder, query: normalizedQuery, scope, tag,
    }, indexedPaths))
    return sortNotes(matched, "updated-desc")
  }, [folder, indexedPaths, normalizedQuery, notes, scope, tag])

  const results = matches.slice(0, visibleCount)
  useEffect(() => { setActiveIndex(0); setVisibleCount(RESULT_LIMIT) }, [searchKey, tag, folder, open, cacheId])
  useEffect(() => { setCompletedQuery("") }, [searchKey, open, cacheId])
  useEffect(() => { setActiveIndex((index) => Math.max(0, Math.min(index, matches.length - 1))) }, [matches])
  useEffect(() => {
    const viewport = resultsRef.current
    const active = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    if (!viewport || !active) return
    // 搜索结果只有这一层是滚动宿主；直接调整它的 scrollTop，避免 scrollIntoView
    // 把页面背景或弹窗外层一起带走，也便于键盘跨分页后稳定保持活动项可见。
    const viewportRect = viewport.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    // offsetTop 属于弹窗定位祖先，不属于结果滚动区；用真实矩形差量才能在向上返回首项时正确归零。
    if (activeRect.top < viewportRect.top) viewport.scrollTop += activeRect.top - viewportRect.top
    else if (activeRect.bottom > viewportRect.bottom) viewport.scrollTop += activeRect.bottom - viewportRect.bottom
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
        <div className="global-search-filters" aria-label="搜索筛选">
          <label>范围
            <select aria-label="搜索范围" value={scope} onChange={(event) => setScope(event.target.value as GlobalSearchScope)}>
              <option value="all">全部内容</option>
              <option value="title">仅标题</option>
              <option value="body">仅正文</option>
            </select>
          </label>
          <label>标签
            <select aria-label="筛选标签" value={tag} onChange={(event) => setTag(event.target.value)}>
              <option value="">全部标签</option>
              {tags.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>目录
            <select aria-label="筛选目录" value={folder} onChange={(event) => setFolder(event.target.value)}>
              <option value="">全部目录</option>
              <option value={ROOT_FOLDER_FILTER}>根目录</option>
              {folders.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <div className="global-search-summary" role="status">
          {searching ? <><LoaderCircle className="animate-spin" />正在搜索正文…</> : normalizedQuery || tag || folder ? `找到 ${matches.length} 篇，已显示 ${results.length} 篇` : "最近更新"}
        </div>
        <div className="global-search-results" data-search-scroll-viewport ref={resultsRef}>
          {results.length === 0 ? (
            <p className="global-search-empty">
              <FileSearch />
              {searching ? "正在查找，请稍候…" : normalizedQuery || tag || folder ? "没有找到匹配的笔记" : "最近更新的笔记会显示在这里"}
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
        </div>
        <div className="global-search-help">{scope === "body" ? "正文范围包含已缓存与当前打开的正文 · " : ""}↑↓ 选择 · Enter 打开 · Esc 关闭</div>
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
