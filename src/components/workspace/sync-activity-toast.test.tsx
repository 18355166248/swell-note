// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

import { SyncActivityToast } from "./sync-activity-toast"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("SyncActivityToast", () => {
  it("shows current work, progress and a working cancel action", () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    const onCancel = vi.fn()
    act(() => root.render(
      <SyncActivityToast
        onCancel={onCancel}
        progress={{ completed: 2, currentLabel: "上传附件.png", phase: "attachments", total: 4 }}
      />,
    ))

    expect(container.querySelector("[role='status']")?.getAttribute("aria-live")).toBe("polite")
    expect(container.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("50")
    expect(container.querySelector<HTMLElement>(".workspace-sync-progress > span")?.style.width).toBe("50%")
    expect(container.textContent).toContain("已处理 2/4 项")
    act(() => container.querySelector<HTMLButtonElement>("[aria-label='取消同步']")!.click())
    expect(onCancel).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })

  it("locks cancellation while the remote directory is being finalized", () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    act(() => root.render(
      <SyncActivityToast
        onCancel={vi.fn()}
        progress={{ completed: 3, currentLabel: "刷新远端列表", phase: "refreshing", total: 3 }}
      />,
    ))

    expect(container.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("100")
    expect(container.textContent).toContain("正在完成")
    expect(container.querySelector("[aria-label='取消同步']")).toBeNull()
    act(() => root.unmount())
  })
})
