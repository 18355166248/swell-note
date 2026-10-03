// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { exportTextDocument } from "@/services/export/markdown-export"
import { NoteDeliveryDialog } from "./note-delivery-dialog"

vi.mock("@/services/export/markdown-export", () => ({ exportTextDocument: vi.fn(), markdownExportFilename: (title: string) => `${title}.md` }))
vi.mock("@/services/export/html-export", () => ({ createHtmlDocument: async ({ content }: { content: string }) => ({ html: `<p>${content}</p>`, warnings: [] }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function deferred() {
  let resolve!: () => void, reject!: (reason: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function button(name: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === name)!
}

it("旧笔记保存失败迟到时，不污染新笔记导出状态", async () => {
  const host = document.createElement("div"), root = createRoot(host), pending = deferred()
  document.body.append(host)
  vi.mocked(exportTextDocument).mockImplementationOnce(() => pending.promise.then(() => true))
  const render = async (key: string) => act(async () => root.render(<NoteDeliveryDialog open onOpenChange={() => {}} content={key} title={key} documentKey={key} readAsset={async () => null} />))
  try {
    await render("old")
    await vi.waitFor(() => expect(button("下载 HTML").disabled).toBe(false))
    await act(async () => button("下载 HTML").click())
    expect(button("下载 HTML").disabled).toBe(true)
    await render("new")
    await vi.waitFor(() => expect(button("下载 HTML").disabled).toBe(false))
    await act(async () => pending.reject(new Error("旧窗口失败")))
    expect(document.querySelector("[role='alert']")).toBeNull()
    expect(document.querySelector("iframe")?.getAttribute("srcdoc")).toContain("new")
  } finally { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks() }
})

it("打印等待字体及图片解码完成，关闭后的旧加载不会重新启用按钮", async () => {
  const host = document.createElement("div"), root = createRoot(host), fonts = deferred(), image = deferred()
  document.body.append(host)
  try {
    await act(async () => root.render(<NoteDeliveryDialog open onOpenChange={() => {}} content="正文" title="标题" documentKey="note" readAsset={async () => null} />))
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBeNull())
    const frame = document.querySelector("iframe")!
    Object.defineProperty(frame, "contentDocument", { configurable: true, value: { fonts: { ready: fonts.promise }, images: [{ decode: () => image.promise }] } })
    await act(async () => frame.dispatchEvent(new Event("load")))
    expect(button("打印 / 保存 PDF").disabled).toBe(true)
    await act(async () => fonts.resolve())
    expect(button("打印 / 保存 PDF").disabled).toBe(true)
    await act(async () => image.resolve())
    expect(button("打印 / 保存 PDF").disabled).toBe(false)
    const late = deferred()
    Object.defineProperty(frame, "contentDocument", { configurable: true, value: { images: [{ decode: () => late.promise }] } })
    await act(async () => frame.dispatchEvent(new Event("load")))
    await act(async () => root.render(<NoteDeliveryDialog open={false} onOpenChange={() => {}} content="正文" title="标题" documentKey="note" readAsset={async () => null} />))
    await act(async () => late.resolve())
    expect(document.querySelector("iframe")).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove() }
})
