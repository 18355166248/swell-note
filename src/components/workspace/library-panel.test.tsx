// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { VaultFolder } from "@/services/search/vault-folders"

import { LibraryPanel, type LibraryPanelProps } from "./workspace"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}
globalThis.ResizeObserver = ResizeObserverStub

const folder: VaultFolder = { count: 29, depth: 0, hasChildren: false, label: "XIMA广告", path: "XIMA广告" }
let container: HTMLElement | null = null
let root: Root | null = null
function createProps(overrides: Partial<LibraryPanelProps> = {}): LibraryPanelProps {
  return {
    activeCacheId: "cache-1",
    canCreateFolder: true,
    canCreateNote: true,
    connected: true,
    connectionLabel: "已连接坚果云",
    expandedFolderPaths: new Set(),
    folderContextActions: { canCreateNote: true, disabled: false, mode: "webdav", onCreateNote: vi.fn(), onOpen: vi.fn(), onRequest: vi.fn() },
    folderOrderKey: "cache-1",
    folders: [folder],
    isCreatingNote: false,
    isManagingFolder: false,
    isOpeningVault: false,
    isRefreshingVault: false,
    libraryView: "all",
    localVaultSupported: true,
    noteCount: 102,
    onCreateFolder: vi.fn(),
    onCreateNote: vi.fn(),
    onFolderOrderChange: vi.fn(),
    onImportNotes: vi.fn(),
    onOpenLocalVault: vi.fn(),
    onOpenSettings: vi.fn(),
    onRefreshVault: vi.fn(),
    onSelectFolder: vi.fn(),
    onSelectLibraryView: vi.fn(),
    onSelectVaultCache: vi.fn(),
    onToggleFolder: vi.fn(),
    selectedFolder: "XIMA广告",
    starredNoteCount: 7,
    syncLabel: "5 项修改待同步",
    vaultCaches: [{ activeNoteId: "note-1", id: "cache-1", label: "坚果云 · /Swell/很长的笔记库名称", lastSyncedAt: Date.now(), noteCount: 102, savedAt: Date.now(), sourceKind: "webdav" }],
    vaultError: null,
    ...overrides,
  }
}

function mount(props: LibraryPanelProps) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<MemoryRouter><TooltipProvider><LibraryPanel {...props} /></TooltipProvider></MemoryRouter>)
  })
  return container
}

function rerender(props: LibraryPanelProps) {
  act(() => {
    root!.render(<MemoryRouter><TooltipProvider><LibraryPanel {...props} /></TooltipProvider></MemoryRouter>)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  vi.restoreAllMocks()
})

describe("LibraryPanel", () => {
  it("首屏直接展示文件夹并把低频操作收进菜单", () => {
    const props = createProps()
    const panel = mount(props)

    expect(panel.querySelector(".library-folder-title")?.textContent).toContain("文件夹")
    expect(panel.querySelector(".library-row-main")?.textContent).toContain("XIMA广告")
    expect(panel.querySelector<HTMLButtonElement>("[aria-label='新建笔记']")).not.toBeNull()
    expect(panel.querySelector<HTMLButtonElement>("[aria-label='更多笔记库操作']")).not.toBeNull()
    expect(panel.textContent).not.toContain("打开本地笔记库")
    expect(panel.querySelector(".cache-switcher-compact")?.getAttribute("title")).toBe("坚果云 · /Swell/很长的笔记库名称")
  })

  it("新建、文件夹选择与导入都调用生产回调", () => {
    const props = createProps()
    const panel = mount(props)

    act(() => panel.querySelector<HTMLButtonElement>("[aria-label='新建笔记']")!.click())
    act(() => panel.querySelector<HTMLButtonElement>(".library-row-main")!.click())
    const input = panel.querySelector<HTMLInputElement>("input[type='file']")!
    const file = new File(["# demo"], "demo.md", { type: "text/markdown" })
    Object.defineProperty(input, "files", { configurable: true, value: [file] })
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })))

    expect(props.onCreateNote).toHaveBeenCalledOnce()
    expect(props.onSelectFolder).toHaveBeenCalledWith("XIMA广告")
    expect(props.onImportNotes).toHaveBeenCalledWith([file])
  })

  it("跨目录视图优先显示当前视图，且只读状态禁用写入入口", () => {
    const panel = mount(createProps({ canCreateFolder: false, canCreateNote: false, libraryView: "recent", selectedFolder: "XIMA广告" }))

    expect(panel.querySelector("[aria-label='当前浏览：最近更新']")).not.toBeNull()
    expect(panel.querySelector<HTMLButtonElement>("[aria-label='新建笔记']")?.disabled).toBe(true)
    expect(panel.querySelector<HTMLInputElement>("input[type='file']")).not.toBeNull()
  })
})

describe("LibraryPanel 文件夹排序", () => {
  const sortableTree: VaultFolder[] = [
    { count: 3, depth: 0, hasChildren: false, label: "根目录", path: "根目录" },
    { count: 5, depth: 0, hasChildren: true, label: "Alpha", path: "Alpha" },
    { count: 2, depth: 1, hasChildren: false, label: "子一", path: "Alpha / 子一" },
    { count: 4, depth: 0, hasChildren: false, label: "Beta", path: "Beta" },
    { count: 1, depth: 0, hasChildren: false, label: "Gamma", path: "Gamma" },
  ]

  function mountSortable(overrides: Partial<LibraryPanelProps> = {}) {
    return mount(createProps({ expandedFolderPaths: new Set(["Alpha"]), folders: sortableTree, ...overrides }))
  }

  function enterManageMode(panel: HTMLElement) {
    act(() => panel.querySelector<HTMLButtonElement>("[aria-label='调整文件夹顺序']")!.click())
  }

  // dnd-kit 依赖布局测量判断落点；jsdom 没有真实布局，按 DOM 顺序给每个可排序行一个矩形。
  function mockSortableRects() {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const element = this as HTMLElement
      if (element.classList?.contains("library-folder-sortable")) {
        const rows = [...document.querySelectorAll(".library-folder-sortable")]
        const index = Math.max(0, rows.indexOf(element))
        return {
          bottom: (index + 1) * 34, height: 34, left: 0, right: 200, top: index * 34, width: 200, x: 0, y: index * 34,
          toJSON: () => ({}),
        } as DOMRect
      }
      return { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
  }

  function pressKey(element: HTMLElement, code: string) {
    act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code })) })
  }

  // KeyboardSensor 的后续按键监听在拖动启动后的下一个宏任务才挂到 document 上，这里等它挂上。
  async function waitForKeyboardSensor() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it("只有一个可排序目录时不提供排序入口", () => {
    const panel = mount(createProps())

    expect(panel.querySelector("[aria-label='调整文件夹顺序']")).toBeNull()
  })

  it("管理模式平铺顶层目录：普通目录显示手柄，根目录固定且无手柄", () => {
    const panel = mountSortable()
    enterManageMode(panel)

    const handles = [...panel.querySelectorAll<HTMLButtonElement>(".library-folder-drag-handle")]
    expect(handles.map((handle) => handle.getAttribute("aria-label"))).toEqual([
      "拖动排序 Alpha",
      "拖动排序 Beta",
      "拖动排序 Gamma",
    ])
    // 根目录钉在最前，用锁标识且不作为投放目标。
    const firstRow = panel.querySelector(".library-row")
    expect(firstRow?.textContent).toContain("根目录")
    expect(firstRow?.querySelector("[aria-label='系统目录，固定在最前']")).not.toBeNull()
    expect(firstRow?.querySelector(".library-folder-drag-handle")).toBeNull()
    // 管理模式不渲染子目录行，避免误拖子树内部。
    expect(panel.textContent).not.toContain("子一")

    act(() => panel.querySelector<HTMLButtonElement>("[aria-label='完成文件夹排序']")!.click())
    expect(panel.querySelector(".library-folder-drag-handle")).toBeNull()
    expect(panel.textContent).toContain("子一")
  })

  it("键盘排序：空格抓起、方向键移动、空格确认后上报新顺序", async () => {
    mockSortableRects()
    const props = createProps({ expandedFolderPaths: new Set(["Alpha"]), folders: sortableTree })
    const panel = mount(props)
    enterManageMode(panel)

    const handle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Alpha']")!
    act(() => handle.focus())
    pressKey(handle, "Space")
    await waitForKeyboardSensor()
    pressKey(handle, "ArrowDown")
    pressKey(handle, "Space")

    expect(props.onFolderOrderChange).toHaveBeenCalledWith(["Beta", "Alpha", "Gamma"])
  })

  it("键盘排序按 Esc 取消时不上报任何顺序", async () => {
    mockSortableRects()
    const props = createProps({ expandedFolderPaths: new Set(["Alpha"]), folders: sortableTree })
    const panel = mount(props)
    enterManageMode(panel)

    const handle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Beta']")!
    act(() => handle.focus())
    pressKey(handle, "Space")
    await waitForKeyboardSensor()
    pressKey(handle, "ArrowUp")
    pressKey(handle, "Escape")

    expect(props.onFolderOrderChange).not.toHaveBeenCalled()
  })

  it("排序模式下普通点击目录行触发导航，手柄点击不触发", () => {
    const props = createProps({ expandedFolderPaths: new Set(["Alpha"]), folders: sortableTree })
    const panel = mount(props)
    enterManageMode(panel)

    const alphaRow = panel.querySelectorAll<HTMLElement>(".library-folder-sortable")[0]
    act(() => alphaRow.querySelector<HTMLButtonElement>(".library-row-main")!.click())
    expect(props.onSelectFolder).toHaveBeenCalledWith("Alpha")

    vi.mocked(props.onSelectFolder).mockClear()
    act(() => alphaRow.querySelector<HTMLButtonElement>(".library-folder-drag-handle")!.click())
    expect(props.onSelectFolder).not.toHaveBeenCalled()
  })

  it("抓起后切换笔记库：旧拖动被卸载，确认/取消都不提交任何顺序", async () => {
    mockSortableRects()
    const props = createProps({ expandedFolderPaths: new Set(["Alpha"]), folders: sortableTree })
    const panel = mount(props)
    enterManageMode(panel)

    const handle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Beta']")!
    act(() => handle.focus())
    pressKey(handle, "Space")
    await waitForKeyboardSensor()
    pressKey(handle, "ArrowUp")

    // 拖动途中切库：DndContext 以 folderOrderKey 为 key 整体卸载，进行中的拖动随之取消。
    rerender({ ...props, folderOrderKey: "cache-2" })
    await waitForKeyboardSensor()
    pressKey(handle, "Space")
    pressKey(document.body as HTMLElement, "Space")

    expect(props.onFolderOrderChange).not.toHaveBeenCalled()

    // 切库后的新拖动上下文可用：重新抓起并确认才会上报，且顺序基于当前目录。
    const newHandle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Beta']")!
    act(() => newHandle.focus())
    pressKey(newHandle, "Space")
    await waitForKeyboardSensor()
    pressKey(newHandle, "ArrowUp")
    pressKey(newHandle, "Space")
    expect(props.onFolderOrderChange).toHaveBeenCalledWith(["Beta", "Alpha", "Gamma"])
  })

  it("退出管理模式后，旧拖动的确认键不再提交任何顺序", async () => {
    mockSortableRects()
    const props = createProps({ expandedFolderPaths: new Set(["Alpha"]), folders: sortableTree })
    const panel = mount(props)
    enterManageMode(panel)

    const handle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Beta']")!
    act(() => handle.focus())
    pressKey(handle, "Space")
    await waitForKeyboardSensor()
    pressKey(handle, "ArrowUp")

    // 拖动途中退出管理模式：DndContext 卸载，旧会话永久失效，旧传感器的 document
    // 监听被主动摘除——即使焦点回到页面再按确认键也不能触发提交。
    act(() => panel.querySelector<HTMLButtonElement>("[aria-label='完成文件夹排序']")!.click())
    pressKey(document.body as HTMLElement, "Space")

    expect(props.onFolderOrderChange).not.toHaveBeenCalled()
  })

  it("被拖目录消失后拖动立即失效；清理后同一挂载内的新拖动正常", async () => {
    mockSortableRects()
    const props = createProps({ expandedFolderPaths: new Set(["Alpha"]), folders: sortableTree })
    const panel = mount(props)
    enterManageMode(panel)

    const handle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Beta']")!
    act(() => handle.focus())
    pressKey(handle, "Space")
    await waitForKeyboardSensor()
    pressKey(handle, "ArrowUp")

    // Beta 从目录树消失（被删除或刷新后结构变化）：会话永久失效，确认键不提交。
    rerender({ ...props, folders: sortableTree.filter((folder) => folder.path !== "Beta") })
    pressKey(document.body as HTMLElement, "Space")
    expect(props.onFolderOrderChange).not.toHaveBeenCalled()

    // 失效终止走传感器取消管线，dnd 内部状态已复位：同一挂载内抓起 Gamma 仍可正常提交。
    const newHandle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Gamma']")!
    act(() => newHandle.focus())
    pressKey(newHandle, "Space")
    await waitForKeyboardSensor()
    pressKey(newHandle, "ArrowUp")
    pressKey(newHandle, "Space")
    expect(props.onFolderOrderChange).toHaveBeenCalledWith(["Gamma", "Alpha"])
  })
})
