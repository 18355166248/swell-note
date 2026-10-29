import { useSearchParams } from "react-router-dom"
import { localDateKey } from "@/services/calendar/calendar-notes"
import type { CalendarView } from "./calendar-canvas"

// 浏览上下文属于路由，不属于日程数据；replace 避免每次选日都增加浏览器历史。
export function useCalendarLocation() {
  const [params, setParams] = useSearchParams()
  const rawDate = params.get("date") ?? ""
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00`) : new Date(NaN)
  const date = Number.isFinite(parsed.getTime()) && localDateKey(parsed) === rawDate ? parsed : new Date()
  const desktop = params.get("view")
  const phone = params.get("mobileView")
  const desktopView: CalendarView = desktop === "week" || desktop === "day" || desktop === "agenda" ? desktop : "month"
  const mobileView: "month" | "day" | "agenda" = phone === "month" || phone === "day" ? phone : "agenda"
  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    // 首次交互固定日期，打开笔记跨午夜返回也能保持原位置。
    next.set("date", localDateKey(date))
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }
  return {
    date, desktopView, mobileView, selectedId: params.get("event"),
    chooseDate: (next: Date, showAgenda = false) => update({ date: localDateKey(next), event: null, ...(showAgenda ? { mobileView: "agenda" } : {}) }),
    setDesktopView: (view: CalendarView) => update({ view }),
    setMobileView: (mobileView: "month" | "day" | "agenda") => update({ mobileView }),
    setSelectedId: (event: string | null) => update({ event }),
  }
}
