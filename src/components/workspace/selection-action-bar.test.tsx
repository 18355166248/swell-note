// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"

import { SelectionActionBar } from "./selection-action-bar"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement | null = null
let root: Root | null = null

function createEditor(overrides: Partial<MarkdownEditorHandle> = {}) {
  return {
    collapseSelection: vi.fn(),
    copySelection: vi.fn().mockResolvedValue(true),
    cutSelection: vi.fn().mockResolvedValue(true),
    focus: vi.fn(),
    findText: vi.fn(),
    insertText: vi.fn(),
    pasteAtSelection: vi.fn().mockResolvedValue(true),
    redo: vi.fn(),
    replaceAll: vi.fn(),
    replaceCurrent: vi.fn(),
    revealLine: vi.fn(),
    selectAll: vi.fn(),
    undo: vi.fn(),
    ...overrides,
  } as unknown as MarkdownEditorHandle
}

function mount(editor: MarkdownEditorHandle, readOnly = false) {
  const ref = createRef<MarkdownEditorHandle>()
  ;(ref as { current: MarkdownEditorHandle | null }).current = editor
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<SelectionActionBar editorRef={ref} readOnly={readOnly} />)
  })
  return {
    button: (label: string) => container!.querySelector<HTMLButtonElement>(`[aria-label='${label}']`),
    hint: () => container!.querySelector("[role='status']")?.textContent ?? "",
  }
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  vi.restoreAllMocks()
})

describe("SelectionActionBar", () => {
  it("复制按钮把选区交给编辑器", async () => {
    const editor = createEditor()
    const bar = mount(editor)

    await click(bar.button("复制")!)

    expect(editor.copySelection).toHaveBeenCalledTimes(1)
    expect(bar.hint()).toBe("")
  })

  it("剪切与粘贴各自走对应的编辑器方法", async () => {
    const editor = createEditor()
    const bar = mount(editor)

    await click(bar.button("剪切")!)
    await click(bar.button("粘贴")!)

    expect(editor.cutSelection).toHaveBeenCalledTimes(1)
    expect(editor.pasteAtSelection).toHaveBeenCalledTimes(1)
  })

  it("全选是同步操作，不产生失败提示", async () => {
    const editor = createEditor()
    const bar = mount(editor)

    await click(bar.button("全选")!)

    expect(editor.selectAll).toHaveBeenCalledTimes(1)
    expect(bar.hint()).toBe("")
  })

  it("剪贴板读不到内容时提示用户，而不是静默无反应", async () => {
    const editor = createEditor({ pasteAtSelection: vi.fn().mockResolvedValue(false) })
    const bar = mount(editor)

    await click(bar.button("粘贴")!)

    expect(bar.hint()).toBe("读不到剪贴板内容")
  })

  it("复制失败同样给出提示", async () => {
    const editor = createEditor({ copySelection: vi.fn().mockResolvedValue(false) })
    const bar = mount(editor)

    await click(bar.button("复制")!)

    expect(bar.hint()).toBe("复制失败")
  })

  it("只读笔记留下复制与全选，收起改写类按钮", () => {
    const bar = mount(createEditor(), true)

    expect(bar.button("复制")).not.toBeNull()
    expect(bar.button("全选")).not.toBeNull()
    expect(bar.button("剪切")).toBeNull()
    expect(bar.button("粘贴")).toBeNull()
  })

  it("只读时接手底部安全区留白，因为下面没有格式工具栏了", () => {
    mount(createEditor(), true)

    expect(container!.querySelector(".selection-action-bar")?.getAttribute("data-standalone")).toBe("true")
  })

  it("按钮按下不抢走编辑器焦点，否则选区会在复制前消失", async () => {
    const bar = mount(createEditor())
    const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true })

    await act(async () => {
      bar.button("复制")!.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })
})
