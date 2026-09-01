// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { readClipboardText, writeClipboardText } from "./clipboard-text"

function stubClipboard(clipboard: unknown) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard })
}

function stubSelection(collapsed: boolean) {
  vi.spyOn(document, "getSelection").mockReturnValue({ isCollapsed: collapsed } as Selection)
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, "clipboard")
  Reflect.deleteProperty(document, "execCommand")
})

describe("writeClipboardText", () => {
  it("走 clipboard API 写入选中的文本", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })

    await expect(writeClipboardText("选中的文字")).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith("选中的文字")
  })

  it("clipboard API 被拒时回退到当前选区的 execCommand", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("拒绝访问")) })
    stubSelection(false)
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand })

    await expect(writeClipboardText("选中的文字")).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith("copy")
  })

  it("WebView 里没有 clipboard API 时直接走回退", async () => {
    stubSelection(false)
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) })

    await expect(writeClipboardText("选中的文字")).resolves.toBe(true)
  })

  it("两条路径都不可用时如实返回失败", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("拒绝访问")) })
    stubSelection(false)
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) })

    await expect(writeClipboardText("选中的文字")).resolves.toBe(false)
  })

  it("选区已折叠时不再尝试回退复制", async () => {
    stubSelection(true)
    const execCommand = vi.fn()
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand })

    await expect(writeClipboardText("选中的文字")).resolves.toBe(false)
    expect(execCommand).not.toHaveBeenCalled()
  })

  it("空文本不写剪贴板", async () => {
    const writeText = vi.fn()
    stubClipboard({ writeText })

    await expect(writeClipboardText("")).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe("readClipboardText", () => {
  it("读回剪贴板文本", async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue("剪贴板内容") })

    await expect(readClipboardText()).resolves.toBe("剪贴板内容")
  })

  it("用户拒绝授权时返回 null 而不是抛错", async () => {
    stubClipboard({ readText: vi.fn().mockRejectedValue(new Error("未获授权")) })

    await expect(readClipboardText()).resolves.toBeNull()
  })

  it("没有读取能力时返回 null", async () => {
    await expect(readClipboardText()).resolves.toBeNull()
  })
})
