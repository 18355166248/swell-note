import { describe, expect, it } from "vitest"

import { buildLocalTrashPath, isTrashEntryExpired, type TrashEntry } from "./trash-entry"

const entry = { deletedAt: 1_000, id: "trash-1" } as TrashEntry

describe("trash entry", () => {
  it("按原文件名生成隐藏回收路径", () => {
    expect(buildLocalTrashPath("trash-1", "工作/周报.md")).toBe(".swell-trash/trash-1/周报.md")
  })

  it("按保留期限判断过期并支持永久保留", () => {
    const eightDaysLater = 1_000 + 8 * 24 * 60 * 60 * 1_000
    expect(isTrashEntryExpired(entry, 7, eightDaysLater)).toBe(true)
    expect(isTrashEntryExpired(entry, 30, eightDaysLater)).toBe(false)
    expect(isTrashEntryExpired(entry, "forever", eightDaysLater)).toBe(false)
  })
})
