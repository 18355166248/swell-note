// 搜索命中定位：把标题 / 摘要按查询词切成片段，供列表行渲染时给命中处套 <mark>。
// 不区分大小写；query 为空或没命中时整段原样返回，调用方据此判断要不要展示摘录。

export type HighlightSegment = { matched: boolean; text: string }

export function splitByQuery(text: string, query: string): HighlightSegment[] {
  const needle = query.trim()
  if (!needle || !text) return [{ matched: false, text }]

  const lowerText = text.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  const segments: HighlightSegment[] = []
  let cursor = 0
  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerNeedle, cursor)
    if (index === -1) {
      segments.push({ matched: false, text: text.slice(cursor) })
      break
    }
    if (index > cursor) segments.push({ matched: false, text: text.slice(cursor, index) })
    segments.push({ matched: true, text: text.slice(index, index + needle.length) })
    cursor = index + needle.length
  }
  return segments
}
