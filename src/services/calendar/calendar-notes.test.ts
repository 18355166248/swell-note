import { describe, expect, it } from "vitest"
import { eventsOnDate, readCalendarNote, writeCalendarNote, type CalendarDraft } from "./calendar-notes"
import type { Note } from "@/types/note"
const draft: CalendarDraft = { title: "日历讨论", start: "2026-10-28T10:00:00+08:00", end: "2026-10-28T11:00:00+08:00", category: "work" }
const note = (content: string) => ({ id: "local:a.md", title: "a", content, contentLoaded: true } as Note)
describe("calendar Markdown adapter", () => {
  it("preserves body, unrelated metadata and line endings across edits", () => {
    const source = "---\r\ntags: [work]\r\nowner: Swell\r\n---\r\n# 记录\r\n[方案](./plan.md)\r\n"
    const first = writeCalendarNote(source, draft)
    const changed = writeCalendarNote(first, { ...draft, title: "新安排" })
    expect(changed).toContain("tags: [work]\r\nowner: Swell")
    expect(changed).toContain("# 记录\r\n[方案](./plan.md)\r\n")
    expect(changed.match(/swell_event:/g)).toHaveLength(1)
    expect(readCalendarNote(note(changed))?.title).toBe("新安排")
    expect(readCalendarNote(note(changed))?.start).toBe("2026-10-28T02:00:00.000Z")
  })
  it("round trips quoted names without replacing user text", () => {
    const title = `Swell's "plan": C:\\notes`
    expect(readCalendarNote(note(writeCalendarNote("", { ...draft, title })))?.title).toBe(title)
  })
  it("does not decode plain handwritten backslashes as JSON escapes", () => {
    const content = writeCalendarNote("", draft).replace(/event_title:.*\n/, String.raw`event_title: C:\notes` + "\n")
    expect(readCalendarNote(note(content))?.title).toBe(String.raw`C:\notes`)
  })
  it("rejects multiline event fields without damaging unrelated YAML", () => {
    const content = writeCalendarNote("正文", draft).replace(/event_title:.*\n/, "event_title: |\n  多行日程\n")
    expect(() => writeCalendarNote(content, draft)).toThrow("多行")
    const withOtherBlock = writeCalendarNote("正文", draft).replace("swell_event: 1", "description: |\n  保留这段说明\nswell_event: 1")
    expect(writeCalendarNote(withOtherBlock, draft)).toContain("description: |\n  保留这段说明")
  })
  it("rejects reversed dates and multiline metadata injection", () => {
    expect(() => writeCalendarNote("", { ...draft, end: draft.start })).toThrow()
    expect(() => writeCalendarNote("", { ...draft, title: "a\nswell_event: 0" })).toThrow()
    expect(readCalendarNote(note("- [ ] 未排期待办"))).toBeNull()
  })
  it("can read indexed metadata without pretending the body is editable", () => {
    expect(readCalendarNote({ ...note(""), contentLoaded: false, frontmatter: { swell_event: "1", event_start: draft.start, event_end: draft.end } })?.note.contentLoaded).toBe(false)
  })
  it("excludes midnight end from following day", () => {
    const event = { ...draft, note: note(""), start: new Date(2026, 9, 27, 23).toISOString(), end: new Date(2026, 9, 28).toISOString() }
    expect(eventsOnDate([event], new Date(2026, 9, 28))).toHaveLength(0)
    expect(eventsOnDate([event], new Date(2026, 9, 27))).toHaveLength(1)
  })
})
