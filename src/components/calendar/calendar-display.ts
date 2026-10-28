export const dayNames: [string, string, string, string, string, string, string] = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
export const timeLabel = (value: string) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })

