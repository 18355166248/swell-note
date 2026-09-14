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
