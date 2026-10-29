export const dayNames: [string, string, string, string, string, string, string] = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
export const timeLabel = (value: string) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })


// 跨日卡片必须带日期，不能把次日结束误读为同一天的倒序时间。
export function eventTimeRange(start: string, end: string) {
  const first = new Date(start), last = new Date(end)
  if (first.toDateString() === last.toDateString()) return `${timeLabel(start)} — ${timeLabel(end)}`
  return `${first.toLocaleDateString("zh-CN")} ${timeLabel(start)} — ${last.toLocaleDateString("zh-CN")} ${timeLabel(end)}`
}
