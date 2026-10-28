// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CalendarNote } from "@/services/calendar/calendar-notes"
import { useCalendarReschedule } from "./use-calendar-reschedule"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const entry = { title: "会议", category: "personal", start: "2026-10-28T10:00:00Z", end: "2026-10-28T11:00:00Z", note: { id: "meeting", content: "原正文" } } as CalendarNote
const start = new Date("2026-10-28T12:00:00Z"), end = new Date("2026-10-28T13:30:00Z")
let current: ReturnType<typeof useCalendarReschedule>
let root: ReturnType<typeof createRoot> | undefined
function mount(save: Parameters<typeof useCalendarReschedule>[0], busy = false) {
  function Probe() { current = useCalendarReschedule(save, busy); return null }
  root = createRoot(document.createElement("div"))
  act(() => root!.render(<Probe />))
}
afterEach(() => act(() => root?.unmount()))
describe("calendar reschedule orchestration", () => {
  it("sends only the new times with original metadata and source snapshot", async () => {
    const save = vi.fn(async () => true)
    mount(save)
    await act(async () => { await current.reschedule(entry, start, end) })
    expect(save).toHaveBeenCalledWith({ title: entry.title, category: entry.category, start: start.toISOString(), end: end.toISOString() }, entry.note)
    expect(current.error).toBeNull()
    expect(current.revision).toBe(1)
  })
  it.each([false, new Error("笔记内容已经变化")])("requests visual reconciliation on failed save: %s", async result => {
    mount(async () => { if (result instanceof Error) throw result; return result })
    await act(async () => { await current.reschedule(entry, start, end) })
    expect(current.error).toContain("时间调整失败")
    expect(current.saving).toBe(false)
    expect(current.revision).toBe(1)
  })
  it("rejects invalid ranges before touching a note", async () => {
    const save = vi.fn(async () => true); mount(save)
    await act(async () => { await current.reschedule(entry, end, start) })
    expect(save).not.toHaveBeenCalled()
    expect(current.error).toContain("结束时间")
  })
  it("serializes updates and refuses changes while the library is busy", async () => {
    let resolve!: (value: boolean) => void
    const save = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    mount(save)
    let pending!: Promise<void>
    await act(async () => { pending = current.reschedule(entry, start, end); await current.reschedule(entry, start, end) })
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(true); await pending })
    act(() => root!.unmount())
    mount(save, true)
    await act(async () => { await current.reschedule(entry, start, end) })
    expect(save).toHaveBeenCalledTimes(1)
  })
})
