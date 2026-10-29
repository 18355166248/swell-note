import { describe, expect, it, vi } from "vitest"
import type { Note } from "@/types/note"
import { saveCalendarDraft } from "./calendar-save"
import { writeCalendarNote, type CalendarDraft } from "./calendar-notes"
const draft: CalendarDraft = { title: "讨论", start: "2026-10-28T10:00:17.123+08:00", end: "2026-10-28T11:00:17.123+08:00", category: "work" }
const source = { id: "webdav:a.md", source: "webdav", contentLoaded: true, content: writeCalendarNote("原始正文", draft) } as Note
const context = (note = source) => ({ busy: false, getNote: () => note, canWriteLocal: false, createNote: vi.fn(async (_seed: { content: string; title: string; filenamePrefix: string }) => true), updateContent: vi.fn((_id: string, _content: string) => {}) })
describe("calendar save boundary", () => {
  it("delegates new files to the host and propagates creation failure", async () => {
    const host = context(); host.createNote.mockResolvedValue(false)
    expect(await saveCalendarDraft(draft, undefined, host)).toBe(false)
    expect(host.createNote.mock.calls[0][0]).toMatchObject({ filenamePrefix: "日程", title: "讨论" })
    expect(host.updateContent).not.toHaveBeenCalled()
  })
  it("refuses concurrent body changes instead of overwriting", async () => {
    const host = context({ ...source, content: source.content + "外部修改" })
    await expect(saveCalendarDraft(draft, source, host)).rejects.toThrow("已经变化")
    expect(host.updateContent).not.toHaveBeenCalled()
  })
  it.each([{ readOnly: true }, { contentLoaded: false }, { syncStatus: "conflict" }, { pendingOperation: "delete" }])("blocks unavailable or protected notes: %o", async patch => {
    const host = context({ ...source, ...patch } as Note)
    await expect(saveCalendarDraft(draft, source, host)).rejects.toThrow()
    expect(host.updateContent).not.toHaveBeenCalled()
  })
  it("guards busy libraries and unavailable local writers", async () => {
    await expect(saveCalendarDraft(draft, source, { ...context(), busy: true })).rejects.toThrow("正在更新")
    await expect(saveCalendarDraft(draft, source, context({ ...source, source: "local" }))).rejects.toThrow("不可写")
  })
  it("updates through the existing host pipeline and retains the body", async () => {
    const host = context()
    await expect(saveCalendarDraft({ ...draft, title: "修改标题" }, source, host)).resolves.toBe(true)
    expect(host.updateContent.mock.calls[0][1]).toContain("原始正文")
    expect(host.updateContent.mock.calls[0][1]).toContain("02:00:17.123Z")
  })
})

it("removes scheduling through the protected host pipeline without deleting the note", async () => {
  const host = context()
  await expect(saveCalendarDraft(null, source, host)).resolves.toBe(true)
  expect(host.updateContent.mock.calls[0][1]).toContain("原始正文")
  expect(host.updateContent.mock.calls[0][1]).not.toContain("swell_event")
  expect(host.createNote).not.toHaveBeenCalled()
  await expect(saveCalendarDraft(null, source, context({ ...source, content: source.content + "新内容" }))).rejects.toThrow("已经变化")
  await expect(saveCalendarDraft(null, source, context({ ...source, readOnly: true }))).rejects.toThrow()
  await expect(saveCalendarDraft(null, source, { ...context(), busy: true })).rejects.toThrow()
})
