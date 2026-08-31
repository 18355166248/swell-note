import { describe, expect, it } from "vitest"

import {
  getSyncProgressDescription,
  getSyncProgressPercent,
  shouldShowFloatingSyncProgress,
  type SyncProgress,
} from "./sync-progress"

const progress = (patch: Partial<SyncProgress> = {}): SyncProgress => ({
  completed: 1,
  currentLabel: "上传笔记",
  phase: "notes",
  total: 4,
  ...patch,
})

describe("sync progress", () => {
  it("calculates bounded queue progress", () => {
    expect(getSyncProgressPercent(progress())).toBe(25)
    expect(getSyncProgressPercent(progress({ completed: 8 }))).toBe(100)
    expect(getSyncProgressPercent(progress({ completed: -2 }))).toBe(0)
  })

  it("uses a deterministic state while scanning and refreshing", () => {
    expect(getSyncProgressPercent(progress({ completed: 0, total: 0 }))).toBe(0)
    expect(getSyncProgressDescription(progress({ completed: 0, total: 0 }))).toBe("正在检查待同步内容")
    expect(getSyncProgressPercent(progress({ phase: "refreshing" }))).toBe(100)
    expect(getSyncProgressDescription(progress({ phase: "refreshing" }))).toBe("正在刷新云端目录")
  })

  it("keeps background sync quiet on mobile while preserving foreground progress", () => {
    expect(shouldShowFloatingSyncProgress(progress({ automatic: true }), true)).toBe(false)
    expect(shouldShowFloatingSyncProgress(progress({ automatic: false }), true)).toBe(true)
    expect(shouldShowFloatingSyncProgress(progress({ automatic: true }), false)).toBe(true)
  })
})
