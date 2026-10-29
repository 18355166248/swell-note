import { useMemo } from "react"
import { Calendar, type EventObject, type Options } from "swell-calendar"
import "swell-calendar/style.css"
import "./calendar-canvas.css"
import { canEditCalendarNote, localDateKey, type CalendarNote } from "@/services/calendar/calendar-notes"
import { dayNames } from "./calendar-display"

export type CalendarView = "month" | "week" | "day" | "agenda"
const theme = {
  common: { dayName: { color: "var(--foreground)" }, holiday: { color: "var(--muted-foreground)" }, saturday: { color: "var(--muted-foreground)" }, today: { color: "var(--primary)" } },
  month: { dayName: { backgroundColor: "var(--background)", borderLeft: "1px solid var(--border)" } },
  week: { dayName: { backgroundColor: "var(--background)", borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }, dayGrid: { backgroundColor: "var(--background)", borderRight: "1px solid var(--border)" }, today: { color: "var(--primary)", backgroundColor: "var(--accent)" }, weekend: { backgroundColor: "var(--panel-soft)" }, pastTime: { color: "var(--muted-foreground)" }, futureTime: { color: "var(--foreground)" }, allday: { backgroundColor: "var(--background)", labelColor: "var(--muted-foreground)", borderBottom: "1px solid var(--border)", labelBorderRight: "1px solid var(--border)" } },
}

// 第三方组件 API、主题及事件映射集中在此，页面与 Markdown 层均不依赖日历库类型。
export function CalendarCanvas({ entries, date, view, mobile, canCreate, busy, revision, onReschedule, onCreate, onSelectDate, onSelectEvent }: {
  entries: CalendarNote[]; date: Date; view: CalendarView; mobile: boolean; canCreate: boolean
  busy: boolean; revision: number
  onReschedule: (entry: CalendarNote, start: Date, end: Date) => Promise<void>
  onCreate: (start: Date, end: Date) => void
  onSelectDate: (date: Date) => void; onSelectEvent: (id?: string) => void
}) {
  const dateKey = localDateKey(date)
  const updateEnabled = !busy && (view === "day" || view === "week")
  const events = useMemo<EventObject[]>(() => entries.map(e => ({
    id: e.note.id, calendarId: e.category, title: e.title, start: e.start, end: e.end,
    category: "time", raw: { noteTitle: e.note.title || "日程笔记", entry: e }, isReadOnly: !updateEnabled || !canEditCalendarNote(e.note), backgroundColor: e.category === "personal" ? "var(--calendar-personal-bg)" : "var(--calendar-work-bg)", color: "var(--foreground)", borderColor: e.category === "personal" ? "var(--calendar-personal)" : "var(--calendar-work)",
  })), [entries, updateEnabled, revision])
  // 创建与改期分开控制：手机保留空白区域滚动，已有事件可通过组件的触控手势调整。
  const createEnabled = canCreate && !mobile && !busy
  function requestCreate(start: Date, end: Date, month: boolean) {
    if (!createEnabled) return
    // 月格没有时刻语义，按选中首日 10 点至末日 11 点预填，交由用户确认。
    if (month) { start.setHours(10, 0, 0, 0); end.setHours(11, 0, 0, 0) }
    onCreate(start, end)
  }
  const options = useMemo<Options>(() => ({
    defaultView: view, initialDate: `${dateKey}T00:00:00`, isReadOnly: !createEnabled && !updateEnabled,
    views: { month: true, week: !mobile, agenda: true, day: true, multiDay: false, scheduler: false, timeline: false },
    week: { startDayOfWeek: 1, dayNames, hourStart: view === "day" ? 0 : 7, hourEnd: view === "day" ? 24 : 23 },
    month: { startDayOfWeek: 1, dayNames, maxEventStack: 2, dragToCreate: createEnabled, dragToMove: false, dragToResize: false },
    agenda: { range: mobile ? 1 : 14, showEmptyDays: true },
    template: {
      agendaDayHeader: model => <span className="note-calendar-agenda-heading"><strong>{model.month + 1} 月 {model.date} 日 {dayNames[model.day]}</strong><small>{model.eventCount} 项</small></span>,
      agendaEventMeta: event => `笔记 · ${event.raw?.noteTitle || "日程笔记"}`,
    },
  }), [dateKey, view, mobile, createEnabled, updateEnabled])
  return <div className="note-calendar-engine"><Calendar events={events} options={options} theme={theme} callbacks={{
    onCellClick: ({ start, end, view: selectedView }) => {
      if (createEnabled) requestCreate(new Date(start.getTime()), new Date(end.getTime()), selectedView === "month")
      else onSelectDate(new Date(start.getTime()))
    },
    onEventCreate: ({ event }) => {
      if (event.start == null || event.end == null) return
      const start = new Date(typeof event.start === "object" ? event.start.getTime() : event.start)
      const end = new Date(typeof event.end === "object" ? event.end.getTime() : event.end)
      requestCreate(start, end, view === "month")
    },
    onEventUpdate: ({ event, previousEvent }) => {
      // 使用拖动起点的笔记快照，让保存层识别拖动期间的并发正文修改。
      const entry = previousEvent.raw?.entry as CalendarNote | undefined
      if (!entry || event.start == null || event.end == null) return
      const start = new Date(typeof event.start === "object" ? event.start.getTime() : event.start)
      const end = new Date(typeof event.end === "object" ? event.end.getTime() : event.end)
      void onReschedule(entry, start, end)
    },
    onEventClick: ({ event }) => onSelectEvent(event.id),
    onMoreEventsClick: ({ date: next }) => onSelectDate(new Date(next.getTime())),
  }} /></div>
}
