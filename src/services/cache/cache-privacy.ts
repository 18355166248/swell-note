import type { Note } from "@/types/note"

const STORAGE_KEY = "swell-note:cache-privacy:v1"

export type CachePrivacyMode = "full" | "metadata"

export function loadCachePrivacyMode(): CachePrivacyMode {
  return localStorage.getItem(STORAGE_KEY) === "metadata" ? "metadata" : "full"
}

export function saveCachePrivacyMode(mode: CachePrivacyMode) {
  localStorage.setItem(STORAGE_KEY, mode)
}

export function prepareNotesForCache(notes: Note[], mode: CachePrivacyMode) {
  if (mode === "full") return notes
  return notes.map((note) => {
    const unsyncedWebDavChange = note.source === "webdav"
      && (note.syncStatus === "modified" || note.syncStatus === "conflict" || Boolean(note.pendingOperation))
    // 隐私模式仍必须保留尚未同步的工作副本，否则清缓存本身会造成数据丢失。
    if (unsyncedWebDavChange) return note
    return {
      ...note,
      baseContent: undefined,
      content: "",
      contentLoaded: false,
      frontmatter: undefined,
      outgoingLinks: undefined,
      preview: "正文未保存在本机",
      readOnly: true,
      searchText: note.title.toLocaleLowerCase(),
      tags: undefined,
    }
  })
}
