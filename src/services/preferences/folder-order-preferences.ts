const FOLDER_ORDER_KEY = "swell-note:folder-order:v1"

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
