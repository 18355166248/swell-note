export type MobileRouteEntry = {
  key: string
  mountKey: string
  pathname: string
  search: string
  synthetic?: boolean
}

export type MobileRouteStack = {
  activeIndex: number
  entries: MobileRouteEntry[]
}

export type MobileNavigationAction = "POP" | "PUSH" | "REPLACE"

export function createMobileRouteEntry(key: string, pathname: string, search = ""): MobileRouteEntry {
  return { key, mountKey: key, pathname, search }
}

export function createMobileRouteStack(entry: MobileRouteEntry): MobileRouteStack {
  return { activeIndex: 0, entries: [entry] }
}

export function updateMobileRouteStack(
  stack: MobileRouteStack,
  entry: MobileRouteEntry,
  action: MobileNavigationAction,
): MobileRouteStack {
  const current = stack.entries[stack.activeIndex]
  if (current?.key === entry.key) {
    if (current.pathname === entry.pathname && current.search === entry.search) return stack
    const entries = [...stack.entries]
    entries[stack.activeIndex] = entry
    return { ...stack, entries }
  }

  if (action === "POP") {
    const activeIndex = stack.entries.findIndex((candidate) => candidate.key === entry.key)
    // 浏览器可从应用启动前的历史或被裁剪的远端 entry 返回；未知 key 以当前地址重建，
    // 页面仍然正确，只是不承诺恢复进程内已经不存在的 DOM。
    return activeIndex >= 0 ? { ...stack, activeIndex } : createMobileRouteStack(entry)
  }

  if (action === "REPLACE") {
    const previous = stack.entries[stack.activeIndex - 1]
    if (previous?.synthetic && previous.pathname === entry.pathname && previous.search === entry.search) {
      // 深链没有浏览器内的上一条记录，栈会垫一个语义 fallback。replace 到该 fallback 时
      // 直接提升已经挂载的底层 DOM，并把新的 history key 交给它。
      const restored = { ...previous, key: entry.key, synthetic: undefined }
      return { activeIndex: stack.activeIndex - 1, entries: [...stack.entries.slice(0, stack.activeIndex - 1), restored] }
    }
    const entries = [...stack.entries]
    // REPLACE（例如重命名后更新详情 URL）改变 history key，但页面仍是同一个 entry；
    // mountKey 保留 React 实例，CodeMirror 的选区、撤销栈与滚动不会被路由更新清空。
    entries[stack.activeIndex] = { ...entry, mountKey: current?.mountKey ?? entry.mountKey }
    return { activeIndex: stack.activeIndex, entries }
  }

  // 新 PUSH 会让浏览器丢弃当前点之后的 forward 分支，本地保活栈必须做同样裁剪。
  return {
    activeIndex: stack.activeIndex + 1,
    entries: [...stack.entries.slice(0, stack.activeIndex + 1), entry],
  }
}
