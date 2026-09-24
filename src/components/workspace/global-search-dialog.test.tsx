// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GlobalSearchDialog } from "./global-search-dialog"
import type { Note } from "@/types/note"

const cachedSearch = vi.hoisted(() => vi.fn())
vi.mock("@/services/cache/vault-cache", () => ({ searchCachedNoteDocuments: cachedSearch }))
vi.mock("@/services/search/sqlite-note-index", () => ({ supportsNativeSearchIndex: () => false }))
vi.mock("./note-search-match", () => ({ HighlightedText: ({ text }: { text: string }) => text, useSearchMatch: (note: Note) => note.preview }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
const notes: Note[] = Array.from({ length: 65 }, (_, i) => ({ id: `note-${i}`, title: `测试 ${i}`, content: "正文", preview: "测试正文", updatedAt: "刚刚", starred: false }))
beforeEach(() => {
  vi.useFakeTimers()
  cachedSearch.mockResolvedValue([])
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers() })
function render(cacheId: string | null = null, searchNotes = notes) {
  const onSelectNote = vi.fn(), onOpenChange = vi.fn()
  act(() => root.render(<GlobalSearchDialog cacheId={cacheId} notes={searchNotes} onOpenChange={onOpenChange} onSelectNote={onSelectNote} open />))
  return { onSelectNote, onOpenChange }
}
function input() { return document.querySelector<HTMLInputElement>('[role="combobox"]')! }
function query(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value)
    input().dispatchEvent(new Event("input", { bubbles: true }))
  })
}
function key(key: string, options: KeyboardEventInit = {}) {
  act(() => { input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options })) })
}
function click(label: string) {
  act(() => { document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click() })
}
function select(label: string, value: string) {
  act(() => {
    const element = document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!
    element.value = value
    element.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
describe("global search interactions", () => {
  it("combines tag, folder, recent update and starred filters without a text query", () => {
    const recent = Date.now()
    render(null, [
      { ...notes[0], folder: "项目", tags: ["工作"], modifiedAt: recent, starred: true },
      { ...notes[1], folder: "项目", tags: ["工作"], modifiedAt: recent, starred: false },
      { ...notes[2], folder: "项目", tags: ["工作"], modifiedAt: recent - 100 * 24 * 60 * 60 * 1000, starred: true },
    ])
    select("筛选标签", "工作")
    select("筛选目录", "项目")
    select("筛选更新时间", "7")
    select("筛选收藏状态", "starred")
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(document.body.textContent).toContain("找到 1 篇")
  })
  it("uses title and tag query operators without searching cached body", () => {
    const { onSelectNote } = render("cache", [
      { ...notes[0], title: "会议 纪要", tags: ["项目 规划"] },
      { ...notes[1], title: "会议 纪要", tags: ["其他"] },
    ])
    query('title:"会议 纪要" tag:"项目 规划"')
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(document.body.textContent).toContain("找到 1 篇")
    expect(cachedSearch).not.toHaveBeenCalled()
    key("Enter")
    expect(onSelectNote).toHaveBeenCalledWith(expect.objectContaining({ id: "note-0" }), "会议 纪要")
  })
  it("paginates results without hiding the total and scrolls its own viewport for keyboard selection", () => {
    render(); query("测试")
    const viewport = document.querySelector<HTMLElement>("[data-search-scroll-viewport]")!
    Object.defineProperties(viewport, { clientHeight: { configurable: true, value: 240 }, scrollHeight: { configurable: true, value: 6000 } })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-search-scroll-viewport")) {
        return { bottom: 340, height: 240, left: 0, right: 400, top: 100, width: 400, x: 0, y: 100, toJSON: () => ({}) }
      }
      const top = 100 + Number(this.dataset?.index ?? 0) * 80 - viewport.scrollTop
      return { bottom: top + 80, height: 80, left: 0, right: 400, top, width: 400, x: 0, y: top, toJSON: () => ({}) }
    })
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(50)
    expect(document.body.textContent).toContain("找到 65 篇，已显示 50 篇")
    for (let i = 0; i < 50; i++) key("ArrowDown")
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(65)
    const active = document.querySelector('[aria-selected="true"]')!
    expect(active.getAttribute("data-index")).toBe("50")
    expect(input().getAttribute("aria-activedescendant")).toBe(active.id)
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    expect(viewport.scrollTop).toBeGreaterThan(0)
  })
  it("loads the next page by button and preserves input navigation bounds", () => {
    render(); query("测试")
    act(() => document.querySelector<HTMLButtonElement>(".global-search-more")!.click())
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(65)
    key("ArrowUp")
    expect(document.querySelector('[aria-selected="true"]')?.getAttribute("data-index")).toBe("0")
  })
  it("ignores IME confirmation and passes the search term when opening a note", () => {
    const { onSelectNote } = render(); query("测试")
    key("Enter", { isComposing: true }); key("Enter", { keyCode: 229 })
    expect(onSelectNote).not.toHaveBeenCalled()
    key("Enter")
    expect(onSelectNote).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("测试") }), "测试")
  })
  it("clears and closes explicitly without selecting a result", () => {
    const { onSelectNote, onOpenChange } = render(); query("测试")
    click("清空搜索")
    expect(input().value).toBe("")
    expect(document.activeElement).toBe(input())
    click("关闭全局搜索")
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSelectNote).not.toHaveBeenCalled()
  })
  it("waits for asynchronous search before announcing no matches", async () => {
    let resolve!: (paths: string[]) => void
    cachedSearch.mockReturnValue(new Promise<string[]>((done) => { resolve = done }))
    render("cache"); query("不存在")
    expect(document.body.textContent).toContain("正在搜索正文")
    expect(document.body.textContent).not.toContain("没有找到匹配")
    await act(async () => { vi.advanceTimersByTime(120) })
    await act(async () => resolve([]))
    expect(document.body.textContent).toContain("没有找到匹配")
  })
  it("reports an unavailable body index without claiming a complete empty result", async () => {
    cachedSearch.mockRejectedValueOnce(new Error("IndexedDB unavailable"))
    render("cache", [{ ...notes[0], title: "其他笔记", preview: "" }])
    query("仅在缓存正文")
    await act(async () => { vi.advanceTimersByTime(120) })
    expect(document.body.textContent).toContain("正文索引暂不可用，结果可能不完整")
    expect(document.body.textContent).toContain("当前没有已加载笔记匹配")
    expect(document.body.textContent).not.toContain("没有找到匹配的笔记")

    query("其他笔记")
    await act(async () => { vi.advanceTimersByTime(120) })
    expect(document.body.textContent).not.toContain("正文索引暂不可用")
    expect(document.body.textContent).toContain("找到 1 篇")
  })
})
