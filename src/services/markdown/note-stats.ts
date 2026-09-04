// 正文字数与阅读时长的粗略估算，供编辑器状态栏展示。
// 口径：中日韩表意文字与假名逐字计数，其余按空白/标点分词；不剥离 Markdown 标记与 frontmatter，
// 数量级足够，也与多数编辑器的「字数」接近。

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g
const LATIN_WORD = /[0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ][0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ'-]*/g

export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0
  const latin = text.replace(CJK, " ").match(LATIN_WORD)?.length ?? 0
  return cjk + latin
}

// 约每分钟 300 字/词，向上取整，至少 1 分钟。
export function estimateReadingMinutes(text: string): number {
  const words = countWords(text)
  if (words === 0) return 0
  return Math.max(1, Math.round(words / 300))
}
