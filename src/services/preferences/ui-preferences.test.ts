// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"

import { loadUiPreferences, saveUiPreferences } from "./ui-preferences"

describe("UI preferences", () => {
  beforeEach(() => window.localStorage.clear())

  it("defaults to preview and restores the saved note view mode", () => {
    expect(loadUiPreferences().noteViewMode).toBe("preview")

    saveUiPreferences({ noteViewMode: "edit" })

    expect(loadUiPreferences().noteViewMode).toBe("edit")
  })

  it("falls back safely when cached data is invalid", () => {
    window.localStorage.setItem("swell-note:ui-preferences:v1", "{invalid")
    expect(loadUiPreferences().noteViewMode).toBe("preview")

    window.localStorage.setItem("swell-note:ui-preferences:v1", JSON.stringify({ noteViewMode: "unknown" }))
    expect(loadUiPreferences().noteViewMode).toBe("preview")
  })

  it("keeps unrelated preference fields when updating one value", () => {
    window.localStorage.setItem("swell-note:ui-preferences:v1", JSON.stringify({ colorMode: "dark" }))

    saveUiPreferences({ noteViewMode: "edit" })

    expect(JSON.parse(window.localStorage.getItem("swell-note:ui-preferences:v1") ?? "{}")).toEqual({
      colorMode: "dark",
      noteViewMode: "edit",
    })
  })
})
