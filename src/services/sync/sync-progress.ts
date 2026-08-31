export type SyncProgress = {
  automatic?: boolean
  completed: number
  currentLabel: string
  phase: "attachments" | "notes" | "refreshing"
  total: number
}

export function shouldShowFloatingSyncProgress(progress: SyncProgress | null, mobileLayout: boolean) {
  // 手机后台同步已有标题栏旋转状态；重复悬浮进度会遮挡正文，手动同步仍保留可取消的完整反馈。
  return Boolean(progress && !(mobileLayout && progress.automatic))
}

export function getSyncProgressPercent(progress: SyncProgress) {
  if (progress.phase === "refreshing") return 100
  if (progress.total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((progress.completed / progress.total) * 100)))
}

export function getSyncProgressDescription(progress: SyncProgress) {
  if (progress.phase === "refreshing") return "正在刷新云端目录"
  if (progress.total <= 0) return "正在检查待同步内容"
  return `已处理 ${Math.min(progress.completed, progress.total)}/${progress.total} 项；取消会在当前请求完成后生效`
}
