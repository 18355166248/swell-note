const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th, dt, dd"
const SKIP = "button, input, textarea, script, style, [aria-hidden='true'], .markdown-code-block-header, .markdown-preview-pending"

export function collectPreviewMatches(root: HTMLElement, query: string): Range[] {
  if (!query) return []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const segments: { node: Text; start: number; end: number }[] = []
  let text = ""
  let previousBlock: Element | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.parentElement || node.parentElement.closest(SKIP)) continue
    const block = node.parentElement.closest(BLOCKS)
    // 行内加粗 / 链接会拆成多个文本节点，但两个独立段落不能拼成一次匹配。
    if (segments.length && block !== previousBlock) text += "\n"
    previousBlock = block
    const start = text.length
    text += node.data
    segments.push({ node, start, end: text.length })
  }
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu")
  const ranges: Range[] = []
  for (const match of text.matchAll(pattern)) {
    const from = match.index
    const to = from + match[0].length
    const first = segments.find((item) => item.end > from)
    const last = segments.find((item) => item.end >= to && item.start < to)
    if (!first || !last) continue
    const range = document.createRange()
    range.setStart(first.node, from - first.start)
    range.setEnd(last.node, to - last.start)
    ranges.push(range)
  }
  return ranges
}

export class PreviewSearch {
  private query = ""
  private index = -1
  private range: Range | null = null
  private highlights: Highlight | null = null
  private currentHighlight: Highlight | null = null

  clear() {
    if (typeof CSS !== "undefined" && CSS.highlights) {
      if (CSS.highlights.get("swell-find") === this.highlights) CSS.highlights.delete("swell-find")
      if (CSS.highlights.get("swell-find-current") === this.currentHighlight) CSS.highlights.delete("swell-find-current")
    }
    const selection = window.getSelection()
    if (this.range && selection?.rangeCount && selection.getRangeAt(0).compareBoundaryPoints(Range.START_TO_START, this.range) === 0
      && selection.getRangeAt(0).compareBoundaryPoints(Range.END_TO_END, this.range) === 0) selection.removeAllRanges()
    this.range = null
    this.highlights = this.currentHighlight = null
  }

  find(root: HTMLElement | null, query: string, direction: "next" | "previous" = "next", fromStart = false, keepCurrent = false) {
    const ranges = root ? collectPreviewMatches(root, query) : []
    this.clear()
    if (!ranges.length) { this.query = query; this.index = -1; return { current: 0, total: 0 } }
    if (fromStart || query !== this.query || this.index < 0) this.index = direction === "next" ? 0 : ranges.length - 1
    else if (!keepCurrent) this.index = (this.index + (direction === "next" ? 1 : -1) + ranges.length) % ranges.length
    this.index = Math.min(this.index, ranges.length - 1)
    this.query = query
    const range = ranges[this.index]
    // 不修改 React 管理的正文 DOM，也不抢查找输入框的焦点；旧 WebView 用原生选区兜底。
    if (typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights) {
      this.highlights = new Highlight(...ranges)
      this.currentHighlight = new Highlight(range)
      this.currentHighlight.priority = 1
      CSS.highlights.set("swell-find", this.highlights)
      CSS.highlights.set("swell-find-current", this.currentHighlight)
    } else {
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      this.range = range
    }
    const viewport = root?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (viewport && typeof range.getBoundingClientRect === "function") {
      const bounds = range.getBoundingClientRect()
      const visible = viewport.getBoundingClientRect()
      if (bounds.top < visible.top + 16 || bounds.bottom > visible.bottom - 16) viewport.scrollTop += bounds.top - visible.top - visible.height / 3
    }
    return { current: this.index + 1, total: ranges.length }
  }
}
