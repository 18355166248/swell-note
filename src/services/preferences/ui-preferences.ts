export type NoteViewMode = "edit" | "preview"

export type UiPreferences = {
  noteViewMode: NoteViewMode
}

const UI_PREFERENCES_KEY = "swell-note:ui-preferences:v1"
const DEFAULT_UI_PREFERENCES: UiPreferences = {
  noteViewMode: "preview",
}

function readStoredPreferences(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(UI_PREFERENCES_KEY)
    if (!raw) return {}
    const value = JSON.parse(raw) as unknown
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function loadUiPreferences(): UiPreferences {
  const stored = readStoredPreferences()
  return {
    noteViewMode: stored.noteViewMode === "edit" ? "edit" : DEFAULT_UI_PREFERENCES.noteViewMode,
  }
}

export function saveUiPreferences(preferences: Partial<UiPreferences>) {
  try {
    // 合并原始对象以保留后续版本新增的主题、密度等字段，单项更新不会覆盖其他 UI 偏好。
    window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify({
      ...readStoredPreferences(),
      ...preferences,
    }))
  } catch {
    // 隐私模式或存储空间不足时只影响跨刷新保留，当前会话状态仍由 React 维护。
  }
}
