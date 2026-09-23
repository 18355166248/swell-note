import { describe, expect, it } from "vitest"

import { uniqueHistoryCopyPath } from "./note-history-copy"

describe("history copy path", () => {
  it("同目录避开已知副本，并按原文件类型命名", () => {
    const resolveStoragePath = (displayPath: string) => `/Vault/${displayPath}`
    expect(uniqueHistoryCopyPath({
      displaySourcePath: "docs/画布.canvas",
      reservedStoragePaths: new Set(["/vault/docs/画布 历史副本 2026-09-23.canvas"]),
      resolveStoragePath,
      sourceTitle: "画布",
      timestamp: "2026-09-23",
    })).toEqual({
      displayPath: "docs/画布 历史副本 2026-09-23 (2).canvas",
      filename: "画布 历史副本 2026-09-23 (2).canvas",
      storagePath: "/Vault/docs/画布 历史副本 2026-09-23 (2).canvas",
    })
  })
})
