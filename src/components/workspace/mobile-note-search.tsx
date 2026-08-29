import { useEffect, useRef, useState, type RefObject } from "react"
import { Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"

type MobileNoteSearchProps = {
  inputRef?: RefObject<HTMLInputElement | null>
  onClear?: () => void
  onSearch: (query: string) => void
  placeholder: string
  value: string
}

export function MobileNoteSearch({
  inputRef,
  onClear,
  onSearch,
  placeholder,
  value,
}: MobileNoteSearchProps) {
  const [draft, setDraft] = useState(value)
  const composingRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const confirmSearch = (input: HTMLInputElement) => {
    const query = draft.trim()
    setDraft(query)
    onSearch(query)
    input.blur()
  }
  const clearSearch = () => {
    setDraft("")
    if (onClear) onClear()
    else onSearch("")
    searchInputRef.current?.blur()
  }

  return (
    <div className="note-search-wrap">
      <Search />
      <Input
        aria-label="搜索笔记"
        enterKeyHint="search"
        onChange={(event) => setDraft(event.target.value)}
        onCompositionEnd={() => { composingRef.current = false }}
        onCompositionStart={() => { composingRef.current = true }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || composingRef.current || event.nativeEvent.isComposing) return
          // 中文输入法第一次回车只负责上屏候选词；真正的“搜索”键才提交并收起键盘。
          event.preventDefault()
          confirmSearch(event.currentTarget)
        }}
        placeholder={placeholder}
        ref={(input) => {
          searchInputRef.current = input
          if (inputRef) inputRef.current = input
        }}
        type="text"
        value={draft}
      />
      {draft ? (
        <button aria-label="清空搜索" className="note-search-clear" onClick={clearSearch} type="button">
          <X />
        </button>
      ) : null}
    </div>
  )
}
