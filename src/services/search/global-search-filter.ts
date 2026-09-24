import type { Note } from "@/types/note"

export type GlobalSearchScope = "all" | "title" | "body"

export type GlobalSearchFilters = {
  excludedTagTerms?: readonly string[]
  excludedTitleTerms?: readonly string[]
  folder: string
  query: string
  scope: GlobalSearchScope
  starredOnly?: boolean
  tag: string
  tagTerms?: readonly string[]
  titleTerms?: readonly string[]
  updatedAfter?: number
}

export const ROOT_FOLDER_FILTER = "__root__"

export function parseGlobalSearchQuery(input: string) {
  const tokens: string[] = []
  let token = ""
  let quoted = false
  for (const character of input.trim()) {
    if (character === '"') {
      quoted = !quoted
    } else if (/\s/.test(character) && !quoted) {
      if (token) tokens.push(token)
      token = ""
    } else {
      token += character
    }
  }
  if (token) tokens.push(token)

  const text: string[] = []
  const titleTerms: string[] = []
  const tagTerms: string[] = []
  const excludedTitleTerms: string[] = []
  const excludedTagTerms: string[] = []
  for (const value of tokens) {
    const operator = /^(-?)(title|tag):(.+)$/i.exec(value)
    if (!operator) text.push(value)
    else if (operator[2].toLocaleLowerCase() === "title") (operator[1] ? excludedTitleTerms : titleTerms).push(operator[3])
    else (operator[1] ? excludedTagTerms : tagTerms).push(operator[3])
  }
  return { excludedTagTerms, excludedTitleTerms, query: text.join(" ").trim(), tagTerms, titleTerms }
}

export function matchesGlobalSearchFilters(
  note: Note,
  filters: GlobalSearchFilters,
  indexedPaths: ReadonlySet<string> | null,
) {
  const { excludedTagTerms = [], excludedTitleTerms = [], folder, query, scope, starredOnly, tag, tagTerms = [], titleTerms = [], updatedAfter } = filters
  if (starredOnly && !note.starred) return false
  // 旧笔记若没有可靠修改时间，不应被误算进“最近更新”。
  if (updatedAfter !== undefined && (note.modifiedAt === undefined || note.modifiedAt < updatedAfter)) return false
  if (tag && !note.tags?.some((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase())) return false
  // 查询语法与筛选控件叠加；多个限定词都需满足，避免在大库中把条件误当成正文关键词。
  if (tagTerms.some((term) => !note.tags?.some((candidate) => candidate.toLocaleLowerCase() === term.toLocaleLowerCase()))) return false
  if (titleTerms.some((term) => !note.title.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return false
  if (excludedTagTerms.some((term) => note.tags?.some((candidate) => candidate.toLocaleLowerCase() === term.toLocaleLowerCase()))) return false
  if (excludedTitleTerms.some((term) => note.title.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return false
  if (folder) {
    const noteFolder = note.folder && note.folder !== "根目录" ? note.folder : ""
    if (folder === ROOT_FOLDER_FILTER ? Boolean(noteFolder) : noteFolder !== folder && !noteFolder.startsWith(`${folder} / `)) return false
  }
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  const titleMatch = note.title.toLocaleLowerCase().includes(needle)
  if (scope === "title") return titleMatch

  // 已加载的正文是编辑现场的事实来源；索引可能还保留编辑前的内容，不能据此产生误命中。
  const bodyMatch = note.contentLoaded
    ? note.content.toLocaleLowerCase().includes(needle)
    : note.syncStatus === "modified" || note.syncStatus === "conflict"
      ? false
      : Boolean(note.remotePath && indexedPaths?.has(note.remotePath))
  if (scope === "body") return bodyMatch
  return titleMatch
    || note.preview.toLocaleLowerCase().includes(needle)
    || Boolean(note.tags?.some((candidate) => candidate.toLocaleLowerCase().includes(needle)))
    || bodyMatch
    || Boolean(!note.contentLoaded && note.syncStatus !== "modified" && note.syncStatus !== "conflict"
      && note.searchText?.includes(needle))
}
