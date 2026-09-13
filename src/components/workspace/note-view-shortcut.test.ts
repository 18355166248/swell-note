// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { handleNoteViewModeShortcut } from "./workspace"

afterEach(() => {
  document.body.innerHTML = ""
})

describe("note view mode shortcut", () => {
  it("进入锁定前提交当前输入并释放焦点", () => {
    const input = document.createElement("input")
    const onBlur = vi.fn()
    const onChange = vi.fn()
    input.addEventListener("blur", onBlur)
    document.body.append(input)
    input.focus()
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "e", metaKey: true })

    handleNoteViewModeShortcut(event, "unified", onChange)

    expect(event.defaultPrevented).toBe(true)
    expect(onBlur).toHaveBeenCalledOnce()
    expect(document.activeElement).not.toBe(input)
    expect(onChange).toHaveBeenCalledWith("locked")
  })

  it("输入法组合期间不锁定也不打断焦点", () => {
    const input = document.createElement("input")
    const onChange = vi.fn()
    document.body.append(input)
    input.focus()
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, isComposing: true, key: "e", metaKey: true })
    const legacyEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "e", metaKey: true })
    Object.defineProperty(legacyEvent, "keyCode", { value: 229 })

    handleNoteViewModeShortcut(event, "unified", onChange)
    handleNoteViewModeShortcut(legacyEvent, "unified", onChange)

    expect(event.defaultPrevented).toBe(false)
    expect(legacyEvent.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("解除锁定只恢复可写状态，不主动聚焦编辑器", () => {
    const input = document.createElement("input")
    const onChange = vi.fn()
    const focus = vi.spyOn(input, "focus")
    document.body.append(input)
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "e", metaKey: true })

    handleNoteViewModeShortcut(event, "locked", onChange)

    expect(focus).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith("unified")
  })
})
