import { describe, expect, it } from "vitest"

import { resolveWebDavPhysicalPath } from "./webdav-physical-path"

describe("WebDAV physical path", () => {
  const adapter = { getStoragePath: (path: string) => `/Swell/${path}` }

  it("resolves a logical A→B→C chain back to its current remote source", () => {
    expect(resolveWebDavPhysicalPath("/Swell/C/n.md", [
      { id: "one", sourceFolder: "A", targetFolder: "B" },
      { id: "two", sourceFolder: "B", targetFolder: "C" },
    ], adapter)).toBe("/Swell/A/n.md")
  })

  it("does not reverse a MOVE that already reached the remote target", () => {
    expect(resolveWebDavPhysicalPath("/Swell/B/n.md", [
      { id: "one", moved: true, sourceFolder: "A", targetFolder: "B" },
    ], adapter)).toBe("/Swell/B/n.md")
  })
})
