// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"

import { FolderSortDndContext } from "./folder-sort-dnd"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}
globalThis.ResizeObserver = ResizeObserverStub

let container: HTMLElement | null = null
let root: Root | null = null

function SortableItem({ id }: { id: string }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef } = useSortable({ id })
  return (
    <div className="sortable-item" ref={setNodeRef}>
      <button aria-label={`拖动排序 ${id}`} ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" />
      <span>{id}</span>
    </div>
  )
}

const PATHS = ["Alpha", "Beta"]

function Harness({ enabled, onCommit }: { enabled: boolean; onCommit: (next: string[]) => void }) {
  return (
    <FolderSortDndContext enabled={enabled} folderOrderKey="cache-1" onCommit={onCommit} sortableFolderPaths={PATHS}>
      <SortableContext items={PATHS} strategy={verticalListSortingStrategy}>
        {PATHS.map((id) => <SortableItem id={id} key={id} />)}
      </SortableContext>
    </FolderSortDndContext>
  )
}

function mount(enabled: boolean, onCommit: (next: string[]) => void) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<Harness enabled={enabled} onCommit={onCommit} />)
  })
  return container
}

function rerender(enabled: boolean, onCommit: (next: string[]) => void) {
  act(() => {
    root!.render(<Harness enabled={enabled} onCommit={onCommit} />)
  })
}

// dnd-kit 依赖布局测量判断落点；jsdom 没有真实布局，按 DOM 顺序给每个可排序项一个矩形。
function mockSortableRects() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const element = this as HTMLElement
    if (element.classList?.contains("sortable-item")) {
      const items = [...document.querySelectorAll(".sortable-item")]
      const index = Math.max(0, items.indexOf(element))
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

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  vi.restoreAllMocks()
})

describe("FolderSortDndContext", () => {
  it("enabled 关闭后进行中的拖动永久失效；重新开启后新拖动正常提交", async () => {
    mockSortableRects()
    const onCommit = vi.fn()
    const panel = mount(true, onCommit)

    const handle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Beta']")!
    act(() => handle.focus())
    pressKey(handle, "Space")
    await waitForKeyboardSensor()
    pressKey(handle, "ArrowUp")

    // 移动端退出管理模式走的就是这条路径：组件不卸载，enabled 变 false。
    // 会话永久失效且传感器被主动取消，确认键不再提交。
    rerender(false, onCommit)
    pressKey(document.body as HTMLElement, "Space")
    expect(onCommit).not.toHaveBeenCalled()

    // 失效终止走传感器取消管线，dnd 内部状态已复位：重新开启后新拖动正常。
    rerender(true, onCommit)
    const newHandle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Beta']")!
    act(() => newHandle.focus())
    pressKey(newHandle, "Space")
    await waitForKeyboardSensor()
    pressKey(newHandle, "ArrowUp")
    pressKey(newHandle, "Space")
    expect(onCommit).toHaveBeenCalledWith(["Beta", "Alpha"])
  })

  it("正常确认与取消都清理本次会话，后续拖动不受影响", async () => {
    mockSortableRects()
    const onCommit = vi.fn()
    const panel = mount(true, onCommit)

    // 先取消一次。
    const handle = panel.querySelector<HTMLButtonElement>("[aria-label='拖动排序 Beta']")!
    act(() => handle.focus())
    pressKey(handle, "Space")
    await waitForKeyboardSensor()
    pressKey(handle, "ArrowUp")
    pressKey(handle, "Escape")
    expect(onCommit).not.toHaveBeenCalled()

    // 再确认一次：顺序基于取消前的原始列表。
    pressKey(handle, "Space")
    await waitForKeyboardSensor()
    pressKey(handle, "ArrowUp")
    pressKey(handle, "Space")
    expect(onCommit).toHaveBeenCalledWith(["Beta", "Alpha"])
  })
})
