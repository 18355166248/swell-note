export function resolveRouteNoteId(rawNoteId: string | undefined, candidateIds: Iterable<string>) {
  if (!rawNoteId) return ""
  const ids = candidateIds instanceof Set ? candidateIds : new Set(candidateIds)
  // React Router 通常已经解码参数；先精确匹配可保护文件名中合法的“%20”等字面内容。
  if (ids.has(rawNoteId)) return rawNoteId

  const normalizedRouteId = normalizeRouteNoteId(rawNoteId)
  for (const candidateId of ids) {
    // 旧版 WebDAV 缓存可能保存了百分号编码路径，而新扫描结果已经解码；返回真实候选 ID，避免同步时路由在两种表示间失配。
    if (normalizeRouteNoteId(candidateId) === normalizedRouteId) return candidateId
  }
  return rawNoteId
}

export function normalizeVaultPathIdentity(value: string) {
  // WebDAV 列表、旧缓存和路由可能分别保存编码路径或 Unicode 组合字符；只统一表示，不折叠大小写。
  try {
    return decodeURIComponent(value).replace(/\\/g, "/").replace(/\/{2,}/g, "/").normalize("NFC")
  } catch {
    return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").normalize("NFC")
  }
}

export function resolveStableVaultNoteId({
  adapterKind,
  filePath,
  previousNoteId,
}: {
  adapterKind: string
  filePath: string
  previousNoteId?: string
}) {
  // WebDAV 在不同响应中可能返回编码或解码路径；同一文件刷新时沿用旧 ID，避免详情和图片预览被当成新笔记重建。
  return previousNoteId ?? `${adapterKind}:${filePath}`
}

export function stableNoteRenderIdentity(noteId: string, remotePath?: string) {
  // 渲染身份只统一路径表示，不修改真实 noteId；既能稳定同步刷新，也能保证切换文件时重建编辑器。
  return normalizeVaultPathIdentity(remotePath ? `${noteId.split(":", 1)[0]}:${remotePath}` : noteId)
}

export function resolveRefreshedActiveNoteId({
  activeNoteId,
  availableIds,
  preserveContext,
  routeNoteId,
}: {
  activeNoteId: string
  availableIds: string[]
  preserveContext: boolean
  routeNoteId?: string
}) {
  if (!preserveContext) return availableIds[0] ?? ""

  if (routeNoteId) {
    const requestedId = resolveRouteNoteId(routeNoteId, availableIds)
    // 详情地址失效时保持空编辑区，不能先切到第一篇再由路由 effect 清空，否则每轮同步都会闪出无关正文。
    return availableIds.includes(requestedId) ? requestedId : ""
  }

  return availableIds.includes(activeNoteId) ? activeNoteId : availableIds[0] ?? ""
}

export function shouldAutoLoadRouteNote({
  contentLoaded,
  hasLoadError,
  isLoading,
}: {
  contentLoaded: boolean
  hasLoadError: boolean
  isLoading: boolean
}) {
  // 路由首次命中时自动读取一次；失败后必须等待用户重试或下一次成功刷新，避免后台索引更新触发读取风暴。
  return !contentLoaded && !hasLoadError && !isLoading
}

function normalizeRouteNoteId(value: string) {
  return normalizeVaultPathIdentity(value)
}
