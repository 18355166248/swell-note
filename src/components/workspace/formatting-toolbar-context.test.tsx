// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import { FormattingToolbar } from "./formatting-toolbar"

const menus = vi.hoisted(() => ({ changes: [] as Array<(value: string) => void>, closes: [] as Array<(event: { preventDefault: () => void }) => void> }))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange: (value: string) => void }) => { menus.changes.push(onValueChange); return children },
  SelectContent: ({ children, onCloseAutoFocus }: { children: React.ReactNode; onCloseAutoFocus: (event: { preventDefault: () => void }) => void }) => { menus.closes.push(onCloseAutoFocus); return children },
  SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
  SelectValue: () => null,
  SelectItem: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children, TooltipTrigger: ({ children }: { children: React.ReactNode }) => children, TooltipContent: () => null }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; menus.changes.length = 0; menus.closes.length = 0 })

function mount() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  const ref = createRef<MarkdownEditorHandle>()
  const focus = vi.fn(); ref.current = { focus } as unknown as MarkdownEditorHandle
  const format = vi.fn()
  let owner = {}
  const render = (key: number) => {
    const current = owner
    act(() => root!.render(<FormattingToolbar key={key} isContextCurrent={() => owner === current} editorRef={ref} attachmentBusy={false} canInsertAttachment={false} onFormat={format} onInsertFiles={() => {}} />))
  }
  render(0)
  return { ref, focus, format, render, retire: () => { owner = {} } }
}

describe("formatting menu owner lifecycle", () => {
  it("a current heading choice formats and restores editor focus", () => {
    const { format, focus } = mount(); const preventDefault = vi.fn()
    menus.changes[0]("##"); menus.closes[0]({ preventDefault })
    expect(format).toHaveBeenCalledWith("\n## "); expect(preventDefault).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledOnce()
  })

  it("a late choice from the previous note cannot format the new note", () => {
    const { format, retire, render } = mount(); const change = menus.changes[0]
    retire(); render(1); change("##")
    expect(format).not.toHaveBeenCalled()
  })

  it("a closing menu cannot focus a replacement editor after it formatted the old note", () => {
    const { ref, retire, render } = mount(); const change = menus.changes[0]; const close = menus.closes[0]
    change("##"); retire(); render(1)
    const focusB = vi.fn(); ref.current = { focus: focusB } as unknown as MarkdownEditorHandle
    const preventDefault = vi.fn(); close({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce(); expect(focusB).not.toHaveBeenCalled()
  })

  it("A to B to A never renews callbacks from the first A menu", () => {
    const { format, retire, render } = mount(); const changeA = menus.changes[0]
    retire(); render(1); retire(); render(2); changeA("##")
    expect(format).not.toHaveBeenCalled()
    menus.changes[menus.changes.length - 1]("###"); expect(format).toHaveBeenCalledWith("\n### ")
  })

  it("cancel retains the existing default trigger focus semantics", () => {
    const { focus, format } = mount(); const preventDefault = vi.fn()
    menus.closes[0]({ preventDefault })
    expect(preventDefault).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled(); expect(format).not.toHaveBeenCalled()
  })
})
