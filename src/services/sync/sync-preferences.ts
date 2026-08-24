const STORAGE_KEY = "swell-note:sync-preferences:v1"

export type AutoSyncMode = "background" | "manual" | "reconnect"

export type SyncPreferences = {
  autoSyncMode: AutoSyncMode
}

const defaultPreferences: SyncPreferences = { autoSyncMode: "manual" }

export function loadSyncPreferences(): SyncPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SyncPreferences> | null
    return parsed && isAutoSyncMode(parsed.autoSyncMode)
      ? { autoSyncMode: parsed.autoSyncMode }
      : defaultPreferences
  } catch {
    return defaultPreferences
  }
}

export function saveSyncPreferences(preferences: SyncPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}

function isAutoSyncMode(value: unknown): value is AutoSyncMode {
  return value === "manual" || value === "reconnect" || value === "background"
}
