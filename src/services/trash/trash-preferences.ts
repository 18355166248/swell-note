import { DEFAULT_TRASH_RETENTION_DAYS, type TrashRetentionDays } from "./trash-entry"

const STORAGE_KEY = "swell-note:trash-retention"

export function loadTrashRetention(): TrashRetentionDays {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === "7" || value === "30" || value === "90"
    ? Number(value) as TrashRetentionDays
    : value === "forever" ? "forever" : DEFAULT_TRASH_RETENTION_DAYS
}

export function saveTrashRetention(value: TrashRetentionDays) {
  localStorage.setItem(STORAGE_KEY, String(value))
}
