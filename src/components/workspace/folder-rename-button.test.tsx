// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FolderRenameButton } from "./workspace"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("FolderRenameButton", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("打开时初始化当前层名称，并在导航变化后仍提交冻结的二级路径", () => {
    const onRename = vi.fn()
    const render = (folderPath: string) => act(() => root.render(
      <FolderRenameButton disabled={false} folderPath={folderPath} mode="webdav" onDelete={vi.fn()} onRename={onRename} />,
    ))
    render("一级 / 二级")
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="重命名文件夹 二级"]')!.click())
    const input = document.querySelector<HTMLInputElement>('[aria-label="新文件夹名称"]')!
    expect(input.value).toBe("二级")
    expect(document.body.textContent).toContain("一级 / 二级")

    render("一级")
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "新二级")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    act(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "确认重命名")!.click())
    expect(onRename).toHaveBeenCalledWith("一级 / 二级", "新二级")
  })
})
