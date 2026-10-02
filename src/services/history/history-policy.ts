const KEY = "swell-note:history-policy:v1"
export type HistoryPolicy = { limit: number; intervalMinutes: number }
export function loadHistoryPolicy(): HistoryPolicy {
  try {
    const value = JSON.parse(typeof window === "undefined" ? "{}" : window.localStorage.getItem(KEY) || "{}")
    return { limit: [30, 100, 300].includes(value?.limit) ? value.limit : 30, intervalMinutes: [1, 5, 15].includes(value?.intervalMinutes) ? value.intervalMinutes : 5 }
  } catch { return { limit: 30, intervalMinutes: 5 } }
}
export function saveHistoryPolicy(policy: HistoryPolicy) {
  if (![30, 100, 300].includes(policy.limit) || ![1, 5, 15].includes(policy.intervalMinutes)) throw new Error("历史保留设置无效")
  window.localStorage.setItem(KEY, JSON.stringify(policy))
}
