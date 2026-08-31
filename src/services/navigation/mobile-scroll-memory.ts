export type ScrollPositionMemory = {
  get(key: string): number
  set(key: string, scrollTop: number): void
}

export function createScrollPositionMemory(maxEntries = 200): ScrollPositionMemory {
  const positions = new Map<string, number>()
  return {
    get(key) {
      const value = positions.get(key) ?? 0
      if (positions.has(key)) {
        positions.delete(key)
        positions.set(key, value)
      }
      return value
    },
    set(key, scrollTop) {
      positions.delete(key)
      positions.set(key, Math.max(0, scrollTop))
      // 目录浏览历史只服务于本次会话；限制容量避免大型 Vault 长时间使用后持续增长。
      while (positions.size > maxEntries) {
        const oldestKey = positions.keys().next().value
        if (typeof oldestKey !== "string") break
        positions.delete(oldestKey)
      }
    },
  }
}

export const mobileLibraryScrollMemory = createScrollPositionMemory()
export const mobileNoteListScrollMemory = createScrollPositionMemory()
// 正文阅读位置同时服务手机与宽屏；按缓存和笔记组成的键隔离不同笔记库中的同名文件。
export const noteEditorScrollMemory = createScrollPositionMemory()
