// 全局快捷键挂在 document 上，谁持有焦点都会收到。这里判定它们该不该出手：
// 焦点落在正文以外（点过侧边栏、按钮，或刚切换完视图）时，⌘/Ctrl+A 会走浏览器的整页全选，
// 把侧边栏、笔记列表、工具栏文案一起选进去；而弹窗开着时，快捷键更不该去动它背后的笔记。

export function isTextEntryElement(element: Element | null) {
  if (!element) return false
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") return true
  // CodeMirror 可编辑时正文就是 contenteditable，它自己的全选范围本来就只有文档。
  return element.closest("[contenteditable='true']") != null
}

// 重命名、删除确认、版本历史这些都是模态弹窗：它开着的时候按 ⌘E，
// 背后的笔记会照样在编辑与阅读之间翻一次，关掉弹窗才发现视图变了。
export function hasOpenModal() {
  return document.querySelector("[data-slot=\"dialog-content\"]") != null
}

export function selectElementContents(element: Element | null) {
  const selection = window.getSelection()
  if (!element || !selection) return false
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}
