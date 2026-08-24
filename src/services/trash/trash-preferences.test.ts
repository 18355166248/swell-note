import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadTrashRetention, saveTrashRetention } from "./trash-preferences"

describe("trash preferences", () => {
  beforeEach(() => vi.stubGlobal("localStorage", createMemoryStorage()))

  it("默认保留 30 天并持久化用户选择", () => {
    expect(loadTrashRetention()).toBe(30)
    saveTrashRetention(90)
    expect(loadTrashRetention()).toBe(90)
    saveTrashRetention("forever")
    expect(loadTrashRetention()).toBe("forever")
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
