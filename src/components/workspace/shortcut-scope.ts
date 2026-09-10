// 全局快捷键挂在 document 上，谁持有焦点都会收到。这里判定它们该不该出手：
// 焦点落在正文以外（点过侧边栏、按钮，或刚切换完视图）时，⌘/Ctrl+A 会走浏览器的整页全选，
// 把侧边栏、笔记列表、工具栏文案一起选进去；而弹窗开着时，快捷键更不该去动它背后的笔记。

import { matchesMobileLayout } from "@/services/navigation/mobile-layout"

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

// 捕获阶段只保留搜索专用组合，其余快捷键遵循编辑器已经处理的结果。
export function registerDesktopShortcuts(options: {
  canCreateNote: boolean
  isCreatingNote: boolean
  isRefreshingVault: boolean
  onCreateNote: () => void
  onRefreshVault: () => void
  onOpenSearch: () => void
}) {
  const handleDesktopShortcut = (event: KeyboardEvent) => {
    // 正文已处理的链接快捷键不能再触发全局搜索；组合输入也不执行工作区动作。
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
    if (matchesMobileLayout()) return
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return
    // 弹窗开着时这些动作都会打断当前操作：抢走焦点、在背后新建笔记或触发同步。
    if (hasOpenModal()) return
    const key = event.key.toLocaleLowerCase()
    if (key === "k") {
      if (!event.shiftKey && isTextEntryElement(event.target instanceof Element ? event.target : null)) return
      event.preventDefault()
      options.onOpenSearch()
      return
    }
    if (key === "n" && !event.shiftKey && options.canCreateNote && !options.isCreatingNote) {
      event.preventDefault()
      options.onCreateNote()
      return
    }
    if (key === "s" && event.shiftKey && !options.isRefreshingVault) {
      event.preventDefault()
      options.onRefreshVault()
    }
  }
  // 桌面端高频动作统一由工作区分发，避免输入框和编辑器各自重复注册全局快捷键。
  // CodeMirror 默认把 Mod+Shift+K 绑定为删行；全局搜索专用组合先在捕获阶段接管，避免修改正文。
  const captureSearchShortcut = (event: KeyboardEvent) => {
    if (event.shiftKey && event.key.toLocaleLowerCase() === "k") handleDesktopShortcut(event)
  }
  document.addEventListener("keydown", captureSearchShortcut, true)
  document.addEventListener("keydown", handleDesktopShortcut)
  return () => {
    document.removeEventListener("keydown", captureSearchShortcut, true)
    document.removeEventListener("keydown", handleDesktopShortcut)
  }
}
