// 手机上选中文字后点别处应当收起选区，但这一下点击 iOS 会自己吞掉，CodeMirror 等不到，
// 只能在编辑器外层按指针轨迹判断。滑动看正文、拖选择手柄、长按选词都不能被误判成点击。

export type PointerOrigin = { at: number; x: number; y: number }

export type PointerEnd = { at: number; x: number; y: number }

// 与 use-long-press 取同一个位移阈值：超过就当成滑动而不是点按。
const MOVE_TOLERANCE = 10
// iOS 长按选词约 500ms 触发，上限留在 400ms，抬手时才不会把刚选中的词又取消掉。
const TAP_MAX_DURATION = 400

export function isSelectionDismissTap(origin: PointerOrigin | null, end: PointerEnd) {
  if (!origin) return false
  if (Math.hypot(end.x - origin.x, end.y - origin.y) > MOVE_TOLERANCE) return false
  return end.at - origin.at <= TAP_MAX_DURATION
}

// 工具栏、查找/替换与任务控件操作时保留正文选区；
// iOS 在 pointerup 修改原生选区会吞掉随后这一次 click，让关闭查找需要点两次。
export function keepsSelectionAlive(target: Element | null) {
  return target?.closest(".selection-action-bar, .formatting-toolbar, .editor-find-bar, .cm-md-task-control, .task-checkbox") != null
}
