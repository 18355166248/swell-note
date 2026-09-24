// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TagFilterMenu } from "./workspace"
import type { Note } from "@/types/note"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("TagFilterMenu", () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it("shows the affected count and submits a local tag rename", async () => {
    const onRename = vi.fn(async () => ({ issues: [], renamed: 2 }))
    const allNotes = [
      { id: "one", tags: ["工作"], title: "一" },
      { id: "two", tags: ["工作"], title: "二" },
    ] as Note[]
    act(() => root.render(<TagFilterMenu allNotes={allNotes} availableTags={["工作"]} canRename mode="local" onChange={vi.fn()} onRename={onRename} selectedTag="工作" />))
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="按标签筛选"]')!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    const menuItem = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.includes("重命名当前标签"))
    expect(menuItem).toBeTruthy()
    act(() => menuItem!.click())
    expect(document.body.textContent).toContain("2 篇笔记")
    const input = document.querySelector<HTMLInputElement>('[aria-label="新标签名称"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "项目")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "确认重命名")!.click() })
    expect(onRename).toHaveBeenCalledWith("工作", "项目")
  })

  it("describes WebDAV edits as pending sync", () => {
    act(() => root.render(<TagFilterMenu allNotes={[]} availableTags={["工作"]} canRename mode="webdav" onChange={vi.fn()} onRename={vi.fn()} selectedTag="工作" />))
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="按标签筛选"]')!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    const menuItem = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.includes("重命名当前标签"))!
    act(() => menuItem.click())
    expect(document.body.textContent).toContain("待同步队列")
  })
})
