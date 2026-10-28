import type { Note } from "@/types/note"
import { extractFrontmatter } from "@/services/search/note-index"

export type CalendarDraft = { title: string; start: string; end: string; category: "work" | "personal" }
export type CalendarNote = CalendarDraft & { note: Note }
export function canEditCalendarNote(note: Note) {
  return !!note.contentLoaded && !note.readOnly && note.syncStatus !== "conflict" && note.pendingOperation !== "delete"
}
const fields = ["swell_event", "event_title", "event_start", "event_end", "event_category"]

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
export function localDateTime(date: Date) {
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`
}
export function validateCalendarDraft(draft: CalendarDraft) {
  if (!draft.title.trim() || /[\r\n]/.test(draft.title)) throw new Error("请输入单行日程名称")
  if (!Number.isFinite(Date.parse(draft.start)) || !Number.isFinite(Date.parse(draft.end))) throw new Error("请选择有效的起止时间")
  if (Date.parse(draft.end) <= Date.parse(draft.start)) throw new Error("结束时间必须晚于开始时间")
}
export function readCalendarNote(note: Note): CalendarNote | null {
  if (note.pendingOperation === "delete" || note.format === "canvas") return null
  const props = note.contentLoaded ? extractFrontmatter(note.content).properties : note.frontmatter
  if (props?.swell_event !== "1" || typeof props.event_start !== "string" || typeof props.event_end !== "string") return null
  let title = typeof props.event_title === "string" ? props.event_title : note.title
  // 仅解码正文中明确的双引号标量，不能把手写的 C:\notes 当成 JSON 转义。
  const rawTitle = note.contentLoaded ? note.content.match(/^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1].match(/^event_title:[ \t]*("[^\r\n]*")[ \t]*$/m)?.[1] : undefined
  if (rawTitle) {
    try { title = JSON.parse(rawTitle) as string } catch { /* 非 JSON 的手写 YAML 标量保留索引值。 */ }
  }
  const draft: CalendarDraft = { title, start: props.event_start, end: props.event_end, category: props.event_category === "personal" ? "personal" : "work" }
  try { validateCalendarDraft(draft); return { ...draft, note } } catch { return null }
}
export function writeCalendarNote(content: string, draft: CalendarDraft) {
  validateCalendarDraft(draft)
  // 只替换自有的单行元数据，保留用户正文、标签及其他 frontmatter；不重序列化整个 YAML。
  const newline = content.includes("\r\n") ? "\r\n" : "\n"
  const match = content.match(/^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  // 多行日程值不属于本模块的单行协议；保守拒绝，避免只删字段头而遗留块内容破坏 YAML。
  if (match) {
    const lines = match[1].split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!fields.some(field => lines[i].startsWith(`${field}:`))) continue
      const nextContentLine = lines.slice(i + 1).find(line => line.trim() && !line.trimStart().startsWith("#")) ?? ""
      if (/^[\w-]+:\s*[>|]/.test(lines[i]) || /^[ \t]+\S/.test(nextContentLine)) {
        throw new Error("日程字段包含多行内容，请先在笔记中整理为单行字段")
      }
    }
  }
  const retained = match ? match[1].split(/\r?\n/).filter(line => !fields.some(field => line.startsWith(`${field}:`))) : []
  // JSON 双引号字符串也是合法 YAML 标量，保留引号、冒号和反斜杠。
  const title = JSON.stringify(draft.title.trim())
  const metadata = [...retained, "swell_event: 1", `event_title: ${title}`, `event_start: ${new Date(draft.start).toISOString()}`, `event_end: ${new Date(draft.end).toISOString()}`, `event_category: ${draft.category}`]
  return `---${newline}${metadata.join(newline)}${newline}---${newline}${match ? content.slice(match[0].length) : content}`
}
export function eventsOnDate(events: CalendarNote[], date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  // 半开区间避免午夜结束的日程重复出现在下一天；按本地日界兼容夏令时。
  return events.filter(e => Date.parse(e.start) < end && Date.parse(e.end) > start).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}
