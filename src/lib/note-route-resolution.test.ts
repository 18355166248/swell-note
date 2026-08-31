import { describe, expect, it } from "vitest"

import {
  normalizeVaultPathIdentity,
  resolveRefreshedActiveNoteId,
  resolveRouteNoteId,
  resolveStableVaultNoteId,
  stableNoteRenderIdentity,
  shouldAutoLoadRouteNote,
} from "./note-route-resolution"

describe("note route resolution", () => {
  it("matches an already decoded route parameter", () => {
    const id = "webdav:/Swell/目录/笔记.md"
    expect(resolveRouteNoteId(id, [id])).toBe(id)
  })

  it("falls back to decoding an encoded route parameter", () => {
    const id = "webdav:/Swell/目录/笔记.md"
    expect(resolveRouteNoteId(encodeURIComponent(id), [id])).toBe(id)
  })

  it("does not decode a literal percent sequence in a valid file name", () => {
    const id = "webdav:/Swell/100%20完成.md"
    expect(resolveRouteNoteId(id, [id])).toBe(id)
  })

  it("matches an encoded legacy cache id and returns the real candidate id", () => {
    const routeId = "webdav:/Swell/目录/笔记.md"
    const cachedId = "webdav:/Swell/%E7%9B%AE%E5%BD%95/%E7%AC%94%E8%AE%B0.md"
    expect(resolveRouteNoteId(routeId, [cachedId])).toBe(cachedId)
  })

  it("normalizes encoded Chinese paths and Unicode composition without changing case", () => {
    expect(normalizeVaultPathIdentity("/Swell/%E7%9B%AE%E5%BD%95/%E7%AC%94%E8%AE%B0.md"))
      .toBe("/Swell/目录/笔记.md")
    expect(normalizeVaultPathIdentity("/Swell/Cafe\u0301.md")).toBe("/Swell/Café.md")
    expect(normalizeVaultPathIdentity("/Swell/Note.md")).not.toBe(normalizeVaultPathIdentity("/Swell/note.md"))
  })

  it("keeps the previous note id when a refreshed WebDAV path changes representation", () => {
    const previousNoteId = "webdav:/Swell/%E7%9B%AE%E5%BD%95/%E7%AC%94%E8%AE%B0.md"
    expect(resolveStableVaultNoteId({
      adapterKind: "webdav",
      filePath: "/Swell/目录/笔记.md",
      previousNoteId,
    })).toBe(previousNoteId)
    expect(resolveStableVaultNoteId({
      adapterKind: "webdav",
      filePath: "/Swell/新笔记.md",
    })).toBe("webdav:/Swell/新笔记.md")
  })

  it("uses the same render identity for encoded and decoded forms of one note", () => {
    expect(stableNoteRenderIdentity(
      "webdav:/Swell/%E7%9B%AE%E5%BD%95/%E7%AC%94%E8%AE%B0.md",
      "/Swell/%E7%9B%AE%E5%BD%95/%E7%AC%94%E8%AE%B0.md",
    )).toBe(stableNoteRenderIdentity(
      "webdav:/Swell/目录/笔记.md",
      "/Swell/目录/笔记.md",
    ))
  })

  it("does not flash the first note while a missing detail route refreshes", () => {
    expect(resolveRefreshedActiveNoteId({
      activeNoteId: "webdav:/Swell/上一篇.md",
      availableIds: ["webdav:/Swell/第一篇.md"],
      preserveContext: true,
      routeNoteId: "webdav:/Swell/已移动.md",
    })).toBe("")
  })

  it("keeps the routed note when refresh returns the same note", () => {
    const routeId = "webdav:/Swell/当前.md"
    expect(resolveRefreshedActiveNoteId({
      activeNoteId: "webdav:/Swell/上一篇.md",
      availableIds: ["webdav:/Swell/第一篇.md", routeId],
      preserveContext: true,
      routeNoteId: routeId,
    })).toBe(routeId)
  })

  it("does not repeatedly auto-load a route after its document read failed", () => {
    expect(shouldAutoLoadRouteNote({ contentLoaded: false, hasLoadError: false, isLoading: false })).toBe(true)
    expect(shouldAutoLoadRouteNote({ contentLoaded: false, hasLoadError: false, isLoading: true })).toBe(false)
    expect(shouldAutoLoadRouteNote({ contentLoaded: false, hasLoadError: true, isLoading: false })).toBe(false)
    expect(shouldAutoLoadRouteNote({ contentLoaded: true, hasLoadError: false, isLoading: false })).toBe(false)
  })
})
