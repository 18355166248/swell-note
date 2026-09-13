// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => false) }))
vi.mock("@tauri-apps/api/core", () => tauri)

import { ClipboardReadError, collectClipboardFiles, readClipboardContent, readClipboardEvent } from "./clipboard-content"

const defaultPlatform = navigator.platform
const defaultUserAgent = navigator.userAgent
const defaultTouchPoints = navigator.maxTouchPoints

afterEach(() => {
  tauri.invoke.mockReset()
  tauri.isTauri.mockReturnValue(false)
  Reflect.deleteProperty(navigator, "clipboard")
  Object.defineProperty(navigator, "platform", { configurable: true, value: defaultPlatform })
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: defaultUserAgent })
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: defaultTouchPoints })
})

function transfer(files: File[], itemFiles: Array<File | null>, text = "", html = "") {
  return {
    files,
    getData: (type: string) => type === "text/plain" ? text : type === "text/html" ? html : "",
    items: itemFiles.map((file) => ({ getAsFile: () => file, kind: "file" })),
  } as unknown as DataTransfer
}

describe("clipboard content", () => {
  it("兼容 files 与 items.getAsFile，并把同一文件去重", () => {
    const image = new File(["png"], "截图.png", { type: "image/png", lastModified: 1 })
    const other = new File(["jpg"], "另一张.jpg", { type: "image/jpeg", lastModified: 2 })
    expect(collectClipboardFiles(transfer([image], [image, other, null]))).toEqual([image, other])
  })

  it("保留 FileList 内元信息相同的不同图片，只消除 files/items 双来源配对", () => {
    const first = new File(["aaa"], "截图.png", { type: "image/png", lastModified: 1 })
    const second = new File(["bbb"], "截图.png", { type: "image/png", lastModified: 1 })
    const itemsFirst = new File(["aaa"], "截图.png", { type: "image/png", lastModified: 1 })
    const itemsSecond = new File(["bbb"], "截图.png", { type: "image/png", lastModified: 1 })
    expect(collectClipboardFiles(transfer([first, second], [itemsFirst, itemsSecond]))).toEqual([first, second])
  })

  it("同时保留 DOM 剪贴板的文字、HTML 与文件用于上层判别", () => {
    const image = new File(["png"], "截图.png", { type: "image/png" })
    expect(readClipboardEvent(transfer([], [image], "网页文字", "<b>网页文字</b>"))).toEqual({
      files: [image], html: "<b>网页文字</b>", text: "网页文字",
    })
  })

  it("浏览器明确粘贴时用 Clipboard.read 读取图片", async () => {
    const blob = new Blob(["png"], { type: "image/png" })
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn().mockResolvedValue([{ getType: vi.fn().mockResolvedValue(blob), types: ["image/png"] }]),
    } })
    const result = await readClipboardContent()
    expect(result.text).toBeNull()
    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({ type: "image/png", size: 3 })
    expect(result.files[0]?.name).toMatch(/^截图-.*\.png$/)
  })

  it("同一 ClipboardItem 的多种图片 representation 只取 PNG，不同 item 保留多图", async () => {
    const png = new Blob(["png"], { type: "image/png" })
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" })
    const second = new Blob(["two"], { type: "image/jpeg" })
    const firstGetType = vi.fn((type: string) => Promise.resolve(type === "image/png" ? png : jpeg))
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn().mockResolvedValue([
        { getType: firstGetType, types: ["image/jpeg", "image/png"] },
        { getType: vi.fn().mockResolvedValue(second), types: ["image/jpeg"] },
      ]),
    } })
    const result = await readClipboardContent()
    expect(result.files).toHaveLength(2)
    expect(result.files.map((file) => file.type)).toEqual(["image/png", "image/jpeg"])
    expect(firstGetType).toHaveBeenCalledTimes(1)
    expect(firstGetType).toHaveBeenCalledWith("image/png")
  })

  it("桌面直接读原生命令且文字优先", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" })
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockResolvedValue({ text: "正文", pngBase64: btoa("png") })
    await expect(readClipboardContent()).resolves.toEqual({ files: [], text: "正文" })
    expect(tauri.invoke).toHaveBeenCalledWith("read_clipboard_content")
  })

  it("移动端 Tauri 原生空结果回退 readText，桌面空结果不跨来源重读", async () => {
    const originalAgent = navigator.userAgent
    const originalPlatform = navigator.platform
    const originalTouchPoints = navigator.maxTouchPoints
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone)" })
    const readText = vi.fn().mockResolvedValue("手机文字")
    const read = vi.fn()
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read, readText } })
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockResolvedValue({ text: null, pngBase64: null })
    await expect(readClipboardContent()).resolves.toEqual({ files: [], text: "手机文字" })
    expect(readText).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()

    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalAgent })
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" })
    readText.mockClear()
    await expect(readClipboardContent()).resolves.toEqual({ files: [], text: null })
    expect(readText).not.toHaveBeenCalled()

    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" })
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 })
    await expect(readClipboardContent()).resolves.toEqual({ files: [], text: "手机文字" })
    expect(readText).toHaveBeenCalledTimes(1)
    Object.defineProperty(navigator, "platform", { configurable: true, value: originalPlatform })
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: originalTouchPoints })
  })

  it("Windows/Linux Tauri 使用浏览器剪贴板路径，不调用 macOS 原生命令", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" })
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      readText: vi.fn().mockResolvedValue("Windows 文字"),
    } })
    tauri.isTauri.mockReturnValue(true)
    await expect(readClipboardContent()).resolves.toEqual({ files: [], text: "Windows 文字" })
    expect(tauri.invoke).not.toHaveBeenCalled()
  })

  it("原生 PNG 转成易读文件名，并拒绝空图与超过 20MB 的图片", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" })
    tauri.isTauri.mockReturnValue(true)
    tauri.invoke.mockResolvedValueOnce({ text: null, pngBase64: btoa("png") })
    const image = await readClipboardContent()
    expect(image.files[0]).toMatchObject({ type: "image/png", size: 3 })
    expect(image.files[0]?.name).toContain("截图-")

    tauri.invoke.mockResolvedValueOnce({ text: null, pngBase64: "" })
    await expect(readClipboardContent()).resolves.toEqual({ files: [], text: null })
    tauri.invoke.mockResolvedValueOnce({ text: null, pngBase64: "A".repeat(28 * 1024 * 1024) })
    await expect(readClipboardContent()).rejects.toBeInstanceOf(ClipboardReadError)
  })

  it("浏览器读取被拒时返回可展示错误，不产生未处理拒绝", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
    } })
    await expect(readClipboardContent()).rejects.toThrow("读取剪贴板失败")
  })
})
