import { markdownLanguage } from "@codemirror/lang-markdown"

// 只还原语法树中的换行标签，代码跨度和转义的 <br> 必须保留为用户原文。
// offset 同时从源码坐标映射到 textarea 坐标，点按换行后的文字不会错位。
export function tableCellEditorValue(source: string, offset = source.length) {
  const breaks: Array<{ from: number; to: number }> = []
  markdownLanguage.parser.parse(source).iterate({ enter(node) {
    if (node.name === "HTMLTag" && /^<br\s*\/?>$/i.test(source.slice(node.from, node.to))) breaks.push({ from: node.from, to: node.to })
  } })
  let text = "", previous = 0, removed = 0
  let caret = Math.max(0, Math.min(offset, source.length))
  for (const { from, to } of breaks) {
    text += source.slice(previous, from) + "\n"
    if (offset >= to) caret -= to - from - 1
    else if (offset > from) caret = from - removed + 1
    removed += to - from - 1
    previous = to
  }
  return { text: text + source.slice(previous), offset: caret }
}

export function atCellVerticalBoundary(input: HTMLTextAreaElement, direction: "up" | "down") {
  const caret = input.selectionStart
  // 无布局环境退回逻辑行判断；真实 textarea 还要区分列宽造成的软换行。
  if (!input.clientWidth) return direction === "up" ? !input.value.slice(0, caret).includes("\n") : !input.value.slice(caret).includes("\n")
  const mirror = document.createElement("div")
  const style = getComputedStyle(input)
  for (const property of ["font", "line-height", "letter-spacing", "text-align", "text-indent", "white-space", "overflow-wrap", "word-break", "tab-size", "padding", "direction"]) {
    mirror.style.setProperty(property, style.getPropertyValue(property))
  }
  Object.assign(mirror.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", width: `${input.clientWidth}px`, boxSizing: "border-box" })
  const first = document.createElement("span"), current = document.createElement("span"), last = document.createElement("span")
  // 零宽标记让空格、空行和文末换行都能测到光标所在的实际显示行。
  for (const marker of [first, current, last]) marker.textContent = "\u200b"
  mirror.append(first, document.createTextNode(input.value.slice(0, caret)), current, document.createTextNode(input.value.slice(caret)), last)
  document.body.append(mirror)
  try {
    const edge = direction === "up" ? first : last
    return Math.abs(current.getBoundingClientRect().top - edge.getBoundingClientRect().top) < 1
  } finally { mirror.remove() }
}
