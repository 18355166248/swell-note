// @vitest-environment jsdom
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { collectAttachmentBlocks } from "./unified-attachment"
import { VaultAttachment } from "./vault-attachment"
import { livePreviewOptions, markdownLivePreview } from "./live-preview"
import { clearImageCache } from "./markdown-image-cache"
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
it("只接管独立附件行，代码、图片、笔记和句内链接保持原样", () => {
  const state = EditorState.create({ doc: '[方案](attachments/方案.pdf)\n\n句内[音频](a.mp3)继续\n\n![图片](a.png)\n\n[笔记](next.md)\n\n```\n[代码](a.pdf)\n```', extensions: [markdown()] })
  expect(collectAttachmentBlocks(state).map((block) => block.href)).toEqual(["attachments/方案.pdf"])
})

it("独立引用式附件使用最新定义，未定义的链接保持原样", () => {
  const content = '[方案][PDF]\n\n[未定义][missing]\n\n[PDF]: <attachments/a b.pdf>'
  const state = EditorState.create({ doc: content, extensions: [markdown()] })
  expect(collectAttachmentBlocks(state).map((block) => block.href)).toEqual(["attachments/a b.pdf"])
  const updated = state.update({ changes: { from: content.indexOf("a b.pdf"), to: content.length - 1, insert: "next.pdf" } }).state
  expect(collectAttachmentBlocks(updated).map((block) => block.href)).toEqual(["attachments/next.pdf"])
})

it("同文表格改变资源身份后，单元格图片读取新库而不改正文或选区", async () => {
  const scope = new Compartment()
  const previous = vi.fn(async () => ({ data: new Uint8Array([1]), mimeType: "image/png" }))
  const next = vi.fn(async () => ({ data: new Uint8Array([2]), mimeType: "image/png" }))
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:table-previous").mockReturnValueOnce("blob:table-next")
  const content = "正文\n\n| 图片 |\n| --- |\n| ![封面](attachments/table.png) |"
  const host = document.createElement("div"); document.body.append(host)
  let view!: EditorView
  try {
    await act(async () => {
      view = new EditorView({ parent: host, state: EditorState.create({ doc: content, extensions: [markdown({ base: markdownLanguage }), scope.of(livePreviewOptions.of({ assetScope: "table:old", tableStorageKey: "table:old", onResolveAsset: previous })), markdownLivePreview()] }) })
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    await vi.waitFor(() => expect(host.querySelector(".cm-md-table-wrap img")?.getAttribute("src")).toBe("blob:table-previous"))
    const original = host.querySelector(".cm-md-table-wrap")
    await act(async () => {
      view.dispatch({ effects: scope.reconfigure(livePreviewOptions.of({ assetScope: "table:new", tableStorageKey: "table:new", onResolveAsset: next })) })
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    await vi.waitFor(() => expect(host.querySelector(".cm-md-table-wrap img")?.getAttribute("src")).toBe("blob:table-next"))
    expect(previous).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledOnce()
    expect(host.querySelector(".cm-md-table-wrap")).not.toBe(original)
    expect(view.state.doc.toString()).toBe(content)
    expect(view.state.selection.main.anchor).toBe(0)
  } finally { await act(async () => view?.destroy()); host.remove(); create.mockRestore() }
})
it("按需读取，重试后下载及关闭预览释放对象 URL", async () => {
  const resolveAsset = vi.fn().mockRejectedValueOnce(new Error("离线")).mockResolvedValueOnce({ data: new Uint8Array([1]).buffer, mimeType: "audio/mpeg" })
  const create = vi.fn(() => "blob:audio"), revoke = vi.fn()
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<VaultAttachment onResolveAsset={resolveAsset} source="attachments/a.mp3">录音</VaultAttachment>))
    expect(resolveAsset).not.toHaveBeenCalled()
    await act(async () => host.querySelector("button")!.click())
    expect(host.textContent).toContain("重试读取附件")
    await act(async () => host.querySelector("button")!.click())
    expect(host.querySelector("audio")?.getAttribute("src")).toBe("blob:audio")
    expect(host.querySelector("a")?.getAttribute("download")).toBe("a.mp3")
    await act(async () => host.querySelector("button")!.click())
    expect(revoke).toHaveBeenCalledWith("blob:audio")
    expect(host.querySelector("audio")).toBeNull()
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

it("卸载后的迟到读取结果不创建对象 URL", async () => {
  let finish!: (asset: { data: Uint8Array; mimeType: string }) => void
  const resolve = () => new Promise<{ data: Uint8Array; mimeType: string }>((done) => { finish = done })
  const create = vi.spyOn(URL, "createObjectURL").mockClear()
  const host = document.createElement("div"), root = createRoot(host)
  await act(async () => root.render(<VaultAttachment onResolveAsset={resolve} source="a.pdf">方案</VaultAttachment>))
  act(() => host.querySelector("button")!.click())
  act(() => root.unmount())
  await act(async () => finish({ data: new Uint8Array([1]), mimeType: "application/pdf" }))
  expect(create).not.toHaveBeenCalled()
  create.mockRestore()
})

it.each([
  ["cache", "本机缓存"],
  ["remote", "远端文件"],
  ["local", "本地文件"],
] as const)("附件就绪时显示 %s 来源", async (origin, label) => {
  const host = document.createElement("div"), root = createRoot(host)
  const resolve = async () => ({ data: new Uint8Array([1]), mimeType: "audio/mpeg", origin })
  try {
    await act(async () => root.render(<VaultAttachment onResolveAsset={resolve} source="attachments/a.mp3">录音</VaultAttachment>))
    await act(async () => host.querySelector("button")!.click())
    expect(host.querySelector("audio")).not.toBeNull()
    expect(host.textContent).toContain(label)
  } finally { act(() => root.unmount()); host.remove() }
})

it("正文与选区不变时切换库资源身份，附件使用新库解析器", async () => {
  const scope = new Compartment(), previous = vi.fn(async () => null), next = vi.fn(async () => null)
  const host = document.createElement("div"); document.body.append(host)
  let view!: EditorView
  try {
    await act(async () => {
      view = new EditorView({ parent: host, state: EditorState.create({ doc: "正文\n\n[报告](attachments/a.pdf)", extensions: [markdown(), scope.of(livePreviewOptions.of({ assetScope: "old", onResolveAsset: previous })), markdownLivePreview()] }) })
    })
    await vi.waitFor(() => expect(host.querySelector(".markdown-attachment-button")).not.toBeNull())
    await act(async () => host.querySelector<HTMLButtonElement>(".markdown-attachment-button")!.click())
    expect(previous).toHaveBeenCalledOnce()
    await act(async () => { view.dispatch({ effects: scope.reconfigure(livePreviewOptions.of({ assetScope: "new", onResolveAsset: next })) }); await new Promise((resolve) => setTimeout(resolve, 30)) })
    await act(async () => host.querySelector<HTMLButtonElement>(".markdown-attachment-button")!.click())
    expect(next).toHaveBeenCalledOnce()
    expect(previous).toHaveBeenCalledOnce()
    expect(view.state.doc.toString()).toBe("正文\n\n[报告](attachments/a.pdf)")
  } finally { await act(async () => view?.destroy()); host.remove() }
})

it.each([
  ["普通图片", "![封面](attachments/cover.png)", ".cm-md-image"],
  ["兼容提示块中的图片", "> [!note] 图片\n> ![封面](attachments/cover.png)", ".cm-md-compat-callout"],
])("正文与选区不变时切换库资源身份，%s使用新库解析器", async (_kind, reference, selector) => {
  clearImageCache()
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:previous").mockReturnValueOnce("blob:next")
  const scope = new Compartment()
  const previous = vi.fn(async () => ({ data: new Uint8Array([1]), mimeType: "image/png" }))
  const next = vi.fn(async () => ({ data: new Uint8Array([2]), mimeType: "image/png" }))
  const host = document.createElement("div"); document.body.append(host)
  const content = `正文\n\n${reference}`
  let view!: EditorView
  try {
    await act(async () => {
      view = new EditorView({ parent: host, state: EditorState.create({ doc: content, extensions: [markdown(), scope.of(livePreviewOptions.of({ assetScope: `old:${reference}`, onResolveAsset: previous })), markdownLivePreview()] }) })
      await new Promise((resolve) => setTimeout(resolve, 30))
      await vi.dynamicImportSettled()
    })
    await vi.waitFor(() => expect(host.querySelector(selector)).not.toBeNull())
    await vi.waitFor(() => expect(previous).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(host.querySelector(`${selector} img`)?.getAttribute("src")).toBe("blob:previous"))
    const original = host.querySelector(`${selector} img`)
    await act(async () => { view.dispatch({ effects: scope.reconfigure(livePreviewOptions.of({ assetScope: `new:${reference}`, onResolveAsset: next })) }); await new Promise((resolve) => setTimeout(resolve, 30)) })
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(host.querySelector(`${selector} img`)?.getAttribute("src")).toBe("blob:next"))
    expect(host.querySelector(`${selector} img`)).not.toBe(original)
    expect(previous).toHaveBeenCalledOnce()
    expect(view.state.doc.toString()).toBe(content)
    expect(view.state.selection.main.anchor).toBe(0)
  } finally { await act(async () => view?.destroy()); host.remove(); clearImageCache(); create.mockRestore() }
})
