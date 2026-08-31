// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Note } from "@/types/note"
import { EmptyNoteEditor } from "./workspace"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement | null = null
let root: Root | null = null

function suggestion(): Note {
  return {
    content: "",
    folder: "XIMA广告",
    id: "webdav:/Swell/XIMA广告/提现页面.md",
    preview: "",
    source: "webdav",
    starred: false,
    title: "提现页面",
    updatedAt: "刚刚",
  }
}

function renderEditor(isLoading: boolean, onRefresh = vi.fn()) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(
    <EmptyNoteEditor
      canCreateNote
      canRefresh
      hasNotes
      isLoading={isLoading}
      missing
      onBack={vi.fn()}
      onOpenSettings={vi.fn()}
      onRefresh={onRefresh}
      onSelectNote={vi.fn()}
      suggestions={[suggestion()]}
    />,
  ))
  return { onRefresh }
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe("EmptyNoteEditor missing route recovery", () => {
  it("keeps the missing-note explanation and suggestions stable while syncing", () => {
    renderEditor(true)

    expect(container!.querySelector("[role='alert']")?.textContent).toContain("找不到这篇笔记")
    expect(container!.textContent).toContain("提现页面")
    expect(container!.textContent).toContain("当前候选结果会继续保留")
    expect(container!.querySelector<HTMLButtonElement>("button[disabled]")?.textContent).toContain("正在查找")
  })

  it("lets the user reconnect and search again without leaving the route", () => {
    const { onRefresh } = renderEditor(false)
    const refreshButton = Array.from(container!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("重新连接并查找"))!

    act(() => refreshButton.click())
    expect(onRefresh).toHaveBeenCalledOnce()
  })
})
