// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"

import { installTextareaDrawnCaret } from "./textarea-drawn-caret"

afterEach(() => {
  document.body.replaceChildren()
})

it("textarea 编辑时绘制 DOM 光标，选择文字时恢复系统选区，卸载时清理", async () => {
  const body = document.createElement("div")
  body.className = "editor-body"
  const host = document.createElement("div")
  const input = document.createElement("textarea")
  input.value = "测试文字"
  host.append(input)
  body.append(host)
  document.body.append(body)
  body.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 300, width: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) })
  input.getBoundingClientRect = () => ({ top: 20, bottom: 60, left: 10, right: 210, width: 200, height: 40, x: 10, y: 20, toJSON: () => ({}) })

  const dispose = installTextareaDrawnCaret(host)
  try {
    input.focus()
    await vi.waitFor(() => expect(input.dataset.drawnCaret).toBe("true"))
    expect(body.querySelector<HTMLElement>(".editor-textarea-drawn-caret")?.hidden).toBe(false)

    input.setSelectionRange(0, 2)
    input.dispatchEvent(new Event("select", { bubbles: true }))
    await vi.waitFor(() => expect(input.hasAttribute("data-drawn-caret")).toBe(false))

    input.setSelectionRange(2, 2)
    input.dispatchEvent(new Event("select", { bubbles: true }))
    await vi.waitFor(() => expect(input.dataset.drawnCaret).toBe("true"))
  } finally {
    dispose()
  }
  expect(input.hasAttribute("data-drawn-caret")).toBe(false)
  expect(body.querySelector(".editor-textarea-drawn-caret")).toBeNull()
})
