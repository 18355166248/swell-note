import { beforeEach, describe, expect, it, vi } from "vitest"

import { appendSyncLog, clearSyncLog, loadSyncLog } from "@/services/sync/sync-log"

describe("sync log", () => {
  beforeEach(() => vi.stubGlobal("localStorage", createMemoryStorage()))

  it("按最新优先保存本机同步摘要", () => {
    appendSyncLog({ message: "同步完成", status: "success" })
    const entries = appendSyncLog({ message: "同步失败", status: "error" })
    expect(entries.map((entry) => entry.message)).toEqual(["同步失败", "同步完成"])
    clearSyncLog()
    expect(loadSyncLog()).toEqual([])
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size },
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}
