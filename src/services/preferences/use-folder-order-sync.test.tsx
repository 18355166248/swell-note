// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getOrCreateFolderOrderSyncRecord,
  loadFolderOrderSyncRecord,
  updateFolderOrderSyncRecord,
  type FolderOrderSyncRecord,
} from "@/services/cache/folder-order-sync-store"
import * as syncStore from "@/services/cache/folder-order-sync-store"
import { saveFolderOrder } from "@/services/preferences/folder-order-preferences"

import { isFolderDragActive, setFolderDragActive } from "./folder-drag-state"
import { useFolderOrder } from "./use-folder-order"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type HookValue = ReturnType<typeof useFolderOrder>

let container: HTMLElement | null = null
let root: Root | null = null
let current: HookValue | null = null

function Probe({ libraryKey, syncCacheId }: { libraryKey: string; syncCacheId?: string | null }) {
  current = useFolderOrder(libraryKey, syncCacheId)
  return null
}

function mount(libraryKey: string, syncCacheId?: string | null) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<Probe libraryKey={libraryKey} syncCacheId={syncCacheId} />)
  })
}

// 同一挂载内切换库：触发 useFolderOrder 的切库 effect 与清理，不卸载组件树。
function switchLibrary(libraryKey: string, syncCacheId?: string | null) {
  act(() => {
    root!.render(<Probe libraryKey={libraryKey} syncCacheId={syncCacheId} />)
  })
}

async function flushAsync() {
  // fake-indexeddb 的请求按宏任务推进，需要让出多轮事件循环才能让 hydration/落盘完成。
  await act(async () => {
    for (let round = 0; round < 20; round += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    }
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function syncRecordFixture(cacheId: string, overrides: Partial<FolderOrderSyncRecord>): FolderOrderSyncRecord {
  return {
    attemptedUpload: null,
    base: null,
    cacheId,
    conflict: null,
    error: null,
    key: `folder-order-sync:v1:${cacheId}`,
    localGeneration: 0,
    localOrder: [],
    migratedFromV1Backup: null,
    migrationDone: true,
    pendingIntent: null,
    updatedAt: 0,
    ...overrides,
  }
}

function unmount() {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  current = null
}

beforeEach(async () => {
  window.localStorage.clear()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("swell-note-vault-cache")
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

afterEach(() => {
  unmount()
  // 显式拖动状态是模块级总线：用例之间必须复位，避免上一个用例的“拖动中”泄漏到下一个。
  setFolderDragActive("vault-a", false)
  setFolderDragActive("vault-b", false)
  vi.restoreAllMocks()
})

describe("useFolderOrder 同步支撑（WebDAV 库）", () => {
  it("hydration：工作副本的完整顺序应用到可见状态", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["Beta", "Alpha"]
      draft.localGeneration = 3
      draft.base = { changeId: "c", etag: '"e1"', exists: true, order: ["Beta", "Alpha"] }
    })

    mount("vault-a", "vault-a")
    await flushAsync()

    expect(current!.folderOrder).toEqual(["Beta", "Alpha"])
    expect(current!.folderOrderSync).toMatchObject({ persistenceFailed: false, status: "clean" })
  })

  it("v1 旧排序作为一次性迁移输入：标为待上传并展示本机顺序", async () => {
    saveFolderOrder("vault-a", ["旧一", "旧二"])

    mount("vault-a", "vault-a")
    await flushAsync()

    expect(current!.folderOrder).toEqual(["旧一", "旧二"])
    expect(current!.folderOrderSync?.status).toBe("pending")
    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.pendingIntent).toMatchObject({ order: ["旧一", "旧二"], origin: "migration" })

    // 重复挂载不重复迁移。
    unmount()
    mount("vault-a", "vault-a")
    await flushAsync()
    const again = await loadFolderOrderSyncRecord("vault-a")
    expect(again?.localGeneration).toBe(record?.localGeneration)
  })

  it("拖动提交可见子集：未扫描成员槽位保留，完整顺序落工作副本", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      // X 是其他设备记录、本机尚未扫描到的目录。
      draft.localOrder = ["A", "X", "B"]
      draft.localGeneration = 1
      draft.base = { changeId: "c", etag: '"e1"', exists: true, order: ["A", "X", "B"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()
    expect(current!.folderOrder).toEqual(["A", "X", "B"])

    // 本机只见 [A, B]，拖成 [B, A]：X 保留在原槽位。
    act(() => current!.updateFolderOrder(["B", "A"]))
    expect(current!.folderOrder).toEqual(["B", "X", "A"])
    await flushAsync()

    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.localOrder).toEqual(["B", "X", "A"])
    expect(record?.pendingIntent).toMatchObject({ generation: 2, order: ["B", "X", "A"], origin: "edit" })
    expect(current!.folderOrderSync?.status).toBe("pending")
  })

  it("远端顺序经订阅到达：干净且代次一致时替换可见顺序", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    mount("vault-a", "vault-a")
    await flushAsync()

    // 模拟协调器 adopt：代次不变、顺序替换、无意图无冲突。
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端一", "远端二"]
        draft.base = { changeId: "c2", etag: '"e2"', exists: true, order: ["远端一", "远端二"] }
      })
    })

    expect(current!.folderOrder).toEqual(["远端一", "远端二"])
    expect(current!.folderOrderSync?.status).toBe("clean")
  })

  it("本机有待上传意图时远端到达不覆盖可见顺序", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    mount("vault-a", "vault-a")
    await flushAsync()
    act(() => current!.updateFolderOrder(["本机"]))
    await flushAsync()

    // 协调器在 adopt 落盘时被代次守卫拦截，只更新了 base，顺序与意图保持本机。
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.base = { changeId: "c2", etag: '"e2"', exists: true, order: ["远端"] }
      })
    })

    expect(current!.folderOrder).toEqual(["本机"])
    expect(current!.folderOrderSync?.status).toBe("pending")
  })

  it("拖动进行中远端到达：暂缓替换，拖动结束后按最新记录应用", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    mount("vault-a", "vault-a")
    await flushAsync()

    // 显式拖动状态总线（替代旧的 aria-pressed DOM 查询）。
    setFolderDragActive("vault-a", true)
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端"]
        draft.base = { changeId: "c2", etag: '"e2"', exists: true, order: ["远端"] }
      })
    })
    // 拖动期间不替换可见顺序。
    expect(current!.folderOrder).toEqual([])

    // 拖动结束（setFolderDragActive(false)）触发延期应用按最新记录重跑守卫。
    setFolderDragActive("vault-a", false)
    await flushAsync()
    expect(current!.folderOrder).toEqual(["远端"])
  })

  it("拖动期间先提交本机排序再结束：延期应用重跑守卫，不被远端旧顺序覆盖", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    mount("vault-a", "vault-a")
    await flushAsync()

    setFolderDragActive("vault-a", true)
    // 远端顺序到达，因拖动中被暂缓（工作副本已 adopt，内存可见顺序仍为空）。
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端"]
        draft.base = { changeId: "c2", etag: '"e2"', exists: true, order: ["远端"] }
      })
    })

    // handleDragEnd 的顺序：先 onCommit（本机新代次落盘），再复位拖动状态。
    act(() => current!.updateFolderOrder(["本机"]))
    setFolderDragActive("vault-a", false)
    await flushAsync()

    // 合并在工作副本事务内完成：已 adopt 的“远端”保留槽位，本机新成员追加——
    // 既不是整表覆盖丢掉“远端”，也不是被远端旧顺序覆盖掉“本机”。
    expect(current!.folderOrder).toEqual(["远端", "本机"])
    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.pendingIntent?.order).toEqual(["远端", "本机"])
  })

  it("no-op 写入不推进持久化代次，后续远端更新仍能应用", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()

    setFolderDragActive("vault-a", true)
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["B", "A"]
        draft.base = { changeId: "remote-1", etag: '"e2"', exists: true, order: ["B", "A"] }
      })
    })
    expect(current!.folderOrder).toEqual(["A", "B"])

    act(() => current!.updateFolderOrder(["B", "A"]))
    setFolderDragActive("vault-a", false)
    await flushAsync()

    const afterNoop = await loadFolderOrderSyncRecord("vault-a")
    expect(afterNoop?.localGeneration).toBe(4)
    expect(afterNoop?.localOrder).toEqual(["B", "A"])

    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["A", "B"]
        draft.base = { changeId: "remote-2", etag: '"e3"', exists: true, order: ["A", "B"] }
      })
    })
    expect(current!.folderOrder).toEqual(["A", "B"])
  })

  it("失败写入后再次成功编辑，不会阻塞后续远端更新", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()

    vi.spyOn(syncStore, "recordFolderOrderVisibleEdit").mockRejectedValueOnce(new Error("transient local write failure"))
    act(() => current!.updateFolderOrder(["B", "A"]))
    await flushAsync()
    expect(current!.folderOrder).toEqual(["B", "A"])
    expect(current!.folderOrderSync?.persistenceFailed).toBe(true)

    act(() => current!.updateFolderOrder(["B", "C", "A"]))
    await flushAsync()
    expect(current!.folderOrder).toEqual(["B", "C", "A"])
    expect(current!.folderOrderSync?.persistenceFailed).toBe(false)

    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["C", "A", "B"]
        draft.pendingIntent = null
        draft.base = { changeId: "remote", etag: '"e2"', exists: true, order: ["C", "A", "B"] }
      })
    })
    expect(current!.folderOrder).toEqual(["C", "A", "B"])
  })

  it("hydration 期间本机写入失败后保留会话顺序，后续成功写入恢复远端应用", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    const hydration = deferred<FolderOrderSyncRecord>()
    vi.spyOn(syncStore, "getOrCreateFolderOrderSyncRecord").mockReturnValueOnce(hydration.promise)
    vi.spyOn(syncStore, "recordFolderOrderVisibleEdit").mockRejectedValueOnce(new Error("write failed"))

    mount("vault-a", "vault-a")
    act(() => current!.updateFolderOrder(["B", "A"]))
    expect(current!.folderOrder).toEqual(["B", "A"])

    hydration.resolve(syncRecordFixture("vault-a", {
      base: { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] },
      localGeneration: 4,
      localOrder: ["A", "B"],
    }))
    await flushAsync()
    expect(current!.folderOrder).toEqual(["B", "A"])
    expect(current!.folderOrderSync?.persistenceFailed).toBe(true)

    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端"]
        draft.pendingIntent = null
        draft.base = { changeId: "remote", etag: '"e2"', exists: true, order: ["远端"] }
      })
    })
    expect(current!.folderOrder).toEqual(["B", "A"])

    act(() => current!.updateFolderOrder(["A", "B", "C"]))
    await flushAsync()
    expect(current!.folderOrderSync?.persistenceFailed).toBe(false)

    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端恢复"]
        draft.pendingIntent = null
        draft.base = { changeId: "remote-2", etag: '"e3"', exists: true, order: ["远端恢复"] }
      })
    })
    expect(current!.folderOrder).toEqual(["远端恢复"])
  })

  it("本机写入先失败时，迟到 hydration 成功不覆盖未保存会话顺序", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    const oldHydrationRecord = (await loadFolderOrderSyncRecord("vault-a"))!
    const hydration = deferred<FolderOrderSyncRecord>()
    vi.spyOn(syncStore, "getOrCreateFolderOrderSyncRecord").mockReturnValueOnce(hydration.promise)
    vi.spyOn(syncStore, "recordFolderOrderVisibleEdit").mockRejectedValueOnce(new Error("write failed"))

    mount("vault-a", "vault-a")
    act(() => current!.updateFolderOrder(["B", "A"]))
    await flushAsync()
    expect(current!.folderOrder).toEqual(["B", "A"])
    expect(current!.folderOrderSync?.persistenceFailed).toBe(true)

    hydration.resolve(oldHydrationRecord)
    await flushAsync()

    expect(current!.folderOrder).toEqual(["B", "A"])
    expect(current!.folderOrderSync?.persistenceFailed).toBe(true)
  })

  it("迟到 hydration 不覆盖已经成功的本机编辑和 pending 状态", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    const oldHydrationRecord = (await loadFolderOrderSyncRecord("vault-a"))!
    const hydration = deferred<FolderOrderSyncRecord>()
    vi.spyOn(syncStore, "getOrCreateFolderOrderSyncRecord").mockReturnValueOnce(hydration.promise)

    mount("vault-a", "vault-a")
    act(() => current!.updateFolderOrder(["B", "A"]))
    await flushAsync()
    expect((await loadFolderOrderSyncRecord("vault-a"))?.localOrder).toEqual(["B", "A"])
    expect(current!.folderOrder).toEqual(["B", "A"])
    expect(current!.folderOrderSync?.status).toBe("pending")

    hydration.resolve(oldHydrationRecord)
    await flushAsync()

    expect(current!.folderOrder).toEqual(["B", "A"])
    expect(current!.folderOrderSync?.status).toBe("pending")
    expect((await loadFolderOrderSyncRecord("vault-a"))?.localGeneration).toBe(5)
  })

  it("迟到 hydration 失败不覆盖已经成功的本机编辑状态", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    const hydration = deferred<FolderOrderSyncRecord>()
    vi.spyOn(syncStore, "getOrCreateFolderOrderSyncRecord").mockReturnValueOnce(hydration.promise)

    mount("vault-a", "vault-a")
    act(() => current!.updateFolderOrder(["B", "A"]))
    await flushAsync()
    expect(current!.folderOrderSync?.status).toBe("pending")

    hydration.reject(new Error("late hydration failure"))
    await flushAsync()

    expect(current!.folderOrder).toEqual(["B", "A"])
    expect(current!.folderOrderSync?.persistenceFailed).toBe(false)
    expect(current!.folderOrderSync?.status).toBe("pending")
  })

  it("初始化读取期间收到更晚订阅记录时，旧 hydration 不倒退可见顺序", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    const oldHydrationRecord = (await loadFolderOrderSyncRecord("vault-a"))!
    const hydration = deferred<FolderOrderSyncRecord>()
    vi.spyOn(syncStore, "getOrCreateFolderOrderSyncRecord").mockReturnValueOnce(hydration.promise)

    mount("vault-a", "vault-a")
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端"]
        draft.base = { changeId: "remote", etag: '"e2"', exists: true, order: ["远端"] }
      })
    })
    expect(current!.folderOrder).toEqual(["远端"])

    hydration.resolve(oldHydrationRecord)
    await flushAsync()

    expect(current!.folderOrder).toEqual(["远端"])
    expect(current!.folderOrderSync?.status).toBe("clean")
  })

  it("hydration 到达时正在拖动：暂缓初始化快照，拖动结束后再应用", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 4
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    const hydrationRecord = (await loadFolderOrderSyncRecord("vault-a"))!
    const hydration = deferred<FolderOrderSyncRecord>()
    vi.spyOn(syncStore, "getOrCreateFolderOrderSyncRecord").mockReturnValueOnce(hydration.promise)

    mount("vault-a", "vault-a")
    setFolderDragActive("vault-a", true)
    hydration.resolve(hydrationRecord)
    await flushAsync()
    expect(current!.folderOrder).toEqual([])

    setFolderDragActive("vault-a", false)
    await flushAsync()
    expect(current!.folderOrder).toEqual(["A", "B"])
  })

  it("hydration 拖动延期后仍展示已有 pendingIntent 的本机顺序", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["B", "A"]
      draft.localGeneration = 5
      draft.pendingIntent = { generation: 5, order: ["B", "A"], origin: "edit" }
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    const hydrationRecord = (await loadFolderOrderSyncRecord("vault-a"))!
    const hydration = deferred<FolderOrderSyncRecord>()
    vi.spyOn(syncStore, "getOrCreateFolderOrderSyncRecord").mockReturnValueOnce(hydration.promise)

    mount("vault-a", "vault-a")
    setFolderDragActive("vault-a", true)
    hydration.resolve(hydrationRecord)
    await flushAsync()
    expect(current!.folderOrder).toEqual([])

    setFolderDragActive("vault-a", false)
    await flushAsync()
    expect(current!.folderOrder).toEqual(["B", "A"])
    expect(current!.folderOrderSync?.status).toBe("pending")
  })

  it("排序模式开关等无关 aria-pressed 元素不再误判为拖动中", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    mount("vault-a", "vault-a")
    await flushAsync()

    // 复现审查 #4：排序模式开关带 aria-pressed="true"，旧 DOM 查询会把整个管理模式误判为拖动中。
    const toggle = document.createElement("button")
    toggle.setAttribute("aria-pressed", "true")
    document.body.appendChild(toggle)
    try {
      expect(isFolderDragActive("vault-a")).toBe(false)
      await act(async () => {
        await updateFolderOrderSyncRecord("vault-a", (draft) => {
          draft.localOrder = ["远端"]
          draft.base = { changeId: "c2", etag: '"e2"', exists: true, order: ["远端"] }
        })
      })
      // 显式总线未报告拖动，远端顺序立即应用。
      expect(current!.folderOrder).toEqual(["远端"])
    } finally {
      toggle.remove()
    }
  })

  it("切库时延期监听被清理：旧库拖动结束不落到新库，新库不受影响", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await getOrCreateFolderOrderSyncRecord("vault-b", null)
    mount("vault-a", "vault-a")
    await flushAsync()

    // vault-a 拖动中，远端顺序被暂缓。
    setFolderDragActive("vault-a", true)
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端A"]
        draft.base = { changeId: "ca", etag: '"ea"', exists: true, order: ["远端A"] }
      })
    })

    // 切到 vault-b：旧库的延期监听在 effect 清理中退订。
    switchLibrary("vault-b", "vault-b")
    await flushAsync()
    // 旧库拖动结束信号到达时，延期回调已退订，不会污染 vault-b 的可见顺序。
    setFolderDragActive("vault-a", false)
    await flushAsync()
    expect(current!.folderOrder).toEqual([])

    // 切回 vault-a：按工作副本的干净记录正常应用。
    switchLibrary("vault-a", "vault-a")
    await flushAsync()
    expect(current!.folderOrder).toEqual(["远端A"])
  })

  it("卸载时延期监听被清理：拖动结束后无残留回调", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    mount("vault-a", "vault-a")
    await flushAsync()

    setFolderDragActive("vault-a", true)
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端"]
        draft.base = { changeId: "c2", etag: '"e2"', exists: true, order: ["远端"] }
      })
    })
    unmount()

    // 卸载后拖动结束：退订过的监听不再触发，不抛错也不写任何状态。
    setFolderDragActive("vault-a", false)
    await flushAsync()
    expect(current).toBeNull()
  })

  it("重命名迁移命中同步顺序并保持位置，随后标为待上传", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["Alpha", "Beta", "Gamma"]
      draft.localGeneration = 1
      draft.base = { changeId: "c", etag: '"e1"', exists: true, order: ["Alpha", "Beta", "Gamma"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()

    act(() => current!.migrateFolderOrderPath("Beta", "Delta"))
    expect(current!.folderOrder).toEqual(["Alpha", "Delta", "Gamma"])
    await flushAsync()
    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.pendingIntent?.order).toEqual(["Alpha", "Delta", "Gamma"])

    // 未命中不写盘。
    act(() => current!.migrateFolderOrderPath("Missing", "Nope"))
    await flushAsync()
    const after = await loadFolderOrderSyncRecord("vault-a")
    expect(after?.localGeneration).toBe(record?.localGeneration)
  })

  it("WebDAV 异步重命名绑定发起库：切库后完成只写发起库，不改当前库", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["Alpha", "Beta"]
      draft.localGeneration = 1
      draft.base = { changeId: "ca", etag: '"ea"', exists: true, order: ["Alpha", "Beta"] }
    })
    await getOrCreateFolderOrderSyncRecord("vault-b", null)
    await updateFolderOrderSyncRecord("vault-b", (draft) => {
      draft.localOrder = ["一", "二"]
      draft.localGeneration = 7
      draft.base = { changeId: "cb", etag: '"eb"', exists: true, order: ["一", "二"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()
    expect(current!.folderOrder).toEqual(["Alpha", "Beta"])

    // 发起重命名时捕获的 origin；随后用户切到 vault-b，重命名异步完成。
    const origin = { key: "vault-a", syncCacheId: "vault-a" }
    switchLibrary("vault-b", "vault-b")
    await flushAsync()
    expect(current!.folderOrder).toEqual(["一", "二"])

    act(() => current!.migrateFolderOrderPath("Beta", "Delta", origin))
    await flushAsync()

    // 发起库的工作副本已迁移并标为待上传。
    const recordA = await loadFolderOrderSyncRecord("vault-a")
    expect(recordA?.localOrder).toEqual(["Alpha", "Delta"])
    expect(recordA?.pendingIntent?.order).toEqual(["Alpha", "Delta"])
    // 当前库（vault-b）的顺序、代次与可见 UI 完全不动。
    const recordB = await loadFolderOrderSyncRecord("vault-b")
    expect(recordB?.localOrder).toEqual(["一", "二"])
    expect(recordB?.localGeneration).toBe(7)
    expect(recordB?.pendingIntent).toBeNull()
    expect(current!.folderOrder).toEqual(["一", "二"])
  })

  it("A→B→A：切回发起库后完成的迁移正常乐观更新该库", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["Alpha", "Beta"]
      draft.localGeneration = 1
      draft.base = { changeId: "ca", etag: '"ea"', exists: true, order: ["Alpha", "Beta"] }
    })
    await getOrCreateFolderOrderSyncRecord("vault-b", null)
    mount("vault-a", "vault-a")
    await flushAsync()

    const origin = { key: "vault-a", syncCacheId: "vault-a" }
    switchLibrary("vault-b", "vault-b")
    await flushAsync()
    switchLibrary("vault-a", "vault-a")
    await flushAsync()
    expect(current!.folderOrder).toEqual(["Alpha", "Beta"])

    act(() => current!.migrateFolderOrderPath("Beta", "Delta", origin))
    expect(current!.folderOrder).toEqual(["Alpha", "Delta"])
    await flushAsync()
    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.pendingIntent?.order).toEqual(["Alpha", "Delta"])
  })

  it("内存滞后于工作副本时迁移以副本为准，不丢未应用到界面的成员", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 1
      draft.base = { changeId: "c", etag: '"e"', exists: true, order: ["A", "B"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()
    expect(current!.folderOrder).toEqual(["A", "B"])

    // 拖动期间远端 adopt 被延期：工作副本已含 X，内存可见顺序仍是 [A, B]。
    setFolderDragActive("vault-a", true)
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["A", "X", "B"]
        draft.base = { changeId: "c2", etag: '"e2"', exists: true, order: ["A", "X", "B"] }
      })
    })
    expect(current!.folderOrder).toEqual(["A", "B"])

    // 迁移在工作副本单事务内完成：X 不能因内存快照滞后而丢失。
    act(() => current!.migrateFolderOrderPath("A", "A2", { key: "vault-a", syncCacheId: "vault-a" }))
    await flushAsync()
    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.localOrder).toEqual(["A2", "X", "B"])
    expect(record?.pendingIntent?.order).toEqual(["A2", "X", "B"])
    setFolderDragActive("vault-a", false)
  })

  it("origin 指向本地库时走 v1 偏好：即使当前显示的是别的库也只写发起库", async () => {
    saveFolderOrder("local-a", ["Alpha", "Beta"])
    await getOrCreateFolderOrderSyncRecord("vault-b", null)
    await updateFolderOrderSyncRecord("vault-b", (draft) => {
      draft.localOrder = ["一", "二"]
      draft.localGeneration = 1
      draft.base = { changeId: "cb", etag: '"eb"', exists: true, order: ["一", "二"] }
    })
    mount("vault-b", "vault-b")
    await flushAsync()

    act(() => current!.migrateFolderOrderPath("Beta", "Delta", { key: "local-a", syncCacheId: null }))
    await flushAsync()

    // v1 偏好按库写入发起库；当前库的顺序与工作副本不受影响。
    expect(window.localStorage.getItem("swell-note:folder-order:v1")).toContain("Delta")
    expect(current!.folderOrder).toEqual(["一", "二"])
    expect(await loadFolderOrderSyncRecord("vault-b")).toMatchObject({ localOrder: ["一", "二"], pendingIntent: null })
  })

  it("IndexedDB 不可用时仍可会话内排序，并标记本机保存失败", async () => {
    const openSpy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new Error("denied")
    })

    mount("vault-a", "vault-a")
    await flushAsync()

    expect(current!.folderOrderSync?.persistenceFailed).toBe(true)
    act(() => current!.updateFolderOrder(["Beta", "Alpha"]))
    expect(current!.folderOrder).toEqual(["Beta", "Alpha"])
    await flushAsync()
    expect(current!.folderOrderSync?.persistenceFailed).toBe(true)
    openSpy.mockRestore()
  })

  it("syncCacheId 与 libraryKey 不一致时退回 v1 本机行为", async () => {
    mount("vault-a", "vault-b")
    await flushAsync()

    expect(current!.folderOrderSync).toBeNull()
    act(() => current!.updateFolderOrder(["Beta", "Alpha"]))
    expect(current!.folderOrder).toEqual(["Beta", "Alpha"])
    // 写入 v1 localStorage，而不是同步工作副本。
    expect(window.localStorage.getItem("swell-note:folder-order:v1")).toContain("Beta")
    expect(await loadFolderOrderSyncRecord("vault-a")).toBeNull()
  })
})

// 复审问题 1：拖动提交必须以工作副本的最新完整顺序为基合并，
// 不得用延期显示的内存快照（syncOrderRef）整表覆盖工作副本。
describe("拖动提交以工作副本为基合并（复审 #1）", () => {
  // 公共前置：界面只见 [A, B]；拖动期间工作副本被 adopt 为 [A, X, B]（应用被延期，内存未跟进）。
  async function startWithDeferredRemote() {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()
    expect(current!.folderOrder).toEqual(["A", "B"])
    setFolderDragActive("vault-a", true)
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["A", "X", "B"]
        draft.base = { changeId: "new", etag: '"e2"', exists: true, order: ["A", "X", "B"] }
      })
    })
    // 远端应用被拖动延期：可见顺序仍是 [A, B]，工作副本已是 [A, X, B]。
    expect(current!.folderOrder).toEqual(["A", "B"])
  }

  it("界面滞后时提交 [B,A]：保存与上传意图必须是 [B,X,A]，后续编辑仍基于它", async () => {
    await startWithDeferredRemote()

    // 拖动期间提交可见子集 [B, A]：合并在工作副本事务内以 [A, X, B] 为基完成。
    act(() => current!.updateFolderOrder(["B", "A"]))
    setFolderDragActive("vault-a", false)
    await flushAsync()

    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.localOrder).toEqual(["B", "X", "A"])
    // pendingIntent 即下次同步的上传载荷：X 不能丢。
    expect(record?.pendingIntent?.order).toEqual(["B", "X", "A"])

    // 内存差异不丢数据要验证到后续编辑：再把可见子集拖回 [A, B]，X 仍保留槽位。
    act(() => current!.updateFolderOrder(["A", "B"]))
    await flushAsync()
    const after = await loadFolderOrderSyncRecord("vault-a")
    expect(after?.localOrder).toEqual(["A", "X", "B"])
    expect(after?.pendingIntent?.order).toEqual(["A", "X", "B"])
  })

  it("先迁移 A→A2 再提交 [B,A2]：保存与上传意图必须是 [B,X,A2]", async () => {
    await startWithDeferredRemote()

    // 迁移以工作副本为基（[A,X,B] → [A2,X,B]），内存乐观值仍滞后（[A2,B]）。
    act(() => current!.migrateFolderOrderPath("A", "A2", { key: "vault-a", syncCacheId: "vault-a" }))
    await flushAsync()
    expect((await loadFolderOrderSyncRecord("vault-a"))?.localOrder).toEqual(["A2", "X", "B"])

    // 随后拖动提交 [B, A2]：同样以工作副本最新 localOrder 为基合并。
    act(() => current!.updateFolderOrder(["B", "A2"]))
    setFolderDragActive("vault-a", false)
    await flushAsync()
    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.localOrder).toEqual(["B", "X", "A2"])
    expect(record?.pendingIntent?.order).toEqual(["B", "X", "A2"])
  })

  it("迁移事务被延迟时，后续拖动等待前序迁移后再落盘", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "X", "B"]
      draft.localGeneration = 1
      draft.base = { changeId: "c", etag: '"e"', exists: true, order: ["A", "X", "B"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()

    const delayedMigration = deferred<FolderOrderSyncRecord | null>()
    const migrateSpy = vi.spyOn(syncStore, "recordFolderOrderPathMigration").mockReturnValueOnce(delayedMigration.promise)
    const editSpy = vi.spyOn(syncStore, "recordFolderOrderVisibleEdit")

    act(() => current!.migrateFolderOrderPath("A", "A2", { key: "vault-a", syncCacheId: "vault-a" }))
    await flushAsync()
    expect(migrateSpy).toHaveBeenCalledOnce()

    act(() => current!.updateFolderOrder(["B", "A2"]))
    await flushAsync()
    expect(current!.folderOrder).toEqual(["B", "X", "A2"])
    expect(editSpy).not.toHaveBeenCalled()

    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["A2", "X", "B"]
        draft.localGeneration = 2
        draft.pendingIntent = { generation: 2, order: ["A2", "X", "B"], origin: "edit" }
      })
      delayedMigration.resolve(syncRecordFixture("vault-a", {
        localGeneration: 2,
        localOrder: ["A2", "X", "B"],
        pendingIntent: { generation: 2, order: ["A2", "X", "B"], origin: "edit" },
      }))
    })
    await flushAsync()

    expect(editSpy).toHaveBeenCalledOnce()
    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.localOrder).toEqual(["B", "X", "A2"])
    expect(record?.pendingIntent?.order).toEqual(["B", "X", "A2"])
  })

  it("较早写入的回调迟到时，不覆盖后续远端只读采用的顺序", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 1
      draft.base = { changeId: "old", etag: '"e1"', exists: true, order: ["A", "B"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()

    const delayedEdit = deferred<FolderOrderSyncRecord | null>()
    vi.spyOn(syncStore, "recordFolderOrderVisibleEdit").mockReturnValueOnce(delayedEdit.promise)

    act(() => current!.updateFolderOrder(["B", "A"]))
    expect(current!.folderOrder).toEqual(["B", "A"])

    await act(async () => {
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["B", "A"]
        draft.localGeneration = 2
        draft.pendingIntent = { generation: 2, order: ["B", "A"], origin: "edit" }
      })
      await updateFolderOrderSyncRecord("vault-a", (draft) => {
        draft.localOrder = ["远端"]
        draft.pendingIntent = null
        draft.base = { changeId: "remote", etag: '"e2"', exists: true, order: ["远端"] }
      })
      delayedEdit.resolve(syncRecordFixture("vault-a", {
        localGeneration: 2,
        localOrder: ["B", "A"],
        pendingIntent: { generation: 2, order: ["B", "A"], origin: "edit" },
      }))
    })
    await flushAsync()

    expect(current!.folderOrder).toEqual(["远端"])
    expect(current!.folderOrderSync?.status).toBe("clean")
  })

  it("连续拖动与迁移交错：代次单调推进、成员不丢", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "X", "B"]
      draft.localGeneration = 1
      draft.base = { changeId: "c", etag: '"e"', exists: true, order: ["A", "X", "B"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()

    // 连续两次拖动提交。
    act(() => current!.updateFolderOrder(["B", "A"]))
    await flushAsync()
    expect((await loadFolderOrderSyncRecord("vault-a"))?.localOrder).toEqual(["B", "X", "A"])
    act(() => current!.updateFolderOrder(["A", "B"]))
    await flushAsync()
    expect((await loadFolderOrderSyncRecord("vault-a"))?.localOrder).toEqual(["A", "X", "B"])

    // 迁移与拖动交错。
    act(() => current!.migrateFolderOrderPath("A", "A2", { key: "vault-a", syncCacheId: "vault-a" }))
    await flushAsync()
    act(() => current!.updateFolderOrder(["B", "A2"]))
    await flushAsync()

    const record = await loadFolderOrderSyncRecord("vault-a")
    expect(record?.localOrder).toEqual(["B", "X", "A2"])
    expect(record?.localGeneration).toBe(5)
    expect(record?.pendingIntent?.order).toEqual(["B", "X", "A2"])
    expect(current!.folderOrder).toEqual(["B", "X", "A2"])
  })

  it("提交后事务未完成时切库：结果不落新库，旧库写入照常完成", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 1
      draft.base = { changeId: "ca", etag: '"ea"', exists: true, order: ["A", "B"] }
    })
    await getOrCreateFolderOrderSyncRecord("vault-b", null)
    await updateFolderOrderSyncRecord("vault-b", (draft) => {
      draft.localOrder = ["一", "二"]
      draft.localGeneration = 5
      draft.base = { changeId: "cb", etag: '"eb"', exists: true, order: ["一", "二"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()

    // 提交后事务仍在途即切库。
    act(() => current!.updateFolderOrder(["B", "A"]))
    switchLibrary("vault-b", "vault-b")
    await flushAsync()

    // 旧库写入按自身工作副本完成；新库的顺序与代次不被旧库事务结果触碰。
    expect((await loadFolderOrderSyncRecord("vault-a"))?.localOrder).toEqual(["B", "A"])
    const recordB = await loadFolderOrderSyncRecord("vault-b")
    expect(recordB?.localOrder).toEqual(["一", "二"])
    expect(recordB?.localGeneration).toBe(5)
    expect(current!.folderOrder).toEqual(["一", "二"])
  })
})

// 复审问题 2：异步迁移的失败回调不得污染其他库的 persistenceFailed。
describe("persistenceFailed 按库隔离（复审 #2）", () => {
  it("A 迁移等待期间切到 B，A 写入失败后 B 正常保存仍显示 persistenceFailed=false", async () => {
    await getOrCreateFolderOrderSyncRecord("vault-a", null)
    await updateFolderOrderSyncRecord("vault-a", (draft) => {
      draft.localOrder = ["A", "B"]
      draft.localGeneration = 1
      draft.base = { changeId: "ca", etag: '"ea"', exists: true, order: ["A", "B"] }
    })
    await getOrCreateFolderOrderSyncRecord("vault-b", null)
    await updateFolderOrderSyncRecord("vault-b", (draft) => {
      draft.localOrder = ["一", "二"]
      draft.localGeneration = 1
      draft.base = { changeId: "cb", etag: '"eb"', exists: true, order: ["一", "二"] }
    })
    mount("vault-a", "vault-a")
    await flushAsync()

    // 让 A 的迁移写卡在可控的 Promise 上，切库后再拒绝它。
    let rejectMigration!: (error: Error) => void
    const delayed = new Promise<null>((_resolve, reject) => { rejectMigration = reject })
    const spy = vi.spyOn(syncStore, "recordFolderOrderPathMigration").mockReturnValueOnce(delayed)
    act(() => current!.migrateFolderOrderPath("A", "A2"))
    await flushAsync()
    expect(spy).toHaveBeenCalledOnce()

    switchLibrary("vault-b", "vault-b")
    await flushAsync()
    expect(current!.folderOrderSync?.persistenceFailed).toBe(false)

    // A 的迁移写入失败到达时当前库已是 B：不得污染 B 的 persistenceFailed。
    rejectMigration(new Error("A write failed"))
    await flushAsync()

    // B 后续正常订阅更新/保存：persistenceFailed 必须仍为 false。
    await act(async () => {
      await updateFolderOrderSyncRecord("vault-b", (draft) => {
        draft.localOrder = ["二", "一"]
        draft.base = { changeId: "cb2", etag: '"eb2"', exists: true, order: ["二", "一"] }
      })
    })
    expect(current!.folderOrderSync?.persistenceFailed).toBe(false)
    act(() => current!.updateFolderOrder(["一", "二"]))
    await flushAsync()
    expect(current!.folderOrderSync?.persistenceFailed).toBe(false)
    expect((await loadFolderOrderSyncRecord("vault-b"))?.pendingIntent?.order).toEqual(["一", "二"])
  })
})
