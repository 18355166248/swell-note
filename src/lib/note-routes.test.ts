import { describe, expect, it } from "vitest"

import {
  getNoteBreadcrumbSegments,
  getNoteReturnRoute,
  getNotesListRoute,
  isNotesLibraryRoute,
} from "@/lib/note-routes"

describe("note routes", () => {
  it("uses a dedicated route for the all-notes list", () => {
    expect(getNotesListRoute("all", null)).toBe("/notes/view/all")
    expect(isNotesLibraryRoute("/notes")).toBe(true)
    expect(isNotesLibraryRoute("/notes/view/all")).toBe(false)
  })

  it("encodes a nested folder without losing its display path", () => {
    expect(getNotesListRoute("all", "code / 小说")).toBe("/notes/folder/code%20%2F%20%E5%B0%8F%E8%AF%B4")
  })

  it("restores only a valid list route from navigation state", () => {
    expect(getNoteReturnRoute({ returnTo: "/notes/folder/XIMA-AI" }, "all", null))
      .toBe("/notes/folder/XIMA-AI")
    expect(getNoteReturnRoute({ returnTo: "/settings" }, "recent", null))
      .toBe("/notes/view/recent")
  })

  it("builds a real breadcrumb and labels root notes", () => {
    expect(getNoteBreadcrumbSegments("AI / 网站笔记")).toEqual(["AI", "网站笔记"])
    expect(getNoteBreadcrumbSegments()).toEqual(["根目录"])
  })
})
