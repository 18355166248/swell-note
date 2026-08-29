import { describe, expect, it } from "vitest"

import { sanitizeImportedMarkdownName, uniqueMarkdownPath } from "./markdown-import"

describe("Markdown import", () => {
  it("accepts Markdown and sanitizes invalid filename characters", () => {
    expect(sanitizeImportedMarkdownName("需求:第一版?.md")).toBe("需求-第一版-.md")
    expect(sanitizeImportedMarkdownName("图片.png")).toBeNull()
  })

  it("avoids overwriting an existing note", () => {
    const reserved = new Set(["/swell/code/计划.md"])
    expect(uniqueMarkdownPath("code", "计划.md", (path) => `/Swell/${path}`, reserved)).toEqual({
      displayPath: "code/计划 (2).md",
      storagePath: "/Swell/code/计划 (2).md",
    })
  })
})
