import { useRef, useState } from "react"
import type { Note } from "@/types/note"
import { validateCalendarDraft, type CalendarDraft, type CalendarNote } from "@/services/calendar/calendar-notes"

type Save = (draft: CalendarDraft, note?: Note) => Promise<boolean>

// 保存编排不依赖日历库：只接收日期与拖动前笔记快照，统一走宿主的并发/只读保护。
export function useCalendarReschedule(onSave: Save, busy: boolean) {
  const locked = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  async function reschedule(entry: CalendarNote, start: Date, end: Date) {
    if (locked.current || busy) {
      setRevision(value => value + 1)
      return
    }
    locked.current = true
    setSaving(true)
    setError(null)
    try {
      const draft: CalendarDraft = { title: entry.title, category: entry.category, start: start.toISOString(), end: end.toISOString() }
      validateCalendarDraft(draft)
      if (!await onSave(draft, entry.note)) throw new Error("未能保存，请检查笔记库状态后重试")
    } catch (cause) {
      setError(`时间调整失败：${cause instanceof Error ? cause.message : "请稍后重试"}`)
    } finally {
      locked.current = false
      setSaving(false)
      // 日历库会乐观移动内部卡片；无论成功或拒绝都重新应用宿主数据，失败时恢复真实时间。
      setRevision(value => value + 1)
    }
  }

  return { reschedule, saving, error, revision }
}
