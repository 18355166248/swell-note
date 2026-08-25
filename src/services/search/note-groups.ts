import type { Note } from "@/types/note"
import type { NoteSort } from "@/services/search/note-sort"

export type NoteDateGroup = {
  key: string
  // 标题排序或整组缺少修改时间时没有可信日期，label 为 null，列表不渲染分组标题。
  label: string | null
  notes: Note[]
}

const DAY_IN_MS = 86400000

const buckets = [
  { key: "today", label: "今天", maxDayDiff: 0 },
  { key: "yesterday", label: "昨天", maxDayDiff: 1 },
  { key: "week", label: "过去 7 天", maxDayDiff: 7 },
  { key: "month", label: "过去 30 天", maxDayDiff: 30 },
] as const

// 本地日历日的序号。用 Date.UTC 重新组装年月日，避开夏令时切换日不是 24 小时的问题——
// 直接拿两个本地零点相减再除以 86400000，在春季前进那天会把「昨天」算成 0 天前。
export function getLocalDayIndex(timestamp: number) {
  const date = new Date(timestamp)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_IN_MS
}

export function groupNotesByDate(notes: readonly Note[], sort: NoteSort, now = Date.now()): NoteDateGroup[] {
  if (notes.length === 0) return []
  // 按标题排序时日期标题会与实际顺序矛盾；旧缓存整体缺 modifiedAt 时同样无法分组。
  if (sort === "title-asc" || notes.every((note) => note.modifiedAt === undefined)) {
    return [{ key: "all", label: null, notes: [...notes] }]
  }

  const todayIndex = getLocalDayIndex(now)
  const groups: NoteDateGroup[] = []
  let currentBucketKey = ""
  for (const note of notes) {
    const bucket = resolveBucket(note.modifiedAt, todayIndex)
    const current = groups[groups.length - 1]
    // 顺序完全跟随传入的排序结果，升序时自然得到「更早 → 今天」，不做二次重排。
    if (current && currentBucketKey === bucket.key) {
      current.notes.push(note)
      continue
    }
    currentBucketKey = bucket.key
    // 缺 modifiedAt 的笔记会让 sortNotes 原样返回，同一档位可能被隔开成多段；
    // key 必须带上序号，否则列表会出现重复的 React key 与虚拟滚动测量键。
    groups.push({ key: `${bucket.key}-${groups.length}`, label: bucket.label, notes: [note] })
  }
  return groups
}

function resolveBucket(modifiedAt: number | undefined, todayIndex: number) {
  if (modifiedAt === undefined) return { key: "unknown", label: "未知时间" }
  // 远端时钟超前会得到负数天差，按今天处理，避免出现「未来」分组。
  const dayDiff = todayIndex - getLocalDayIndex(modifiedAt)
  return buckets.find((bucket) => dayDiff <= bucket.maxDayDiff) ?? { key: "earlier", label: "更早" }
}
