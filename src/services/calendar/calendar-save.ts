import type { Note } from "@/types/note"
import { canEditCalendarNote, removeCalendarSchedule, writeCalendarNote, type CalendarDraft } from "./calendar-notes"

export type CalendarNoteSeed = { content: string; title: string; filenamePrefix: string }
type CalendarSaveContext = {
  busy: boolean
  getNote: (id: string) => Note | undefined
  canWriteLocal: boolean
  createNote: (seed: CalendarNoteSeed) => Promise<boolean>
  updateContent: (id: string, content: string) => void
}

/** 只编排日历到笔记的转换；文件写入、缓存、历史和同步仍由宿主的统一笔记链路持有。 */
export async function saveCalendarDraft(draft: CalendarDraft | null, source: Note | undefined, context: CalendarSaveContext) {
  if (context.busy) throw new Error("笔记库正在更新，请稍后保存")
  if (!source) {
    if (!draft) throw new Error("请选择要移除安排的笔记")
    return context.createNote({ filenamePrefix: "日程", title: draft.title.trim(), content: writeCalendarNote(`# ${draft.title.trim()}\n\n`, draft) })
  }
  const current = context.getNote(source.id)
  if (!current || !canEditCalendarNote(current)) {
    throw new Error("笔记尚未加载、只读或存在冲突，无法修改日程")
  }
  if (current.source !== "webdav" && !context.canWriteLocal) throw new Error("当前本地笔记库不可写")
  // 表单/拖拽记录操作开始时的工作副本，提交前与最新正文核对，拒绝覆盖外部或编辑器的并发修改。
  if (current.content !== source.content) throw new Error("笔记内容已经变化，请重新打开日程后再调整")
  context.updateContent(current.id, draft ? writeCalendarNote(current.content, draft) : removeCalendarSchedule(current.content))
  return true
}
