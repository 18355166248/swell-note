import type { GlobalSearchScope } from "./global-search-filter"

export type SavedSearch = {
  name: string
  query: string
  scope: GlobalSearchScope
  tag: string
  folder: string
  updatedDays: "any" | "7" | "30" | "90"
  starredOnly: boolean
}

const MAX_SAVED_SEARCHES = 20
const storageKey = (cacheId: string) => `swell-note:saved-searches:${encodeURIComponent(cacheId)}`

function isSavedSearch(value: unknown): value is SavedSearch {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  return typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 40
    && typeof item.query === "string" && item.query.length <= 500
    && (item.scope === "all" || item.scope === "title" || item.scope === "body")
    && typeof item.tag === "string" && typeof item.folder === "string"
    && (item.updatedDays === "any" || item.updatedDays === "7" || item.updatedDays === "30" || item.updatedDays === "90")
    && typeof item.starredOnly === "boolean"
}

export function readSavedSearches(cacheId: string, storage: Storage = localStorage): SavedSearch[] {
  const raw = storage.getItem(storageKey(cacheId))
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) return []
    const items = (parsed as { items?: unknown }).items
    return Array.isArray(items) ? items.filter(isSavedSearch).slice(0, MAX_SAVED_SEARCHES) : []
  } catch { return [] }
}

export function saveSavedSearch(cacheId: string, entry: SavedSearch, storage: Storage = localStorage) {
  const name = entry.name.trim()
  if (!isSavedSearch({ ...entry, name })) throw new Error("搜索名称或筛选条件无效")
  const current = readSavedSearches(cacheId, storage)
  if (current.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("已有同名搜索，请换一个名称")
  if (current.length >= MAX_SAVED_SEARCHES) throw new Error(`每个笔记库最多保存 ${MAX_SAVED_SEARCHES} 个搜索`)
  const next = [...current, { ...entry, name }]
  // 搜索条件只保存在当前设备，按库隔离，不写入笔记正文或同步目录。
  storage.setItem(storageKey(cacheId), JSON.stringify({ version: 1, items: next }))
  return next
}

export function deleteSavedSearch(cacheId: string, name: string, storage: Storage = localStorage) {
  const next = readSavedSearches(cacheId, storage).filter((item) => item.name !== name)
  storage.setItem(storageKey(cacheId), JSON.stringify({ version: 1, items: next }))
  return next
}
