import { useCallback, useEffect, useRef, useState } from "react"

import { loadFolderOrder, moveFolderOrderPath, saveFolderOrder } from "./folder-order-preferences"

type FolderOrdersByLibrary = Record<string, string[]>

// 文件夹顺序的共享状态：桌面侧栏与移动笔记库读同一份，避免两个布局各维护一份。
// 状态挂在布局切换之上的 App 层，即使 localStorage 不可用，会话内顺序也不会因切换布局而丢失。
export function useFolderOrder(libraryKey: string) {
  // 每个笔记库各自保存一份顺序，当前库只是这张表的视图；这样异步操作完成时
  // 仍能写回发起库的那一份，而不会落到切换后的当前库上。
  const [ordersByLibrary, setOrdersByLibrary] = useState<FolderOrdersByLibrary>(() => ({
    [libraryKey]: loadFolderOrder(libraryKey),
  }))
  // ref 同步镜像最新状态：回调先基于 ref 算好新值再整体 setState，
  // updater 只接收计算结果（保持纯净），读取存储、写盘等副作用全部在 setState 之外执行。
  const ordersRef = useRef(ordersByLibrary)

  // 切换笔记库时把该库独立保存的顺序载入内存；libraryKey 由稳定缓存标识派生，不会把顺序套到别的库。
  useEffect(() => {
    if (libraryKey in ordersRef.current) return
    ordersRef.current = { ...ordersRef.current, [libraryKey]: loadFolderOrder(libraryKey) }
    setOrdersByLibrary(ordersRef.current)
  }, [libraryKey])

  // 所有写操作都显式指定目标库：拖动提交写发起拖动的库，重命名迁移写发起重命名的库。
  // 回调闭包在发起那一刻绑定 libraryKey，异步完成时即使已经切库，也只改发起库的那一份。
  const writeLibraryOrder = useCallback((key: string, transform: (current: string[]) => string[] | null) => {
    const previous = ordersRef.current[key] ?? loadFolderOrder(key)
    const next = transform(previous)
    // null（取消/未命中）或原引用（无变化）都不写状态、不写盘。
    if (next === null || next === previous) return
    ordersRef.current = { ...ordersRef.current, [key]: next }
    setOrdersByLibrary(ordersRef.current)
    saveFolderOrder(key, next)
  }, [])

  // 只在拖动结束且顺序确实变化后才调用；写盘失败（如隐私模式）仅退化为会话内有效，不阻断排序。
  const updateFolderOrder = useCallback((paths: string[]) => {
    writeLibraryOrder(libraryKey, (current) =>
      current.length === paths.length && current.every((path, index) => path === paths[index]) ? null : paths)
  }, [libraryKey, writeLibraryOrder])

  // 重命名确认成功后迁移发起库偏好中的对应路径并保持原位置；未命中时保持原顺序不动。
  const migrateFolderOrderPath = useCallback((fromPath: string, toPath: string) => {
    writeLibraryOrder(libraryKey, (current) => moveFolderOrderPath(current, fromPath, toPath))
  }, [libraryKey, writeLibraryOrder])

  return { folderOrder: ordersByLibrary[libraryKey] ?? [], migrateFolderOrderPath, updateFolderOrder }
}
