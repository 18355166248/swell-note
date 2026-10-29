import { expect, it } from "vitest"
import { eventTimeRange } from "./calendar-display"

it("includes both dates for overnight and multi-day appointments", () => {
  const start = new Date(2026, 9, 29, 23).toISOString()
  const end = new Date(2026, 9, 30, 1).toISOString()
  expect(eventTimeRange(start, end)).toContain("2026/10/29")
  expect(eventTimeRange(start, end)).toContain("2026/10/30")
  expect(eventTimeRange(new Date(2026, 9, 29, 10).toISOString(), start)).toBe("10:00 — 23:00")
})
