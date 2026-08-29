// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"

import { applyFolderOrder, loadFolderOrder, saveFolderOrder } from "./folder-order-preferences"

describe("folder order preferences", () => {
  beforeEach(() => window.localStorage.clear())

  it("stores independent folder orders for each library", () => {
    saveFolderOrder("vault-a", ["AI", "Daily"])
    saveFolderOrder("vault-b", ["Person"])

    expect(loadFolderOrder("vault-a")).toEqual(["AI", "Daily"])
    expect(loadFolderOrder("vault-b")).toEqual(["Person"])
  })

  it("keeps newly discovered folders after the saved paths", () => {
    const folders = [{ path: "AI" }, { path: "Daily" }, { path: "Person" }]

    expect(applyFolderOrder(folders, ["Daily", "AI"])).toEqual([
      { path: "Daily" },
      { path: "AI" },
      { path: "Person" },
    ])
  })

  it("falls back safely when storage is invalid", () => {
    window.localStorage.setItem("swell-note:folder-order:v1", "{invalid")
    expect(loadFolderOrder("vault-a")).toEqual([])
  })
})
