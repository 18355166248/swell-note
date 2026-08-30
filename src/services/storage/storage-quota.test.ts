// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { inspectStorageQuota, requestPersistentStorage } from "./storage-quota"

const originalStorage = navigator.storage

afterEach(() => {
  Object.defineProperty(navigator, "storage", { configurable: true, value: originalStorage })
})

describe("storage quota", () => {
  it("reports quota usage and persistence", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: vi.fn().mockResolvedValue({ quota: 1_000, usage: 255 }),
        persisted: vi.fn().mockResolvedValue(true),
      },
    })
    await expect(inspectStorageQuota()).resolves.toEqual({
      persisted: true,
      quotaBytes: 1_000,
      supported: true,
      usageBytes: 255,
      usagePercent: 25.5,
    })
  })

  it("requests persistence only when supported", async () => {
    const persist = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, "storage", { configurable: true, value: { persist } })
    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })
})
