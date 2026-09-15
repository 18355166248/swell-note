import { useCallback, useEffect, useRef, useState } from "react"

import {
  buildFolderOrderQueueSignature,
  getFolderOrderSyncStatus,
  getOrCreateFolderOrderSyncRecord,
  loadFolderOrderSyncRecord,
  recordFolderOrderPathMigration,
  recordFolderOrderVisibleEdit,
  subscribeFolderOrderSyncRecord,
  type FolderOrderConflict,
  type FolderOrderSyncRecord,
  type FolderOrderSyncStatus,
} from "@/services/cache/folder-order-sync-store"

import { isFolderDragActive, subscribeFolderDragState } from "./folder-drag-state"
import { mergeVisibleFolderOrder, sanitizeFolderOrderEntries } from "./folder-order-document"
import { loadFolderOrder, moveFolderOrderPath, saveFolderOrder } from "./folder-order-preferences"

type FolderOrdersByLibrary = Record<string, string[]>

type SyncOrderMemory = {
  confirmedGeneration: number | null
  key: string
}

type SyncOperationState = {
  latestOperationId: number
  pendingOperationId: number | null
}

// 排序同步状态暴露给 App 层：计数、队列签名、冲突选择与失败提示都从这里派生。
export type FolderOrderSyncUiState = {
  status: FolderOrderSyncStatus
  conflict: FolderOrderConflict | null
  errorMessage: string | null
  queueSignature: string
  // IndexedDB 不可用：当前会话仍可排序，但必须让 UI 提示“本机保存失败”。
  persistenceFailed: boolean
}

function buildSyncUiState(record: FolderOrderSyncRecord | null, persistenceFailed: boolean): FolderOrderSyncUiState {
  return {
    conflict: record?.conflict ?? null,
    errorMessage: record?.error?.message ?? null,
    persistenceFailed,
    queueSignature: buildFolderOrderQueueSignature(record),
    status: record ? getFolderOrderSyncStatus(record) : "clean",
  }
}

function folderOrderEquals(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

// 重命名迁移的发起库身份：调用方在发起重命名那一刻捕获，异步完成时即使已经切库，
// 迁移也只写发起库的工作副本/偏好，不碰切换后当前库的顺序、UI 与内存代次。
export type FolderOrderMigrationOrigin = {
  key: string
  syncCacheId: string | null
}

// dnd-kit 的拖动状态通过 folder-drag-state 显式总线获取（拖动开始/结束/取消/失效都会写），
// 不再用 aria-pressed DOM 查询——排序模式开关等无关按钮也带 aria-pressed，会误判整个管理模式。

// 文件夹顺序的共享状态：桌面侧栏与移动笔记库读同一份，避免两个布局各维护一份。
// 状态挂在布局切换之上的 App 层，即使 localStorage 不可用，会话内顺序也不会因切换布局而丢失。
//
// 两种支撑方式：
// - syncCacheId 与 libraryKey 一致（WebDAV 库）：IndexedDB 工作副本是唯一事实来源，
//   v1 localStorage 只在首次建立副本时作为一次性迁移输入；远端顺序通过按库订阅派生到 UI。
// - 其余（本地库/无库）：保持 v1 localStorage 行为，本机排序不上传。
export function useFolderOrder(libraryKey: string, syncCacheId: string | null = null) {
  const syncEnabled = syncCacheId !== null && syncCacheId === libraryKey

  // ---- v1 路径（本地库；WebDAV 库的 legacy 输入）----
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

  // ---- 同步路径（WebDAV 库：IndexedDB 工作副本）----
  const [syncOrder, setSyncOrder] = useState<{ key: string; order: string[] } | null>(null)
  const [syncUiState, setSyncUiState] = useState<FolderOrderSyncUiState | null>(null)
  const syncOrderRef = useRef(syncOrder)
  // 内存状态拆成两条线：confirmedGeneration 只记录 IndexedDB 已确认代次；
  // operationId 只用于本标签页乐观操作排序。no-op/失败写入不会制造一个永远等不到的持久化代次。
  const syncMemoryRef = useRef<SyncOrderMemory>({
    confirmedGeneration: null,
    key: libraryKey,
  })
  const syncOperationStateByKeyRef = useRef(new Map<string, SyncOperationState>())
  const syncWriteChainByKeyRef = useRef(new Map<string, Promise<unknown>>())
  const persistenceFailedRef = useRef(false)
  // 拖动期间被暂缓的远端应用：保存退订函数，切库/卸载时清理监听，不让旧库的延期回调落到新库。
  const dragDeferCleanupRef = useRef<(() => void) | null>(null)

  const getSyncOperationState = useCallback((key: string) => {
    let state = syncOperationStateByKeyRef.current.get(key)
    if (!state) {
      state = { latestOperationId: 0, pendingOperationId: null }
      syncOperationStateByKeyRef.current.set(key, state)
    }
    return state
  }, [])

  const enqueueSyncWrite = useCallback(<T,>(key: string, task: () => Promise<T>) => {
    const previous = syncWriteChainByKeyRef.current.get(key) ?? Promise.resolve()
    // 同一库的本机拖动/迁移必须按发起顺序落工作副本；上一笔失败也不能卡死后续编辑。
    const run = previous.catch(() => undefined).then(task)
    syncWriteChainByKeyRef.current.set(key, run)
    return run.finally(() => {
      if (syncWriteChainByKeyRef.current.get(key) === run) syncWriteChainByKeyRef.current.delete(key)
    })
  }, [])

  // 应用远端（或远端确认后的）顺序到可见状态；拖动进行中暂缓，待拖动结束/取消/失效后按最新工作副本重跑守卫。
  const applySyncOrder = useCallback((key: string, order: string[]) => {
    if (isFolderDragActive(key)) {
      if (dragDeferCleanupRef.current) return
      let disposed = false
      const unsubscribe = subscribeFolderDragState(key, (active) => {
        if (active || disposed) return
        disposed = true
        dragDeferCleanupRef.current = null
        unsubscribe()
        void loadFolderOrderSyncRecord(key)
          .then((record) => {
            if (record && syncMemoryRef.current.key === key) reconcileSyncRecord(key, record)
          })
          .catch(() => undefined)
      })
      dragDeferCleanupRef.current = () => {
        disposed = true
        unsubscribe()
      }
      return
    }
    const current = syncOrderRef.current
    if (current && current.key === key && folderOrderEquals(current.order, order)) return
    syncOrderRef.current = { key, order: [...order] }
    setSyncOrder(syncOrderRef.current)
  }, [])

  // 工作副本变化（本标签页写入都会广播）：先更新同步状态，再在“干净且不旧于已确认代次”时应用顺序。
  // 本机有未上传意图或冲突时，可见顺序以本机编辑为准，不被远端到达覆盖。
  const reconcileSyncRecord = useCallback((key: string, record: FolderOrderSyncRecord) => {
    setSyncUiState(buildSyncUiState(record, persistenceFailedRef.current))
    const memory = syncMemoryRef.current
    if (memory.key !== key) return
    if (memory.confirmedGeneration === null) memory.confirmedGeneration = record.localGeneration
    if (record.pendingIntent || record.conflict) return
    if (persistenceFailedRef.current) return
    // 本机乐观写入还在途中时，可见顺序先尊重用户刚完成的拖动/迁移；
    // 写入回调会按 operationId 决定是否用工作副本结果回填。
    if (getSyncOperationState(key).pendingOperationId !== null) return
    if (record.localGeneration < memory.confirmedGeneration) return
    memory.confirmedGeneration = record.localGeneration
    applySyncOrder(key, record.localOrder)
  }, [applySyncOrder, getSyncOperationState])

  useEffect(() => {
    if (!syncEnabled) return
    const key = libraryKey
    let cancelled = false
    syncMemoryRef.current = {
      confirmedGeneration: null,
      key,
    }
    persistenceFailedRef.current = false
    syncOrderRef.current = null
    setSyncOrder(null)
    setSyncUiState(null)

    const unsubscribe = subscribeFolderOrderSyncRecord(key, (record) => {
      if (cancelled || !record || syncMemoryRef.current.key !== key) return
      reconcileSyncRecord(key, record)
    })

    // v1 localStorage 只作一次性迁移输入；hydration 迟到不得覆盖读期间已经确认的新状态。
    const v1Order = sanitizeFolderOrderEntries(loadFolderOrder(key))
    void getOrCreateFolderOrderSyncRecord(key, v1Order.length > 0 ? v1Order : null)
      .then(async (record) => {
        const latestRecord = await loadFolderOrderSyncRecord(key).catch(() => record)
        const settledRecord = latestRecord ?? record
        const memory = syncMemoryRef.current
        if (cancelled || memory.key !== key) return
        // hydration 回调可能晚于订阅或本机写入；先重读工作副本，只用最新快照补初始状态。
        if (memory.confirmedGeneration !== null && settledRecord.localGeneration < memory.confirmedGeneration) return
        if (memory.confirmedGeneration === null) memory.confirmedGeneration = settledRecord.localGeneration
        setSyncUiState(buildSyncUiState(settledRecord, persistenceFailedRef.current))
        // hydration 期间若用户已产生本机操作或存在未持久化会话顺序，只记录代次与状态；
        // 真正替换可见顺序时也遵守拖动延期保护，但初始化工作副本允许展示已有 pendingIntent。
        if (getSyncOperationState(key).pendingOperationId !== null || persistenceFailedRef.current) return
        memory.confirmedGeneration = settledRecord.localGeneration
        if (isFolderDragActive(key)) {
          if (dragDeferCleanupRef.current) return
          let disposed = false
          const unsubscribe = subscribeFolderDragState(key, (active) => {
            if (active || disposed) return
            disposed = true
            dragDeferCleanupRef.current = null
            unsubscribe()
            void loadFolderOrderSyncRecord(key)
              .then((latest) => {
                const currentMemory = syncMemoryRef.current
                if (!latest || currentMemory.key !== key || persistenceFailedRef.current) return
                if (getSyncOperationState(key).pendingOperationId !== null) return
                if (currentMemory.confirmedGeneration !== null && latest.localGeneration < currentMemory.confirmedGeneration) return
                currentMemory.confirmedGeneration = latest.localGeneration
                setSyncUiState(buildSyncUiState(latest, persistenceFailedRef.current))
                syncOrderRef.current = { key, order: [...latest.localOrder] }
                setSyncOrder(syncOrderRef.current)
              })
              .catch(() => undefined)
          })
          dragDeferCleanupRef.current = () => {
            disposed = true
            unsubscribe()
          }
          return
        }
        syncOrderRef.current = { key, order: [...settledRecord.localOrder] }
        setSyncOrder(syncOrderRef.current)
      })
      .catch(() => {
        if (cancelled) return
        if (syncMemoryRef.current.confirmedGeneration !== null || getSyncOperationState(key).pendingOperationId !== null) return
        // IndexedDB 不可用：会话内仍可排序，持久化失败标记交给 App 提示。
        persistenceFailedRef.current = true
        syncMemoryRef.current.confirmedGeneration = 0
        setSyncUiState(buildSyncUiState(null, true))
      })

    return () => {
      cancelled = true
      unsubscribe()
      // 切库/卸载时清掉拖动延期的监听：旧库的延期应用不得落到新库，监听器本身也不泄漏。
      dragDeferCleanupRef.current?.()
      dragDeferCleanupRef.current = null
    }
  }, [applySyncOrder, getSyncOperationState, libraryKey, reconcileSyncRecord, syncEnabled])

  // ---- v1 写路径（本地库保持原行为）----
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

  // ---- 同步写路径：可见子集提交，权威合并在工作副本事务内完成 ----
  // 内存快照可能滞后于工作副本（如拖动期间远端 adopt 被延期）：乐观合并只用于即时显示；
  // 真正落盘的合并由 recordFolderOrderVisibleEdit 在事务内以最新 localOrder 为基执行，
  // 绝不用内存合并结果整表覆盖工作副本（会丢副本中尚未应用到界面的成员）。
  const writeSyncOrder = useCallback((visibleOrder: string[]) => {
    const key = libraryKey
    const current = syncOrderRef.current
    const currentFull = current?.key === key ? current.order : []
    const optimistic = mergeVisibleFolderOrder(currentFull, visibleOrder)
    if (current && current.key === key && folderOrderEquals(current.order, optimistic)) return
    const operationState = getSyncOperationState(key)
    const operationId = operationState.latestOperationId + 1
    operationState.latestOperationId = operationId
    operationState.pendingOperationId = operationId
    syncOrderRef.current = { key, order: optimistic }
    setSyncOrder(syncOrderRef.current)
    // 乐观更新只占用本机操作 ticket；落盘后以工作副本的真实代次与合并结果为准。
    void enqueueSyncWrite(key, async () => {
      if (!await loadFolderOrderSyncRecord(key).catch(() => null)) {
        const v1Order = sanitizeFolderOrderEntries(loadFolderOrder(key))
        await getOrCreateFolderOrderSyncRecord(key, v1Order.length > 0 ? v1Order : null)
      }
      return recordFolderOrderVisibleEdit(key, visibleOrder)
    })
      .then(async (record) => {
        const latestRecord = await loadFolderOrderSyncRecord(key).catch(() => record)
        const memory = syncMemoryRef.current
        const operationState = getSyncOperationState(key)
        if (operationState.latestOperationId !== operationId) return
        operationState.pendingOperationId = null
        const settledRecord = latestRecord ?? record
        if (!settledRecord || memory.key !== key) return
        memory.confirmedGeneration = settledRecord.localGeneration
        persistenceFailedRef.current = false
        // 工作副本是权威：事务合并可能带回了内存滞后未见的成员，回填纠正可见顺序。
        syncOrderRef.current = { key, order: [...settledRecord.localOrder] }
        setSyncOrder(syncOrderRef.current)
        setSyncUiState(buildSyncUiState(settledRecord, persistenceFailedRef.current))
      })
      .catch(() => {
        // 库身份检查必须在修改 ref 之前：失败属于其他库时不能污染当前库的 persistenceFailed。
        const memory = syncMemoryRef.current
        const operationState = getSyncOperationState(key)
        if (operationState.latestOperationId !== operationId) return
        operationState.pendingOperationId = null
        if (memory.key !== key) return
        // 写盘失败仅退化为会话内有效，不阻断排序；UI 提示“本机保存失败”。
        persistenceFailedRef.current = true
        setSyncUiState((previous) => previous
          ? { ...previous, persistenceFailed: true }
          : buildSyncUiState(null, true))
      })
  }, [enqueueSyncWrite, getSyncOperationState, libraryKey])

  // 只在拖动结束且顺序确实变化后才调用。同步路径传入的是可见顶层子集：
  // 乐观合并基于内存快照（仅即时显示），权威合并在工作副本事务内完成（见 writeSyncOrder）。
  const updateFolderOrder = useCallback((paths: string[]) => {
    if (syncEnabled) {
      writeSyncOrder(paths)
      return
    }
    writeLibraryOrder(libraryKey, (current) =>
      current.length === paths.length && current.every((path, index) => path === paths[index]) ? null : paths)
  }, [libraryKey, syncEnabled, writeLibraryOrder, writeSyncOrder])

  // 同步库的重命名迁移：持久化一律走工作副本单事务（以副本为准，内存快照可能落后）；
  // 只有目标库就是当前显示库时才做乐观界面更新，其他库的顺序、UI 与内存代次都不动。
  const migrateSyncLibraryOrder = useCallback((key: string, fromPath: string, toPath: string) => {
    const isCurrentLibrary = key === libraryKey && syncMemoryRef.current.key === key
    let operationId: number | null = null
    if (isCurrentLibrary) {
      const operationState = getSyncOperationState(key)
      operationId = operationState.latestOperationId + 1
      operationState.latestOperationId = operationId
      operationState.pendingOperationId = operationId
      const current = syncOrderRef.current
      if (current?.key === key) {
        const next = moveFolderOrderPath([...current.order], fromPath, toPath)
        if (!folderOrderEquals(next, current.order)) {
          syncOrderRef.current = { key, order: next }
          setSyncOrder(syncOrderRef.current)
        }
      }
    }
    void enqueueSyncWrite(key, async () => {
      if (!await loadFolderOrderSyncRecord(key).catch(() => null)) {
        const v1Order = sanitizeFolderOrderEntries(loadFolderOrder(key))
        await getOrCreateFolderOrderSyncRecord(key, v1Order.length > 0 ? v1Order : null)
      }
      return recordFolderOrderPathMigration(key, fromPath, toPath)
    })
      .then(async (record) => {
        const latestRecord = await loadFolderOrderSyncRecord(key).catch(() => record)
        // 只有发起库仍是当前显示库时才校正内存代次与同步状态；
        // 其他库只落工作副本，它的界面由那边的按库订阅在激活时派生。
        const memory = syncMemoryRef.current
        const settledRecord = latestRecord ?? record
        if (!settledRecord) return
        if (operationId !== null) {
          const operationState = getSyncOperationState(key)
          if (operationState.latestOperationId !== operationId) return
          operationState.pendingOperationId = null
        } else if (getSyncOperationState(key).pendingOperationId !== null) {
          return
        }
        if (memory.key !== key) return
        memory.confirmedGeneration = settledRecord.localGeneration
        persistenceFailedRef.current = false
        // 工作副本是权威：事务迁移可能带回了内存滞后未见的成员，回填纠正可见顺序。
        syncOrderRef.current = { key, order: [...settledRecord.localOrder] }
        setSyncOrder(syncOrderRef.current)
        setSyncUiState(buildSyncUiState(settledRecord, persistenceFailedRef.current))
      })
      .catch(() => {
        // 库身份检查必须在修改 ref 之前：切库后迟到的失败不能污染当前库的 persistenceFailed。
        const memory = syncMemoryRef.current
        if (operationId !== null) {
          const operationState = getSyncOperationState(key)
          if (operationState.latestOperationId !== operationId) return
          operationState.pendingOperationId = null
        } else if (getSyncOperationState(key).pendingOperationId !== null) {
          return
        }
        if (memory.key !== key) return
        // 写盘失败不阻断重命名本身；提示“本机保存失败”，排序路径迁移随下次同步重新评估。
        persistenceFailedRef.current = true
        setSyncUiState((previous) => previous
          ? { ...previous, persistenceFailed: true }
          : buildSyncUiState(null, true))
      })
  }, [enqueueSyncWrite, getSyncOperationState, libraryKey])

  // 重命名确认成功后迁移发起库偏好中的对应路径并保持原位置；未命中时保持原顺序不动。
  // WebDAV 重命名是本机先标记、远端 MOVE 后完成的异步流程：调用方传入发起时捕获的
  // origin，完成时即使已经切库（A→B、A→B→A），迁移也只写发起库，不影响其他库。
  const migrateFolderOrderPath = useCallback((fromPath: string, toPath: string, origin?: FolderOrderMigrationOrigin) => {
    const targetKey = origin?.key ?? libraryKey
    const targetSyncId = origin ? origin.syncCacheId : (syncEnabled ? libraryKey : null)
    if (targetSyncId !== null && targetSyncId === targetKey) {
      migrateSyncLibraryOrder(targetKey, fromPath, toPath)
      return
    }
    writeLibraryOrder(targetKey, (current) => moveFolderOrderPath(current, fromPath, toPath))
  }, [libraryKey, syncEnabled, writeLibraryOrder, migrateSyncLibraryOrder])

  const folderOrder = syncEnabled
    ? (syncOrder?.key === libraryKey ? syncOrder.order : [])
    : ordersByLibrary[libraryKey] ?? []

  return {
    folderOrder,
    folderOrderSync: syncEnabled ? syncUiState : null,
    migrateFolderOrderPath,
    updateFolderOrder,
  }
}
