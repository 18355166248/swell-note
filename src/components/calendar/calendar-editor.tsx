import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { localDateTime, readCalendarNote, validateCalendarDraft, type CalendarDraft } from "@/services/calendar/calendar-notes"
import type { Note } from "@/types/note"

type Request = { draft: CalendarDraft; note?: Note }
export function CalendarEditor({ request, mobile, busy, onSave, onClose, onSaved }: {
  request: Request; mobile: boolean; busy: boolean
  onSave: (draft: CalendarDraft, note?: Note) => Promise<boolean>
  onClose: () => void; onSaved: (draft: CalendarDraft) => void
}) {
  const [draft, setDraft] = useState(request.draft)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const submitting = useRef(false)
  const update = (patch: Partial<CalendarDraft>) => setDraft(current => ({ ...current, ...patch }))

  function requestClose() {
    if (submitting.current) return
    // 比较用户可编辑字段；只查看表单可直接关闭，改动后的 Esc、遮罩和关闭按钮均需确认。
    const changed = draft.title !== request.draft.title || draft.start !== request.draft.start
      || draft.end !== request.draft.end || draft.category !== request.draft.category
    if (changed) setConfirmDiscard(true)
    else onClose()
  }

  async function submit() {
    if (submitting.current || busy) return
    setError("")
    try {
      const next = { ...draft }
      const original = request.note && readCalendarNote(request.note)
      // 仅改标题/分类时沿用原始时间，避免本地输入转换损失秒、毫秒或夏令时偏移。
      if (original) {
        if (next.start === localDateTime(new Date(original.start))) next.start = original.start
        if (next.end === localDateTime(new Date(original.end))) next.end = original.end
      }
      validateCalendarDraft(next)
      submitting.current = true
      setSaving(true)
      if (await onSave(next, request.note)) onSaved(next)
      else setError("未能保存，请检查笔记库状态后重试")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败")
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) { if (confirmDiscard) setConfirmDiscard(false); else requestClose() } }}>
    <DialogContent placement={mobile ? "bottom" : "center"} className="note-calendar-dialog" showCloseButton={!saving && !confirmDiscard}>
      <DialogHeader><DialogTitle>{confirmDiscard ? "放弃未保存的修改？" : request.note ? "编辑日程" : "新建日程"}</DialogTitle><DialogDescription>{confirmDiscard ? "放弃后，本次填写的内容将不会保存。" : "保存到当前笔记库，沿用笔记库的同步设置。"}</DialogDescription></DialogHeader>
      {confirmDiscard ? <div className="note-calendar-form">
        <Button autoFocus variant="outline" onClick={() => setConfirmDiscard(false)}>继续编辑</Button>
        <Button variant="destructive" onClick={onClose}>放弃修改</Button>
      </div> : <form className="note-calendar-form" onSubmit={e => { e.preventDefault(); void submit() }}>
        <fieldset disabled={saving} className="note-calendar-form">
          <label>日程名称<input autoFocus required maxLength={120} value={draft.title} onChange={e => update({ title: e.target.value })} placeholder="例如：产品方案讨论" /></label>
          <label>开始时间<input type="datetime-local" step="1" required value={draft.start} onChange={e => update({ start: e.target.value })} /></label>
          <label>结束时间<input type="datetime-local" step="1" required value={draft.end} onChange={e => update({ end: e.target.value })} /></label>
          <label>分类<select value={draft.category} onChange={e => update({ category: e.target.value as CalendarDraft["category"] })}><option value="work">工作</option><option value="personal">个人</option></select></label>
        </fieldset>
        {error ? <p role="alert">{error}</p> : null}
        <Button type="submit" disabled={saving || busy}>{saving ? "正在保存…" : "保存日程"}</Button>
      </form>}
    </DialogContent>
  </Dialog>
}
