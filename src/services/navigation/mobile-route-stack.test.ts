import { describe, expect, it } from "vitest"

import {
  createMobileRouteEntry,
  createMobileRouteStack,
  updateMobileRouteStack,
} from "./mobile-route-stack"

describe("mobile route stack", () => {
  it("keeps pushed entries and activates the original entry on POP", () => {
    const library = createMobileRouteEntry("library", "/notes")
    const list = createMobileRouteEntry("list", "/notes/folder/Ideas")
    const note = createMobileRouteEntry("note", "/notes/webdav%3A%2FIdeas%2Fa.md")
    const pushedList = updateMobileRouteStack(createMobileRouteStack(library), list, "PUSH")
    const pushedNote = updateMobileRouteStack(pushedList, note, "PUSH")

    expect(updateMobileRouteStack(pushedNote, list, "POP")).toEqual({
      activeIndex: 1,
      entries: [library, list, note],
    })
  })

  it("preserves the forward branch on POP and truncates it on a new PUSH", () => {
    const a = createMobileRouteEntry("a", "/notes")
    const b = createMobileRouteEntry("b", "/notes/view/all")
    const c = createMobileRouteEntry("c", "/notes/note-c")
    const d = createMobileRouteEntry("d", "/notes/folder/New")
    const atC = updateMobileRouteStack(updateMobileRouteStack(createMobileRouteStack(a), b, "PUSH"), c, "PUSH")
    const atB = updateMobileRouteStack(atC, b, "POP")

    expect(updateMobileRouteStack(atB, d, "PUSH")).toEqual({
      activeIndex: 2,
      entries: [a, b, d],
    })
  })

  it("replaces only the active entry and safely rebuilds an unknown POP", () => {
    const a = createMobileRouteEntry("a", "/notes")
    const b = createMobileRouteEntry("b", "/notes/note-b")
    const renamed = createMobileRouteEntry("renamed", "/notes/note-renamed")
    const replaced = updateMobileRouteStack(updateMobileRouteStack(createMobileRouteStack(a), b, "PUSH"), renamed, "REPLACE")

    expect(replaced).toEqual({ activeIndex: 1, entries: [a, { ...renamed, mountKey: b.mountKey }] })
    const external = createMobileRouteEntry("external", "/notes/view/starred")
    expect(updateMobileRouteStack(replaced, external, "POP")).toEqual(createMobileRouteStack(external))
  })

  it("promotes a mounted semantic fallback when a deep link replaces to it", () => {
    const fallback = { ...createMobileRouteEntry("fallback", "/notes/view/all"), synthetic: true }
    const deepLink = createMobileRouteEntry("deep", "/notes/note-a")
    const stack = { activeIndex: 1, entries: [fallback, deepLink] }
    const committed = createMobileRouteEntry("committed", "/notes/view/all")

    expect(updateMobileRouteStack(stack, committed, "REPLACE")).toEqual({
      activeIndex: 0,
      entries: [{ ...fallback, key: "committed", synthetic: undefined }],
    })
  })
})
