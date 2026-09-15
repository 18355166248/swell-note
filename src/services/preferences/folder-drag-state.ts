// 文件夹拖动的显式状态总线：FolderSortDndContext 在拖动开始/结束/取消/失效时写入，
// useFolderOrder 据此暂缓远端顺序的可见替换，待拖动结束后按最新工作副本重跑守卫。
//
// 替代旧的 aria-pressed DOM 查询：排序模式开关等无关按钮同样带 aria-pressed="true"，
// DOM 查询会把整个管理模式误判为“拖动中”，也无法区分结束、取消、切库与卸载。
// 状态按库（folderOrderKey）记录；同库新拖动开始会覆盖旧状态，失效（dead）会话不会复活。

type FolderDragStateListener = (active: boolean) => void

const activeDragKeys = new Set<string>()
const listenersByKey = new Map<string, Set<FolderDragStateListener>>()

export function setFolderDragActive(key: string, active: boolean) {
  const wasActive = activeDragKeys.has(key)
  if (active === wasActive) return
  if (active) activeDragKeys.add(key)
  else activeDragKeys.delete(key)
  const listeners = listenersByKey.get(key)
  if (!listeners) return
  for (const listener of [...listeners]) listener(active)
}

export function isFolderDragActive(key: string) {
  return activeDragKeys.has(key)
}

export function subscribeFolderDragState(key: string, listener: FolderDragStateListener) {
  let listeners = listenersByKey.get(key)
  if (!listeners) {
    listeners = new Set()
    listenersByKey.set(key, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByKey.delete(key)
  }
}
