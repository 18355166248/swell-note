export type NoteLibraryView = "all" | "recent" | "starred"

const NOTES_LIBRARY_ROUTE = "/notes"
const NOTES_LIST_ROUTE_PREFIX = "/notes/view/"
const NOTES_FOLDER_ROUTE_PREFIX = "/notes/folder/"

export function getNotesListRoute(view: NoteLibraryView, folder: string | null) {
  if (folder) return `${NOTES_FOLDER_ROUTE_PREFIX}${encodeURIComponent(folder)}`
  return `${NOTES_LIST_ROUTE_PREFIX}${view}`
}

export function getNoteReturnRoute(
  locationState: unknown,
  fallbackView: NoteLibraryView,
  fallbackFolder: string | null,
) {
  if (isRecord(locationState) && isNotesListRoute(locationState.returnTo)) {
    return locationState.returnTo
  }
  return getNotesListRoute(fallbackView, fallbackFolder)
}

export function getNoteBreadcrumbSegments(folder?: string) {
  return folder?.split(/\s*\/\s*/).filter(Boolean) ?? ["根目录"]
}

export function isNotesLibraryRoute(path: string) {
  return path === NOTES_LIBRARY_ROUTE
}

function isNotesListRoute(value: unknown): value is string {
  return typeof value === "string" && (
    /^\/notes\/view\/(all|recent|starred)$/.test(value)
    || value.startsWith(NOTES_FOLDER_ROUTE_PREFIX)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
