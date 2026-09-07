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
const scroll = vi.fn()
const notes: Note[] = Array.from({ length: 65 }, (_, i) => ({ id: `note-${i}`, title: `测试 ${i}`, content: "正文", preview: "测试正文", updatedAt: "刚刚", starred: false }))
beforeEach(() => {
  vi.useFakeTimers()
  HTMLElement.prototype.scrollIntoView = scroll
  scroll.mockClear()
  cachedSearch.mockResolvedValue([])
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })
function render(cacheId: string | null = null) {
  const onSelectNote = vi.fn(), onOpenChange = vi.fn()
  act(() => root.render(<GlobalSearchDialog cacheId={cacheId} notes={notes} onOpenChange={onOpenChange} onSelectNote={onSelectNote} open />))
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
describe("global search interactions", () => {
  it("paginates results without hiding the total and scrolls keyboard selection into view", () => {
    render(); query("测试")
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(50)
    expect(document.body.textContent).toContain("找到 65 篇，已显示 50 篇")
    for (let i = 0; i < 50; i++) key("ArrowDown")
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(65)
    const active = document.querySelector('[aria-selected="true"]')!
    expect(active.getAttribute("data-index")).toBe("50")
    expect(input().getAttribute("aria-activedescendant")).toBe(active.id)
    expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" })
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
})
