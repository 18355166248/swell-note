// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"

import {
  loadTableColumnPreference,
  resizeAdjacentColumnWidths,
  saveTableColumnPreference,
  tableColumnPercentages,
} from "./markdown-table-width"

describe("markdown table column width", () => {
  beforeEach(() => window.localStorage.clear())

  it("resizes adjacent columns without changing the total or crossing the minimum", () => {
    expect(resizeAdjacentColumnWidths([120, 180, 100], 0, 40)).toEqual([160, 140, 100])
    expect(resizeAdjacentColumnWidths([120, 180, 100], 0, -100)).toEqual([72, 228, 100])
    expect(resizeAdjacentColumnWidths([120, 180, 100], 1, 100)).toEqual([120, 208, 72])
  })

  it("converts configured widths to responsive percentages", () => {
    const percentages = tableColumnPercentages([100, 200, 300])
    expect(percentages[0]).toBeCloseTo(100 / 6)
    expect(percentages[1]).toBeCloseTo(200 / 6)
    expect(percentages[2]).toBe(50)
    expect(percentages.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100)
  })

  it("persists only preferences matching the current column count", () => {
    saveTableColumnPreference("note-a", 0, { mode: "manual", widths: [120, 180] })

    expect(loadTableColumnPreference("note-a", 0, 2)).toEqual({ mode: "manual", widths: [120, 180] })
    expect(loadTableColumnPreference("note-a", 0, 3)).toBeNull()
  })
})
