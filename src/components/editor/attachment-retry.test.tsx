// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import MarkdownPreview from "./markdown-preview"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it("附件读取失败后重试应发起第二次读取", async () => {
  const host = document.createElement("div")
  const root = createRoot(host)
  const resolver = vi.fn(async () => null)
  try {
    await act(async () => root.render(<MarkdownPreview
      content="[报告](./attachments/report.pdf)"
      onLoadWikiNote={vi.fn()}
      onResolveAsset={resolver}
      onResolveWikiNote={() => ({ status: "missing" })}
      onWikiLink={vi.fn()}
    />))
    const button = host.querySelector<HTMLButtonElement>(".markdown-attachment-button")!
    expect(button).not.toBeNull()
    await act(async () => button.click())
    expect(button.textContent).toBe("重试读取附件")
    expect(resolver).toHaveBeenCalledTimes(1)
    await act(async () => button.click())
    expect(resolver).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
  }
})

it("加载中阻止重复请求，卸载后不创建或遗留对象 URL", async () => {
  const host = document.createElement("div")
  const root = createRoot(host)
  let finish!: (value: { data: Uint8Array; mimeType: string } | null) => void
  const resolver = vi.fn((_source: string) => new Promise<{ data: Uint8Array; mimeType: string } | null>((resolve) => { finish = resolve }))
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const createUrl = vi.fn(() => "blob:test-attachment")
  const revokeUrl = vi.fn()
  URL.createObjectURL = createUrl
  URL.revokeObjectURL = revokeUrl
  try {
    await act(async () => root.render(<MarkdownPreview
      content="[报告](./attachments/report.pdf)"
      onLoadWikiNote={vi.fn()}
      onResolveAsset={resolver}
      onResolveWikiNote={() => ({ status: "missing" })}
      onWikiLink={vi.fn()}
    />))
    const button = host.querySelector<HTMLButtonElement>(".markdown-attachment-button")!
    await act(async () => button.click())
    expect(button.disabled).toBe(true)
    button.click()
    await act(async () => root.render(<MarkdownPreview
      content="[报告](./attachments/report.pdf)"
      onLoadWikiNote={vi.fn()}
      onResolveAsset={(source) => resolver(source)}
      onResolveWikiNote={() => ({ status: "missing" })}
      onWikiLink={vi.fn()}
    />))
    expect(resolver).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
    await act(async () => finish({ data: new Uint8Array(1), mimeType: "application/pdf" }))
    expect(createUrl).not.toHaveBeenCalled()
    expect(revokeUrl).not.toHaveBeenCalled()
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

it("成功打开附件后在卸载时释放对象 URL", async () => {
  const host = document.createElement("div")
  const root = createRoot(host)
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const createUrl = vi.fn(() => "blob:test-ready-attachment")
  const revokeUrl = vi.fn()
  URL.createObjectURL = createUrl
  URL.revokeObjectURL = revokeUrl
  try {
    await act(async () => root.render(<MarkdownPreview
      content="[报告](./attachments/report.pdf)"
      onLoadWikiNote={vi.fn()}
      onResolveAsset={async () => ({ data: new Uint8Array(1), mimeType: "application/pdf" })}
      onResolveWikiNote={() => ({ status: "missing" })}
      onWikiLink={vi.fn()}
    />))
    await act(async () => host.querySelector<HTMLButtonElement>(".markdown-attachment-button")!.click())
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe("blob:test-ready-attachment")
    expect(createUrl).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
    expect(revokeUrl).toHaveBeenCalledWith("blob:test-ready-attachment")
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})
