// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

import { SyncFailureToast } from "./sync-failure-toast"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("SyncFailureToast", () => {
  it("keeps the failure visible and exposes retry and dismiss actions", () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    const onDismiss = vi.fn()
    const onRetry = vi.fn()
    act(() => root.render(
      <SyncFailureToast message="当前设备离线，本地修改已保留" onDismiss={onDismiss} onRetry={onRetry} />,
    ))

    expect(container.querySelector("[role='alert']")?.textContent).toContain("当前设备离线")
    act(() => container.querySelector<HTMLButtonElement>("button:not([aria-label])")!.click())
    expect(onRetry).toHaveBeenCalledOnce()
    act(() => container.querySelector<HTMLButtonElement>("[aria-label='关闭同步失败提示']")!.click())
    expect(onDismiss).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })
})
