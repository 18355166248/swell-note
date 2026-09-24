import { useEffect, useId, useMemo, useRef, useState } from "react"
import { CircleX, FileSearch, LoaderCircle, Search, X } from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { HighlightedText, useSearchMatch } from "@/components/workspace/note-search-match"
import { searchCachedNoteDocumentBodyExclusions, searchCachedNoteDocuments } from "@/services/cache/vault-cache"
import { matchesGlobalSearchFilters, parseGlobalSearchQuery, ROOT_FOLDER_FILTER, type GlobalSearchScope } from "@/services/search/global-search-filter"
import { sortNotes } from "@/services/search/note-sort"
import { deleteSavedSearch, readSavedSearches, saveSavedSearch, type SavedSearch } from "@/services/search/saved-searches"
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
  const [updatedDays, setUpdatedDays] = useState<"any" | "7" | "30" | "90">("any")
  const [starredOnly, setStarredOnly] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [indexedMatch, setIndexedMatch] = useState<{ paths: Set<string>; requiredBodyPaths: Set<string>; excludedBodyPaths: Set<string>; cachedBodyPaths: Set<string>; key: string } | null>(null)
  const [indexErrorKey, setIndexErrorKey] = useState("")
  const [visibleCount, setVisibleCount] = useState(RESULT_LIMIT)
  const [completedQuery, setCompletedQuery] = useState("")
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [selectedSavedSearch, setSelectedSavedSearch] = useState("")
  const [savingSearch, setSavingSearch] = useState(false)
  const [savedSearchName, setSavedSearchName] = useState("")
  const [savedSearchError, setSavedSearchError] = useState("")
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
    setUpdatedDays("any")
    setStarredOnly(false)
    setActiveIndex(0)
    setIndexedMatch(null)
    setIndexErrorKey("")
    setSelectedSavedSearch("")
    setSavingSearch(false)
    setSavedSearchName("")
    try {
      setSavedSearches(cacheId ? readSavedSearches(cacheId) : [])
      setSavedSearchError("")
    } catch {
      setSavedSearches([])
      setSavedSearchError("无法读取当前设备保存的搜索")
    }
    // 弹窗打开动画与聚焦挤在同一帧时，部分浏览器会把焦点请求吞掉。
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [cacheId, open])

  const parsedQuery = useMemo(() => parseGlobalSearchQuery(query), [query])
  const normalizedQuery = parsedQuery.query.toLocaleLowerCase()
  const updatedAfter = useMemo(() => updatedDays === "any" ? undefined : Date.now() - Number(updatedDays) * 24 * 60 * 60 * 1000, [updatedDays, open])
  const excludedBodyTerms = useMemo(() => parsedQuery.excludedBodyTerms.map((term) => term.toLocaleLowerCase()), [parsedQuery])
  const hasFilters = Boolean(parsedQuery.bodyTerms.length || normalizedQuery || parsedQuery.titleTerms.length || parsedQuery.tagTerms.length || parsedQuery.excludedTitleTerms.length || parsedQuery.excludedTagTerms.length || excludedBodyTerms.length || tag || folder || updatedAfter !== undefined || starredOnly)
  const searchKey = `${cacheId}\u0000${scope}\u0000${normalizedQuery}\u0000${JSON.stringify([excludedBodyTerms, parsedQuery.bodyTerms])}`
  const tags = useMemo(() => [...new Set(notes.flatMap((note) => note.tags ?? []))]
    .sort((left, right) => left.localeCompare(right)), [notes])
  const folders = useMemo(() => [...new Set(notes.flatMap((note) => {
    if (!note.folder || note.folder === "根目录") return []
    const parts = note.folder.split(" / ")
    return parts.map((_, index) => parts.slice(0, index + 1).join(" / "))
  }))]
    .sort((left, right) => left.localeCompare(right)), [notes])

  useEffect(() => {
    if (!open || !cacheId || (!parsedQuery.bodyTerms.length && !excludedBodyTerms.length && (!normalizedQuery || scope === "title"))) {
      setIndexedMatch(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      // 全局筛选统一以文档缓存为后备索引；原生 FTS 额外搜索路径且分词不同，会让范围筛选两端不一致。
      const limit = Math.max(5_000, notes.length)
      // 正文排除一次扫描缓存，同时记录实际存在的文档；失败时不声称未加载笔记满足排除条件。
      const positive = normalizedQuery && scope !== "title"
        ? searchCachedNoteDocuments(cacheId, normalizedQuery, limit, scope === "body" ? "body" : "all")
        : Promise.resolve([])
      const excluded = excludedBodyTerms.length
        ? searchCachedNoteDocumentBodyExclusions(cacheId, excludedBodyTerms)
        : Promise.resolve({ cachedPaths: [], excludedPaths: [] })
      const required = Promise.all(parsedQuery.bodyTerms.map((term) => searchCachedNoteDocuments(cacheId, term.toLocaleLowerCase(), limit, "body")))
      void Promise.all([positive, excluded, required])
        .then(([paths, bodyExclusions, requiredMatches]) => {
          if (cancelled) return
          setIndexedMatch({ requiredBodyPaths: new Set(requiredMatches[0]?.filter((path) => requiredMatches.every((matches) => matches.includes(path))) ?? []), paths: new Set(paths), excludedBodyPaths: new Set(bodyExclusions.excludedPaths), cachedBodyPaths: new Set(bodyExclusions.cachedPaths), key: searchKey })
          setIndexErrorKey("")
        })
        .catch(() => {
          if (cancelled) return
          // 已加载笔记仍能本地匹配，但缓存正文缺席时不能把结果称作完整命中集。
          setIndexedMatch(null)
          setIndexErrorKey(searchKey)
        })
        .finally(() => { if (!cancelled) setCompletedQuery(searchKey) })
    }, 120)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [cacheId, excludedBodyTerms, normalizedQuery, open, notes, scope, searchKey, parsedQuery.bodyTerms])

  const indexedPaths = indexedMatch?.key === searchKey ? indexedMatch.paths : null
  const excludedBodyPaths = indexedMatch?.key === searchKey ? indexedMatch.excludedBodyPaths : null
  const cachedBodyPaths = indexedMatch?.key === searchKey ? indexedMatch.cachedBodyPaths : null

  const requiredBodyPaths = indexedMatch?.key === searchKey ? indexedMatch.requiredBodyPaths : null
  const needsIndex = Boolean(parsedQuery.bodyTerms.length || (normalizedQuery && scope !== "title") || excludedBodyTerms.length)
  const searching = Boolean(open && cacheId && needsIndex && completedQuery !== searchKey)
  const indexUnavailable = Boolean(open && indexErrorKey === searchKey && needsIndex)
  const matches = useMemo(() => {
    if (!hasFilters) return sortNotes(notes, "updated-desc", { pinnedFirst: false }).slice(0, RECENT_LIMIT)
    const matched = notes.filter((note) => matchesGlobalSearchFilters(note, {
      bodyTerms: parsedQuery.bodyTerms, excludedBodyTerms, excludedTagTerms: parsedQuery.excludedTagTerms, excludedTitleTerms: parsedQuery.excludedTitleTerms,
      folder, query: normalizedQuery, scope, starredOnly, tag, tagTerms: parsedQuery.tagTerms, titleTerms: parsedQuery.titleTerms, updatedAfter,
    }, indexedPaths, excludedBodyPaths, cachedBodyPaths, requiredBodyPaths))
    return sortNotes(matched, "updated-desc")
  }, [requiredBodyPaths, cachedBodyPaths, excludedBodyPaths, excludedBodyTerms, folder, hasFilters, indexedPaths, normalizedQuery, notes, parsedQuery, scope, starredOnly, tag, updatedAfter])

  const results = matches.slice(0, visibleCount)
  useEffect(() => { setActiveIndex(0); setVisibleCount(RESULT_LIMIT) }, [searchKey, tag, folder, updatedDays, starredOnly, open, cacheId])
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
    onSelectNote(note, parsedQuery.query || parsedQuery.bodyTerms[0] || parsedQuery.titleTerms[0] || "")
  }

  const loadSavedSearch = (name: string) => {
    const saved = savedSearches.find((item) => item.name === name)
    setSelectedSavedSearch(saved ? name : "")
    if (!saved) return
    setQuery(saved.query)
    setScope(saved.scope)
    setTag(saved.tag)
    setFolder(saved.folder)
    setUpdatedDays(saved.updatedDays)
    setStarredOnly(saved.starredOnly)
    setSavedSearchError("")
    inputRef.current?.focus()
  }

  const persistSearch = () => {
    if (!cacheId) return
    try {
      const next = saveSavedSearch(cacheId, { name: savedSearchName, query, scope, tag, folder, updatedDays, starredOnly })
      setSavedSearches(next)
      setSelectedSavedSearch(savedSearchName.trim())
      setSavingSearch(false)
      setSavedSearchName("")
      setSavedSearchError("")
    } catch (error) {
      setSavedSearchError(error instanceof Error ? error.message : "保存搜索失败")
    }
  }

  const removeSavedSearch = () => {
    if (!cacheId || !selectedSavedSearch) return
    try {
      setSavedSearches(deleteSavedSearch(cacheId, selectedSavedSearch))
      setSelectedSavedSearch("")
      setSavedSearchError("")
    } catch {
      setSavedSearchError("删除搜索失败，请检查当前设备的存储空间")
    }
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
            onChange={(event) => { setQuery(event.target.value); setSelectedSavedSearch("") }}
            placeholder="搜索所有笔记的标题、标签与正文"
            ref={inputRef}
            value={query}
          />
          {query && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => { setQuery(""); setSelectedSavedSearch(""); inputRef.current?.focus() }}><CircleX /></button>}
          <button type="button" aria-label="关闭全局搜索" title="关闭（Esc）" onClick={() => onOpenChange(false)}><X /></button>
        </div>
        <div className="global-search-filters" aria-label="搜索筛选">
          <label>范围
            <select aria-label="搜索范围" value={scope} onChange={(event) => { setScope(event.target.value as GlobalSearchScope); setSelectedSavedSearch("") }}>
              <option value="all">全部内容</option>
              <option value="title">仅标题</option>
              <option value="body">仅正文</option>
            </select>
          </label>
          <label>标签
            <select aria-label="筛选标签" value={tag} onChange={(event) => { setTag(event.target.value); setSelectedSavedSearch("") }}>
              <option value="">全部标签</option>
              {tag && !tags.includes(tag) && <option value={tag}>{tag}（当前无笔记）</option>}
              {tags.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>目录
            <select aria-label="筛选目录" value={folder} onChange={(event) => { setFolder(event.target.value); setSelectedSavedSearch("") }}>
              <option value="">全部目录</option>
              <option value={ROOT_FOLDER_FILTER}>根目录</option>
              {folder && folder !== ROOT_FOLDER_FILTER && !folders.includes(folder) && <option value={folder}>{folder}（当前无笔记）</option>}
              {folders.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>更新
            <select aria-label="筛选更新时间" value={updatedDays} onChange={(event) => { setUpdatedDays(event.target.value as typeof updatedDays); setSelectedSavedSearch("") }}>
              <option value="any">不限时间</option>
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
            </select>
          </label>
          <label>状态
            <select aria-label="筛选收藏状态" value={starredOnly ? "starred" : "all"} onChange={(event) => { setStarredOnly(event.target.value === "starred"); setSelectedSavedSearch("") }}>
              <option value="all">全部笔记</option>
              <option value="starred">仅收藏</option>
            </select>
          </label>
        </div>
        {cacheId && <div className="global-search-saved">
          <select aria-label="已保存搜索" value={selectedSavedSearch} onChange={(event) => loadSavedSearch(event.target.value)}>
            <option value="">已保存搜索</option>
            {savedSearches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
          {savingSearch ? <form onSubmit={(event) => { event.preventDefault(); persistSearch() }}>
            <input aria-label="搜索名称" autoFocus maxLength={40} onChange={(event) => setSavedSearchName(event.target.value)} placeholder="给搜索命名" value={savedSearchName} />
            <button type="submit">确定</button>
            <button type="button" onClick={() => { setSavingSearch(false); setSavedSearchError("") }}>取消</button>
          </form> : <button disabled={!hasFilters} onClick={() => { setSavingSearch(true); setSavedSearchError("") }} type="button">保存当前搜索</button>}
          {selectedSavedSearch && <button aria-label="删除已保存搜索" onClick={removeSavedSearch} type="button">删除</button>}
          {savedSearchError && <span role="alert">{savedSearchError}</span>}
        </div>}
        <div className="global-search-summary" role="status">
          {searching ? <><LoaderCircle className="animate-spin" />正在搜索正文…</> : hasFilters ? `找到 ${matches.length} 篇，已显示 ${results.length} 篇${indexUnavailable ? "；正文索引暂不可用，结果可能不完整" : ""}` : "最近更新"}
        </div>
        <div className="global-search-results" data-search-scroll-viewport ref={resultsRef}>
          {results.length === 0 ? (
            <p className="global-search-empty">
              <FileSearch />
              {searching ? "正在查找，请稍候…" : indexUnavailable ? "正文索引暂不可用，当前没有已加载笔记匹配" : hasFilters ? "没有找到匹配的笔记" : "最近更新的笔记会显示在这里"}
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
                  query={normalizedQuery || parsedQuery.bodyTerms[0] || parsedQuery.titleTerms[0] || ""}
                />
              ))}
            </ul>
          )}
          {results.length < matches.length && <button className="global-search-more" type="button" onClick={() => setVisibleCount((count) => count + RESULT_LIMIT)}>加载更多（剩余 {matches.length - results.length} 篇）</button>}
        </div>
        <div className="global-search-help">可用 title:、body:、tag: 筛选，-title:、-tag:、-body: 排除；带空格的值加引号 · 搜索保存在当前设备 · {scope === "body" ? "正文包含已缓存与当前打开的内容 · " : ""}↑↓ 选择 · Enter 打开 · Esc 关闭</div>
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
