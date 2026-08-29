import { beforeEach, describe, expect, it } from "vitest"
import { indexedDB } from "fake-indexeddb"

import { loadCachePrivacyMode, prepareNotesForCache, saveCachePrivacyMode } from "./cache-privacy"
import type { Note } from "@/types/note"

const baseNote: Note = {
  content: "# private body",
  contentLoaded: true,
  id: "one",
  preview: "private body",
  source: "webdav",
  starred: false,
  title: "Title",
  updatedAt: "now",
}

describe("cache privacy", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new (class {
        values = new Map<string, string>()
        getItem(key: string) { return this.values.get(key) ?? null }
        setItem(key: string, value: string) { this.values.set(key, value) }
      })(),
    })
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB })
  })

  it("defaults to full offline cache and persists metadata mode", () => {
    expect(loadCachePrivacyMode()).toBe("full")
    saveCachePrivacyMode("metadata")
    expect(loadCachePrivacyMode()).toBe("metadata")
  })

  it("removes synced body fields but preserves an unsynced working copy", () => {
    const [synced, pending] = prepareNotesForCache([
      { ...baseNote, syncStatus: "synced" },
      { ...baseNote, id: "two", syncStatus: "modified" },
    ], "metadata")

    expect(synced.content).toBe("")
    expect(synced.contentCached).toBe(false)
    expect(synced.contentLoaded).toBe(false)
    expect(pending.content).toBe("# private body")
  })
})
