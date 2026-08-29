// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"

import { applyColorMode, loadUiPreferences, saveUiPreferences } from "./ui-preferences"

describe("UI preferences", () => {
  beforeEach(() => window.localStorage.clear())

  it("defaults to preview and restores the saved note view mode", () => {
    expect(loadUiPreferences()).toEqual({
      colorMode: "system",
      libraryPaneWidth: 230,
      noteListPaneWidth: 320,
      noteViewMode: "preview",
    })

    saveUiPreferences({ noteViewMode: "edit" })

    expect(loadUiPreferences().noteViewMode).toBe("edit")
  })

  it("falls back safely when cached data is invalid", () => {
    window.localStorage.setItem("swell-note:ui-preferences:v1", "{invalid")
    expect(loadUiPreferences().noteViewMode).toBe("preview")

    window.localStorage.setItem("swell-note:ui-preferences:v1", JSON.stringify({ noteViewMode: "unknown" }))
    expect(loadUiPreferences().noteViewMode).toBe("preview")
  })

  it("restores a valid color mode and falls back to system", () => {
    saveUiPreferences({ colorMode: "dark" })
    expect(loadUiPreferences().colorMode).toBe("dark")

    window.localStorage.setItem("swell-note:ui-preferences:v1", JSON.stringify({ colorMode: "unknown" }))
    expect(loadUiPreferences().colorMode).toBe("system")
  })

  it("applies manual and system color modes to the document", () => {
    applyColorMode("dark", false)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.dataset.colorMode).toBe("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")

    applyColorMode("system", false)
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.dataset.colorMode).toBe("system")
    expect(document.documentElement.style.colorScheme).toBe("light")
  })

  it("keeps unrelated preference fields when updating one value", () => {
    window.localStorage.setItem("swell-note:ui-preferences:v1", JSON.stringify({ colorMode: "dark" }))

    saveUiPreferences({ noteViewMode: "edit" })

    expect(JSON.parse(window.localStorage.getItem("swell-note:ui-preferences:v1") ?? "{}")).toEqual({
      colorMode: "dark",
      noteViewMode: "edit",
    })
  })

  it("restores desktop pane widths and clamps invalid values", () => {
    saveUiPreferences({ libraryPaneWidth: 260, noteListPaneWidth: 390 })
    expect(loadUiPreferences()).toMatchObject({ libraryPaneWidth: 260, noteListPaneWidth: 390 })

    saveUiPreferences({ libraryPaneWidth: 999, noteListPaneWidth: 10 })
    expect(loadUiPreferences()).toMatchObject({ libraryPaneWidth: 340, noteListPaneWidth: 280 })
  })
})
