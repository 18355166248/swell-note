// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useFolderOrder } from "./use-folder-order"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type HookValue = ReturnType<typeof useFolderOrder>

let container: HTMLElement | null = null
let root: Root | null = null
let current: HookValue | null = null

function Probe({ libraryKey }: { libraryKey: string }) {
  current = useFolderOrder(libraryKey)
  return null
}

function mount(libraryKey: string) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<Probe libraryKey={libraryKey} />)
  })
}

function rerender(libraryKey: string) {
  act(() => {
    root!.render(<Probe libraryKey={libraryKey} />)
  })
}

function unmount() {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  current = null
}

function storedOrders() {
  const raw = window.localStorage.getItem("swell-note:folder-order:v1")
  return raw ? JSON.parse(raw) as Record<string, string[]> : {}
}

beforeEach(() => window.localStorage.clear())

afterEach(() => {
  unmount()
  vi.restoreAllMocks()
})

describe("useFolderOrder", () => {
  it("重新挂载后从本地存储恢复顺序", () => {
    mount("vault-a")
    act(() => current!.updateFolderOrder(["Beta", "Alpha"]))
    unmount()

    mount("vault-a")
    expect(current!.folderOrder).toEqual(["Beta", "Alpha"])
  })

  it("不同笔记库的顺序互相隔离", () => {
    mount("vault-a")
    act(() => current!.updateFolderOrder(["Beta", "Alpha"]))
    rerender("vault-b")

    expect(current!.folderOrder).toEqual([])
    act(() => current!.updateFolderOrder(["Gamma"]))
    expect(storedOrders()).toEqual({ "vault-a": ["Beta", "Alpha"], "vault-b": ["Gamma"] })

    rerender("vault-a")
    expect(current!.folderOrder).toEqual(["Beta", "Alpha"])
  })

  it("顺序没有变化时不写盘", () => {
    mount("vault-a")
    act(() => current!.updateFolderOrder(["Alpha", "Beta"]))
    const writeSpy = vi.spyOn(Storage.prototype, "setItem")

    act(() => current!.updateFolderOrder(["Alpha", "Beta"]))
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it("localStorage 不可用时仍保留会话内顺序", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied") })

    mount("vault-a")
    expect(current!.folderOrder).toEqual([])
    act(() => current!.updateFolderOrder(["Beta", "Alpha"]))
    // 状态留在内存里：布局切换只换子组件，App 层这份状态不丢。
    expect(current!.folderOrder).toEqual(["Beta", "Alpha"])
  })

  it("重命名迁移命中才写盘，未命中保持原顺序", () => {
    mount("vault-a")
    act(() => current!.updateFolderOrder(["Alpha", "Beta", "Gamma"]))

    act(() => current!.migrateFolderOrderPath("Missing", "Delta"))
    expect(current!.folderOrder).toEqual(["Alpha", "Beta", "Gamma"])

    act(() => current!.migrateFolderOrderPath("Beta", "Delta"))
    expect(current!.folderOrder).toEqual(["Alpha", "Delta", "Gamma"])
    expect(storedOrders()["vault-a"]).toEqual(["Alpha", "Delta", "Gamma"])
  })

  it("重命名异步完成后才迁移：切库期间只写发起库，不污染当前库", () => {
    mount("vault-a")
    act(() => current!.updateFolderOrder(["Shared", "A-only"]))
    // 模拟重命名发起：调用链在此刻闭包捕获发起库的迁移回调，随后才进入异步等待。
    const migrateFromVaultA = current!.migrateFolderOrderPath

    rerender("vault-b")
    act(() => current!.updateFolderOrder(["B-only", "Shared"]))

    // 异步完成时当前库已经是 B：只允许迁移 A 的那一份。
    act(() => migrateFromVaultA("Shared", "Renamed-in-A"))

    // B 的内存顺序不变，A 的持久化槽位被正确迁移，B 的槽位原样保留。
    expect(current!.folderOrder).toEqual(["B-only", "Shared"])
    expect(storedOrders()).toEqual({
      "vault-a": ["Renamed-in-A", "A-only"],
      "vault-b": ["B-only", "Shared"],
    })

    // 切回 A 后能看到迁移结果，同名目录不受影响的一侧保持原样。
    rerender("vault-a")
    expect(current!.folderOrder).toEqual(["Renamed-in-A", "A-only"])
  })

  it("重命名异步完成但未命中发起库路径：两个库都不写", () => {
    mount("vault-a")
    act(() => current!.updateFolderOrder(["Alpha"]))
    const migrateFromVaultA = current!.migrateFolderOrderPath

    rerender("vault-b")
    act(() => current!.updateFolderOrder(["Gamma"]))
    const writeSpy = vi.spyOn(Storage.prototype, "setItem")

    act(() => migrateFromVaultA("Missing", "Delta"))

    expect(writeSpy).not.toHaveBeenCalled()
    expect(current!.folderOrder).toEqual(["Gamma"])
    expect(storedOrders()).toEqual({ "vault-a": ["Alpha"], "vault-b": ["Gamma"] })
  })

  it("延迟迁移与发起库后续排序先后到达时按顺序叠加", () => {
    mount("vault-a")
    act(() => current!.updateFolderOrder(["Shared", "A-only"]))
    const migrateFromVaultA = current!.migrateFolderOrderPath

    rerender("vault-b")
    act(() => current!.updateFolderOrder(["B-only"]))

    // A 的异步重命名先完成，随后 A 又有一次拖动提交（闭包同样来自发起时的 A）。
    act(() => migrateFromVaultA("Shared", "Renamed-in-A"))
    rerender("vault-a")
    act(() => current!.updateFolderOrder(["A-only", "Renamed-in-A"]))

    expect(current!.folderOrder).toEqual(["A-only", "Renamed-in-A"])
    expect(storedOrders()["vault-a"]).toEqual(["A-only", "Renamed-in-A"])
    expect(storedOrders()["vault-b"]).toEqual(["B-only"])
  })
})
