// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import type { EditorFormatState } from "@/components/editor/markdown-input"
import { TooltipProvider } from "@/components/ui/tooltip"

import { FormattingToolbar } from "./formatting-toolbar"
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

describe("FormattingToolbar 选区模式（移动端选区操作并入格式栏）", () => {
  function mountToolbar(editor: MarkdownEditorHandle, hasSelection: boolean, options: {
    formatState?: EditorFormatState
    mobile?: boolean
    onFormat?: (syntax: string) => void
  } = {}) {
    const ref = createRef<MarkdownEditorHandle>()
    ;(ref as { current: MarkdownEditorHandle | null }).current = editor
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <TooltipProvider>
          <FormattingToolbar
            attachmentBusy={false}
            canInsertAttachment={false}
            editorRef={ref}
            formatState={options.formatState}
            hasSelection={hasSelection}
            mobile={options.mobile ?? true}
            onFormat={options.onFormat ?? vi.fn()}
            onInsertFiles={vi.fn().mockResolvedValue(undefined)}
          />
        </TooltipProvider>,
      )
    })
    return {
      button: (label: string) => container!.querySelector<HTMLButtonElement>(`[aria-label^='${label}']`),
      toolbar: () => container!.querySelector(".formatting-toolbar"),
    }
  }

  it("有选区时复制/剪切/粘贴/全选进入格式栏，低频入口让位", () => {
    const bar = mountToolbar(createEditor(), true)

    expect(bar.toolbar()?.getAttribute("data-selection-mode")).toBe("true")
    expect(bar.button("复制")).not.toBeNull()
    expect(bar.button("剪切")).not.toBeNull()
    expect(bar.button("粘贴")).not.toBeNull()
    expect(bar.button("全选")).not.toBeNull()
    // 选中后的下一步高频操作（加粗/斜体）必须留在原地。
    expect(bar.button("加粗")).not.toBeNull()
    expect(bar.button("斜体")).not.toBeNull()
    // 标题选择器与撤销等低频入口在选区模式下让位。
    expect(container!.querySelector(".toolbar-heading-select")).toBeNull()
    expect(bar.button("撤销")).toBeNull()
  })

  it("无选区时保持常规格式栏，不出现选区操作", () => {
    const bar = mountToolbar(createEditor(), false)

    expect(bar.toolbar()?.getAttribute("data-selection-mode")).toBeNull()
    expect(bar.button("复制")).toBeNull()
    expect(container!.querySelector(".toolbar-heading-select")).not.toBeNull()
    expect(bar.button("撤销")).not.toBeNull()
  })

  it("选区模式里的复制同样走编辑器方法", async () => {
    const editor = createEditor()
    const bar = mountToolbar(editor, true)

    await click(bar.button("复制")!)

    expect(editor.copySelection).toHaveBeenCalledTimes(1)
  })

  it("桌面提供有序列表入口并高亮当前块格式", () => {
    const bar = mountToolbar(createEditor(), false, {
      formatState: { bulletList: false, code: false, emphasis: false, heading: 4, orderedList: true, quote: true, strike: false, strong: false, taskList: false },
      mobile: false,
    })

    expect(bar.button("有序列表")?.getAttribute("data-active")).toBe("true")
    expect(bar.button("引用")?.getAttribute("data-active")).toBe("true")
    expect(container!.querySelector(".toolbar-heading-select")?.textContent).toContain("四级标题")
  })

  it("标题下拉选项仍将对应 Markdown 前缀交给编辑器", () => {
    const onFormat = vi.fn()
    mountToolbar(createEditor(), false, { mobile: false, onFormat })

    act(() => {
      const trigger = container!.querySelector<HTMLButtonElement>(".toolbar-heading-select")!
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })
    act(() => {
      Array.from(document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'))
        .find((item) => item.textContent?.trim() === "二级标题")!.click()
    })

    expect(onFormat).toHaveBeenCalledWith("\n## ")
  })

  it("移动端把有序列表放在更多菜单且仍报告激活状态", async () => {
    const onFormat = vi.fn()
    const bar = mountToolbar(createEditor(), false, {
      formatState: { bulletList: false, code: false, emphasis: false, heading: 0, orderedList: true, quote: false, strike: false, strong: false, taskList: false },
      onFormat,
    })

    expect(bar.button("有序列表")).toBeNull()
    await click(bar.button("更多格式")!)
    const ordered = Array.from(container!.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((button) => button.textContent === "有序列表")!
    expect(ordered.getAttribute("data-active")).toBe("true")
    await click(ordered)
    expect(onFormat).toHaveBeenCalledWith("\n1. ")
  })
})
