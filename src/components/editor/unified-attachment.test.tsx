// @vitest-environment jsdom
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { collectAttachmentBlocks } from "./unified-attachment"
import { VaultAttachment } from "./vault-attachment"
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
it("只接管独立附件行，代码、图片、笔记和句内链接保持原样", () => {
  const state = EditorState.create({ doc: '[方案](attachments/方案.pdf)\n\n句内[音频](a.mp3)继续\n\n![图片](a.png)\n\n[笔记](next.md)\n\n```\n[代码](a.pdf)\n```', extensions: [markdown()] })
  expect(collectAttachmentBlocks(state).map((block) => block.href)).toEqual(["attachments/方案.pdf"])
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
