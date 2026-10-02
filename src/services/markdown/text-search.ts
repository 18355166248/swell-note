export type TextSearchRange = { from: number; to: number }
export type TextSearchOptions = { caseSensitive?: boolean; wholeWord?: boolean; range?: TextSearchRange }

export function findTextMatches(text: string, query: string, options: TextSearchOptions = {}): TextSearchRange[] {
  if (!query) return []
  const from = Math.max(0, options.range?.from ?? 0), to = Math.min(text.length, options.range?.to ?? text.length)
  if (from > to) return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.caseSensitive ? "gu" : "giu")
  const matches: TextSearchRange[] = []
  for (const match of text.matchAll(pattern)) {
    const start = match.index, end = start + match[0].length
    if (start < from || end > to) continue
    // Unicode 字母、数字、组合标记与下划线属于词内；中文和 emoji 不采用 ASCII 的 \b 判定。
    if (options.wholeWord && (/[\p{L}\p{N}\p{M}_]$/u.test(text.slice(Math.max(0, start - 2), start))
      || /^[\p{L}\p{N}\p{M}_]/u.test(text.slice(end, end + 2)))) continue
    matches.push({ from: start, to: end })
  }
  return matches
}
