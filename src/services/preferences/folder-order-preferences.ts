const FOLDER_ORDER_KEY = "swell-note:folder-order:v1"

// 系统“根目录”是虚拟节点：固定显示在最前，不参与拖动，也不作为投放目标写入排序偏好。
export const SYSTEM_ROOT_FOLDER_PATH = "根目录"

type FolderOrderStore = Record<string, string[]>

function readFolderOrders(): FolderOrderStore {
  try {
    const raw = window.localStorage.getItem(FOLDER_ORDER_KEY)
    if (!raw) return {}
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).map(([key, paths]) => [
      key,
      Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : [],
    ]))
  } catch {
    return {}
  }
}

export function loadFolderOrder(libraryKey: string) {
  return readFolderOrders()[libraryKey] ?? []
}

export function saveFolderOrder(libraryKey: string, paths: string[]) {
  try {
    // 每个笔记库独立保存目录顺序，避免切换 Vault 后把另一个库的路径顺序套过来。
    window.localStorage.setItem(FOLDER_ORDER_KEY, JSON.stringify({
      ...readFolderOrders(),
      [libraryKey]: [...new Set(paths)],
    }))
  } catch {
    // 系统禁止本地存储时仍保留当前会话内的排序，不阻断目录管理。
  }
}

export function applyFolderOrder<T extends { path: string }>(folders: T[], order: string[]) {
  const rank = new Map(order.map((path, index) => [path, index]))
  return folders
    .map((folder, originalIndex) => ({ folder, originalIndex }))
    .sort((left, right) => {
      const leftRank = rank.get(left.folder.path)
      const rightRank = rank.get(right.folder.path)
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
      if (leftRank !== undefined) return -1
      if (rightRank !== undefined) return 1
      return left.originalIndex - right.originalIndex
    })
    .map(({ folder }) => folder)
}

// 在完整目录树（前序排列）上应用顶层顺序：只交换 depth 0 的块，子树随父目录整体移动，
// 块内部的子目录相对顺序与前序连续性保持不变。系统根目录固定最前，不进入排序结果。
export function applyFolderOrderToTree<T extends { depth: number; path: string }>(folders: T[], order: string[]) {
  const blocks: { root: T; subtree: T[] }[] = []
  for (const folder of folders) {
    if (folder.depth === 0 || blocks.length === 0) blocks.push({ root: folder, subtree: [folder] })
    else blocks[blocks.length - 1].subtree.push(folder)
  }
  const systemRootBlock = blocks.find((block) => block.root.path === SYSTEM_ROOT_FOLDER_PATH)
  const regularBlocks = systemRootBlock ? blocks.filter((block) => block !== systemRootBlock) : blocks
  const blockByPath = new Map(regularBlocks.map((block) => [block.root.path, block]))
  // 已排序目录在前，新发现目录保持原始相对顺序追加在后（applyFolderOrder 的既有语义）。
  const orderedBlocks = applyFolderOrder(regularBlocks.map((block) => block.root), order)
    .map((root) => blockByPath.get(root.path)!)
  return (systemRootBlock ? [systemRootBlock, ...orderedBlocks] : orderedBlocks)
    .flatMap((block) => block.subtree)
}

// 把拖放落点换算成新的顶层路径列表；取消、无效目标或原地放置时返回 null，调用方据此跳过写盘。
export function reorderTopLevelPaths(paths: string[], activePath: string, overPath: string) {
  if (activePath === overPath) return null
  const previousIndex = paths.indexOf(activePath)
  const nextIndex = paths.indexOf(overPath)
  if (previousIndex < 0 || nextIndex < 0) return null
  const next = [...paths]
  next.splice(nextIndex, 0, ...next.splice(previousIndex, 1))
  return next
}

// 重命名确认成功后迁移偏好中的对应路径（含历史遗留的子路径前缀），保持原位置；
// 未命中任何条目时返回原数组引用，调用方据此保留原顺序、不写盘。
export function moveFolderOrderPath(order: string[], fromPath: string, toPath: string) {
  let changed = false
  const next = order.map((path) => {
    if (path === fromPath) {
      changed = true
      return toPath
    }
    if (path.startsWith(`${fromPath} / `)) {
      changed = true
      return `${toPath}${path.slice(fromPath.length)}`
    }
    return path
  })
  return changed ? next : order
}
