export type NoteViewMode = "locked" | "preview" | "unified"
export type ColorMode = "dark" | "light" | "system"
/**
 * 正文的编辑呈现方式：即时预览（富文本外观）或 Markdown 源码。
 *
 * 这是**本机编辑偏好**，只影响怎么看着写，不改变笔记内容、也不随笔记同步到远端，
 * 因此和 noteViewMode（阅读态：锁定/阅读/一体化）是两个正交维度，界面上不应并成一组按钮。
 */
export type MarkdownSourceMode = "live" | "source"

export type UiPreferences = {
  colorMode: ColorMode
  libraryPaneWidth: number
  markdownSourceMode: MarkdownSourceMode
  noteListPaneWidth: number
  noteViewMode: NoteViewMode
}

const UI_PREFERENCES_KEY = "swell-note:ui-preferences:v1"
const DEFAULT_UI_PREFERENCES: UiPreferences = {
  colorMode: "system",
  libraryPaneWidth: 230,
  markdownSourceMode: "live",
  noteListPaneWidth: 320,
  noteViewMode: "unified",
}

const PANE_WIDTH_LIMITS = {
  libraryPaneWidth: { max: 340, min: 205 },
  noteListPaneWidth: { max: 440, min: 280 },
} as const

const NOTE_VIEW_MODE_ACTIONS = {
  locked: { label: "解除锁定，继续编辑", nextMode: "unified" },
  preview: { label: "进入一体化编辑", nextMode: "unified" },
  unified: { label: "锁定为只读阅读", nextMode: "locked" },
} satisfies Record<NoteViewMode, { label: string; nextMode: NoteViewMode }>

export function getNoteViewModeAction(mode: NoteViewMode): { label: string; nextMode: NoteViewMode } {
  return NOTE_VIEW_MODE_ACTIONS[mode]
}

function paneWidth(value: unknown, key: "libraryPaneWidth" | "noteListPaneWidth") {
  const limits = PANE_WIDTH_LIMITS[key]
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_UI_PREFERENCES[key]
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)))
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
    colorMode: stored.colorMode === "dark" || stored.colorMode === "light" ? stored.colorMode : "system",
    libraryPaneWidth: paneWidth(stored.libraryPaneWidth, "libraryPaneWidth"),
    noteListPaneWidth: paneWidth(stored.noteListPaneWidth, "noteListPaneWidth"),
    // 默认即时预览；只有明确存过 source 才进源码模式，旧偏好对象缺少该字段时行为不变。
    markdownSourceMode: stored.markdownSourceMode === "source" ? "source" : DEFAULT_UI_PREFERENCES.markdownSourceMode,
    // 旧版 edit 与新的统一画布语义一致；历史 preview 只可能由用户主动切换写入，必须继续保留。
    noteViewMode: stored.noteViewMode === "preview" || stored.noteViewMode === "locked" || stored.noteViewMode === "unified"
      ? stored.noteViewMode
      : DEFAULT_UI_PREFERENCES.noteViewMode,
  }
}

export function applyColorMode(
  colorMode: ColorMode,
  systemDark = typeof window !== "undefined"
    && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches),
) {
  const dark = colorMode === "dark" || (colorMode === "system" && systemDark)
  document.documentElement.classList.toggle("dark", dark)
  document.documentElement.dataset.colorMode = colorMode
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#151821" : "#3150e8")
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
