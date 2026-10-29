import { useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { ChevronLeft, ChevronRight, FileText, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AppNavigationRail, MobileNavigationDrawer } from "@/components/workspace/workspace"
import { useEdgeSwipeAction } from "@/components/workspace/use-edge-swipe-action"
import { useMobileLayoutQuery } from "@/services/navigation/mobile-layout"
import { canEditCalendarNote, eventsOnDate, localDateKey, localDateTime, isCalendarNote, readCalendarNote, type CalendarDraft, type CalendarNote } from "@/services/calendar/calendar-notes"
import type { Note, NoteSaveState } from "@/types/note"
import { CalendarCanvas } from "./calendar-canvas"
import { useCalendarReschedule } from "./use-calendar-reschedule"
import { CalendarEditor } from "./calendar-editor"
import { dayNames, timeLabel, eventTimeRange } from "./calendar-display"
import { useCalendarLocation } from "./use-calendar-location"
import "./calendar-page.css"

type Props = {
  notes: Note[]; connected: boolean; canCreate: boolean; busy: boolean; error: string | null
  indexProgress: { indexed: number; total: number } | null
  saveStates: Record<string, NoteSaveState>
  onNavigate: (path: string) => void; onOpenNote: (note: Note) => void
  onRemove: (note: Note) => Promise<boolean>
  onSave: (draft: CalendarDraft, note?: Note) => Promise<boolean>
}

export default function CalendarPage(props: Props) {
  const mobile = useMobileLayoutQuery()
  const reschedule = useCalendarReschedule(props.onSave, props.busy)
  const { date, desktopView, mobileView, selectedId, chooseDate, setDesktopView, setMobileView, setSelectedId } = useCalendarLocation()
  const [removeTarget, setRemoveTarget] = useState<Note | null>(null)
  const [removing, setRemoving] = useState(false)
  const removeLock = useRef(false)
  const [removeError, setRemoveError] = useState("")
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [editor, setEditor] = useState<{ draft: CalendarDraft; note?: Note } | null>(null)
  const location = useLocation()
  const edgeSwipe = useEdgeSwipeAction(() => setNavigationOpen(true), !navigationOpen && !editor && !selectedId, "drawer", location.key)
  const entries = useMemo(() => props.notes.map(readCalendarNote).filter((e): e is CalendarNote => !!e), [props.notes])
  const invalid = useMemo(() => props.notes.filter(note => isCalendarNote(note) && !readCalendarNote(note)), [props.notes])
  const daily = useMemo(() => eventsOnDate(entries, date), [entries, date])
  const selected = entries.find(e => e.note.id === selectedId)
  // 移除安排后笔记已不在 entries 中，仍需显示后续文件写入失败。
  const failedSave = props.notes.find(note => props.saveStates[note.id]?.status === "error")
  const view = mobile ? mobileView : desktopView
  const dateKey = localDateKey(date)
  function navigateDate(delta: number) {
    const next = new Date(date)
    if (view === "month") { next.setDate(1); next.setMonth(next.getMonth() + delta) }
    // 日视图以自然日翻页，跨月/夏令时交给 Date 处理，不按固定毫秒累加。
    else next.setDate(next.getDate() + delta * (view === "day" ? 1 : mobile || view === "week" ? 7 : 14))
    chooseDate(next)
  }
  function beginEdit(entry?: CalendarNote) {
    const start = new Date(date); start.setHours(10, 0, 0, 0)
    setEditor({ note: entry?.note, draft: entry ? { ...entry, start: localDateTime(new Date(entry.start)), end: localDateTime(new Date(entry.end)) } : { title: "", start: localDateTime(start), end: localDateTime(new Date(start.getTime() + 3600000)), category: "work" } })
  }
  function openEvent(id?: string) {
    const entry = entries.find(e => e.note.id === id)
    if (!entry) return
    setSelectedId(entry.note.id)
  }
  const editable = (entry: CalendarNote) => !props.busy && !reschedule.saving && !removing && canEditCalendarNote(entry.note)
  async function removeSchedule() {
    if (!removeTarget || removeLock.current || props.busy) return
    // 保存前仍由宿主核对确认时的正文快照，防止移除安排覆盖并发编辑。
    removeLock.current = true
    setRemoving(true)
    setRemoveError("")
    try {
      if (!await props.onRemove(removeTarget)) throw new Error("移除失败，请稍后重试")
      setRemoveTarget(null)
      setSelectedId(null)
    } catch (cause) { setRemoveError(cause instanceof Error ? cause.message : "移除失败") }
    finally { removeLock.current = false; setRemoving(false) }
  }
  const weekStart = new Date(date); weekStart.setDate(date.getDate() - (date.getDay() + 6) % 7)
  const detail = selected ? <div className="note-calendar-event-detail">
    <span className="eyebrow">{selected.category === "personal" ? "个人" : "工作"}</span><h2>{selected.title}</h2>
    <p>{new Date(selected.start).toLocaleDateString("zh-CN")} {timeLabel(selected.start)} — {new Date(selected.end).toLocaleDateString("zh-CN")} {timeLabel(selected.end)}</p>
    <Button variant="outline" onClick={() => props.onOpenNote(selected.note)}><FileText />打开日程笔记</Button>
    <p className="note-calendar-muted">在笔记中记录内容，并通过 Markdown 链接关联其他笔记。</p>
    {props.saveStates[selected.note.id]?.status === "error" ? <p role="alert">{props.saveStates[selected.note.id].message || "保存失败，请打开笔记重试"}</p> : null}
    <Button disabled={!editable(selected)} onClick={() => beginEdit(selected)}>编辑日程</Button>
    <Button variant="outline" disabled={!editable(selected)} onClick={() => { setRemoveError(""); setRemoveTarget(selected.note) }}>移除日程安排</Button>
    {!editable(selected) ? <p className="note-calendar-muted">{!selected.note.contentLoaded ? "请先打开笔记加载正文后再编辑" : "当前笔记只读、存在冲突或笔记库正在更新"}</p> : null}
  </div> : null
  return <div className="mobile-workspace mobile-route-swipe note-calendar-root" {...edgeSwipe.bind}>
    <main className="route-page-shell mobile-edge-swipe-current">
      <AppNavigationRail activeSection="calendar" connected={props.connected} onNavigate={props.onNavigate} onOpenSync={() => props.onNavigate("/settings/sync")} />
      <section className="route-main-panel">
        <header className="note-calendar-header">
          <MobileNavigationDrawer activeSection="calendar" connected={props.connected} onNavigate={props.onNavigate} open={navigationOpen} onOpenChange={setNavigationOpen} preview={edgeSwipe.active} suppressEntrance={edgeSwipe.drawerOpenedBySwipe} />
          <div className="note-calendar-heading"><h1>日历</h1><span>让计划和记录，在一起</span></div>
          <div className="note-calendar-date-nav"><Button size="icon" variant="ghost" aria-label="上一页" onClick={() => navigateDate(-1)}><ChevronLeft /></Button><strong>{date.getFullYear()} 年 {date.getMonth() + 1} 月{view === "day" ? ` ${date.getDate()} 日` : ""}</strong><Button size="icon" variant="ghost" aria-label="下一页" onClick={() => navigateDate(1)}><ChevronRight /></Button><Button variant="outline" onClick={() => chooseDate(new Date())}>今天</Button></div>
          {!mobile ? <div className="note-calendar-view-switch" aria-label="日历视图">{(["month", "week", "day", "agenda"] as const).map(v => <Button key={v} variant={v === desktopView ? "secondary" : "ghost"} aria-pressed={v === desktopView} onClick={() => setDesktopView(v)}>{v === "month" ? "月" : v === "week" ? "周" : v === "day" ? "日" : "日程"}</Button>)}</div> : <div className="note-calendar-view-switch note-calendar-mobile-views" aria-label="日历视图">{(["day", "month", "agenda"] as const).map(v => <Button key={v} variant={v === mobileView ? "secondary" : "ghost"} aria-pressed={v === mobileView} onClick={() => setMobileView(v)}>{v === "day" ? "日" : v === "month" ? "月历" : "日程"}</Button>)}</div>}
          <Button aria-label="新建日程" className="note-calendar-add" disabled={!props.canCreate || props.busy} onClick={() => beginEdit()}><Plus /><span>新建日程</span></Button>
        </header>
        {reschedule.error ? <p className="note-calendar-notice" role="alert">{reschedule.error}</p> : null}
        {reschedule.saving ? <p className="note-calendar-notice" role="status">正在更新日程时间…</p> : null}
        {props.error ? <p className="note-calendar-notice" role="alert">{props.error}</p> : null}
        {failedSave ? <p className="note-calendar-notice" role="alert">“{failedSave.title}”尚未保存成功。<button onClick={() => props.onOpenNote(failedSave)}>打开笔记处理</button></p> : null}
        {invalid.length ? <div className="note-calendar-notice" role="alert">有 {invalid.length} 项日程的名称或起止时间异常，请打开笔记修正。
          {invalid.map(note => <button key={note.id} onClick={() => props.onOpenNote(note)}>{note.title || "未命名笔记"}</button>)}
        </div> : null}
        {props.indexProgress ? <p className="note-calendar-notice" role="status">正在索引日程：{props.indexProgress.indexed}/{props.indexProgress.total}</p> : null}
        {!props.canCreate ? <p className="note-calendar-notice">打开可写的笔记库后即可添加日程。<button onClick={() => props.onNavigate("/notes")}>打开笔记库</button></p> : null}
        {mobile && mobileView !== "month" ? <div className="note-calendar-week-strip">{Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return <button key={i} aria-pressed={localDateKey(d) === dateKey} onClick={() => chooseDate(d)}><span>{dayNames[d.getDay()]}</span><strong>{d.getDate()}</strong><i data-has-event={eventsOnDate(entries, d).length > 0} /></button> })}</div> : null}
        <div className="note-calendar-body" data-mobile={mobile}>
            <CalendarCanvas entries={entries} date={date} view={view} mobile={mobile} canCreate={props.canCreate && !props.busy}
              busy={props.busy || reschedule.saving} revision={reschedule.revision} onReschedule={reschedule.reschedule}
              onCreate={(start, end) => {
                if (!props.canCreate || props.busy) return
                setEditor({ draft: { title: "", start: localDateTime(start), end: localDateTime(end), category: "work" } })
              }}
              onSelectDate={next => { chooseDate(next, mobile) }}
              onSelectEvent={openEvent} />
          {!mobile ? <aside className="note-calendar-details"><span className="eyebrow">{dateKey === localDateKey(new Date()) ? "今天" : "日程安排"}</span><h2>{date.getMonth() + 1} 月 {date.getDate()} 日 <small>{dayNames[date.getDay()]}</small></h2><span className="note-calendar-muted">{daily.length} 项安排</span>
            {daily.length ? daily.map(e => <button className="note-calendar-item" key={e.note.id} onClick={() => openEvent(e.note.id)}><span>{eventTimeRange(e.start, e.end)} · {e.category === "personal" ? "个人" : "工作"}</span><strong>{e.title}</strong><small><FileText />{e.note.title || "日程笔记"}</small></button>) : <p className="note-calendar-empty">这一天还没有安排<br />留一点空白，给新的想法。</p>}
            <Button variant="ghost" disabled={!props.canCreate || props.busy} onClick={() => beginEdit()}><Plus />添加日程</Button>
          </aside> : null}
        </div>
        <footer className="note-calendar-footer"><span>日程保存在 Markdown 笔记中</span><span>{entries.length} 项日程</span></footer>
      </section>
    </main>
    <Dialog open={!!selected && !editor && !removeTarget} onOpenChange={open => { if (!open) setSelectedId(null) }}><DialogContent placement={mobile ? "bottom" : "center"} className="note-calendar-dialog"><DialogHeader><DialogTitle>日程详情</DialogTitle><DialogDescription>查看时间和关联的日程笔记</DialogDescription></DialogHeader>{detail}</DialogContent></Dialog>
    <Dialog open={!!removeTarget} onOpenChange={open => { if (!open && !removeLock.current) setRemoveTarget(null) }}>
      <DialogContent placement={mobile ? "bottom" : "center"} className="note-calendar-dialog" showCloseButton={!removing}>
        <DialogHeader><DialogTitle>移除日程安排？</DialogTitle><DialogDescription>仅移除日程名称、时间和分类，笔记正文、标签及其他属性会保留。</DialogDescription></DialogHeader>
        {removeError ? <p role="alert">{removeError}</p> : null}
        <Button variant="outline" disabled={removing} onClick={() => setRemoveTarget(null)}>保留安排</Button>
        <Button disabled={removing || props.busy} onClick={() => void removeSchedule()}>{removing ? "正在移除…" : "确认移除安排"}</Button>
      </DialogContent>
    </Dialog>
    {editor ? <CalendarEditor request={editor} mobile={mobile} busy={props.busy} onSave={props.onSave}
      onClose={() => setEditor(null)} onSaved={draft => { chooseDate(new Date(draft.start)); setEditor(null) }} /> : null}
  </div>
}
