import { lazy, type ComponentType } from "react"

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await importer()
    } catch {
      // 网络刚恢复或发布切换时重试一次，仍失败则交给应用级错误边界提供刷新入口。
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      return importer()
    }
  })
}
