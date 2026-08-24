import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadSyncPreferences, saveSyncPreferences } from "@/services/sync/sync-preferences"

describe("sync preferences", () => {
  beforeEach(() => vi.stubGlobal("localStorage", createMemoryStorage()))

  it("默认保持手动同步，并能保存自动同步模式", () => {
    expect(loadSyncPreferences()).toEqual({ autoSyncMode: "manual" })
    saveSyncPreferences({ autoSyncMode: "background" })
    expect(loadSyncPreferences()).toEqual({ autoSyncMode: "background" })
  })

  it("忽略损坏或未知版本的配置", () => {
    localStorage.setItem("swell-note:sync-preferences:v1", JSON.stringify({ autoSyncMode: "always" }))
    expect(loadSyncPreferences()).toEqual({ autoSyncMode: "manual" })
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
