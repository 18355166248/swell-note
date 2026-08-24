import { invoke, isTauri } from "@tauri-apps/api/core"

import type { IndexedVaultFile } from "./note-index"

export type NativeSearchIndexEntry = {
  content: string
  noteId: string
  path: string
  tags: string
  title: string
}

export type NativeSearchIndexStatus = {
  cacheCount: number
  databaseSizeBytes: number
  healthy: boolean
  indexedNotes: number
  schemaVersion: number
}

export function supportsNativeSearchIndex() {
  return isTauri()
}

export async function clearNativeSearchIndex(cacheId: string) {
  if (!isTauri()) return
  await invoke("clear_note_search_index", { cacheId })
}

export async function upsertNativeSearchIndex(cacheId: string, entries: NativeSearchIndexEntry[]) {
  if (!isTauri() || entries.length === 0) return
  await invoke("upsert_note_search_index", { cacheId, entries })
}

export async function searchNativeNoteIndex(cacheId: string, query: string, limit = 5_000) {
  if (!isTauri() || !query.trim()) return null
  return invoke<string[]>("search_note_index", { cacheId, limit, query })
}

export async function getNativeSearchIndexStatus() {
  if (!isTauri()) return null
  return invoke<NativeSearchIndexStatus>("get_search_index_status")
}

export async function rebuildNativeSearchIndex() {
  if (!isTauri()) return null
  return invoke<NativeSearchIndexStatus>("rebuild_note_search_index")
}

export function toNativeSearchEntry(file: IndexedVaultFile): NativeSearchIndexEntry {
  return {
    content: file.content,
    noteId: file.path,
    path: file.path,
    tags: file.tags.join(" "),
    title: file.path.split("/").pop()?.replace(/\.md$/i, "") ?? file.path,
  }
}
