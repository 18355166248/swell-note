// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import { noteReadingPositions, readingPositionKey } from "@/services/navigation/note-reading-position"
import { useNoteReadingPosition } from "./use-note-reading-position"
import { flushLifecycleSave } from "@/services/vault/save-lifecycle"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
let element: HTMLDivElement
let count = 0
let noteId: string
let editor: { current: MarkdownEditorHandle | null }
let visible: number
const saved = { anchor: { line: 3, text: "原段", fraction: .2 }, scrollTop: 500 }
const onAnchor = vi.fn()
function Harness({ searchTarget = false, active = true, id = noteId, identity = noteId }: { searchTarget?: boolean; active?: boolean; id?: string; identity?: string }) {
  useNoteReadingPosition({ active, cacheId: "test", content: "甲\n乙\n原段", editor, identity, noteId: id, onAnchor, ready: true, searchTarget, viewport: { current: element } })
  return null
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => window.setTimeout(() => fn(0), 16))
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id))
  container = document.createElement("div")
  document.body.appendChild(container)
  element = document.createElement("div")
  visible = 400
  Object.defineProperty(element, "clientHeight", { get: () => visible })
  Object.defineProperty(element, "scrollHeight", { get: () => 2000 })
  container.appendChild(element)
  root = createRoot(container)
  noteId = `note-${++count}`
  editor = { current: {
    readingAnchorAtViewportTop: vi.fn(() => saved.anchor),
    restoreReadingAnchor: vi.fn((_anchor, viewport) => { viewport.scrollTop = 500; return true }),
  } as unknown as MarkdownEditorHandle }
  onAnchor.mockClear()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const key = () => readingPositionKey("test", noteId)
function render(props = {}) { act(() => root.render(<Harness {...props} />)) }
function advance(time: number) { act(() => vi.advanceTimersByTime(time)) }

describe("reading position lifecycle", () => {
  it("懒加载晚挂载仍恢复，恢复途中不记录估算的顶部位置", () => {
    noteReadingPositions.set(key(), saved)
    const control = editor.current
    editor.current = null
    render()
    advance(200)
    expect(noteReadingPositions.get(key())).toEqual(saved)
    editor.current = control
    advance(300)
    expect(element.scrollTop).toBe(500)
    expect(control!.restoreReadingAnchor).toHaveBeenCalled()
  })

  it("搜索定位优先，不能再用历史位置覆盖搜索命中", () => {
    noteReadingPositions.set(key(), saved)
    element.scrollTop = 800
    render({ searchTarget: true })
    advance(1000)
    expect(editor.current!.restoreReadingAnchor).not.toHaveBeenCalled()
    expect(element.scrollTop).toBe(800)
  })

  it("隐藏布局卸载不会把另一份布局的位置覆盖成零", () => {
    noteReadingPositions.set(key(), saved)
    visible = 0
    render()
    advance(1000)
    act(() => root.unmount())
    expect(noteReadingPositions.get(key())).toEqual(saved)
    root = createRoot(container)
  })

  it("手动滚动终止恢复，进入后台在停顿定时器之前保存最新位置", () => {
    noteReadingPositions.set(key(), saved)
    render()
    advance(16)
    element.dispatchEvent(new Event("wheel"))
    element.scrollTop = 900
    window.dispatchEvent(new Event("pagehide"))
    advance(100)
    expect(element.scrollTop).toBe(900)
    expect(noteReadingPositions.get(key())?.scrollTop).toBe(900)
    element.scrollTop = 0
    window.dispatchEvent(new Event("pagehide"))
    expect(noteReadingPositions.get(key())).toEqual({ anchor: null, scrollTop: 0 })
  })

  it("重命名迁移记录，隐藏的新布局不能覆盖迁移结果", () => {
    render()
    element.scrollTop = 500
    window.dispatchEvent(new Event("pagehide"))
    visible = 0
    render({ id: "renamed", identity: noteId })
    expect(noteReadingPositions.get(readingPositionKey("test", "renamed"))).toEqual(saved)
    expect(noteReadingPositions.get(key())).toBeNull()
  })

  it("切笔记清理不能读取已经换上的新正文，原生关闭走即时保存", async () => {
    render()
    element.scrollTop = 500
    await act(async () => { await flushLifecycleSave("close") })
    expect(noteReadingPositions.get(key())).toEqual(saved)
    element.scrollTop = 20
    vi.mocked(editor.current!.readingAnchorAtViewportTop).mockReturnValue({ line: 1, text: "新笔记", fraction: 0 })
    render({ id: "other-note", identity: "other-note" })
    expect(noteReadingPositions.get(key())).toEqual(saved)
    expect(element.scrollTop).toBe(0)
  })
})
