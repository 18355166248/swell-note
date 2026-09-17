import { describe, expect, it } from "vitest"

import { markdownTextMatches } from "./vditor-editor"

describe("markdownTextMatches", () => {
  it("finds every case-insensitive occurrence without looping on adjacent matches", () => {
    expect(markdownTextMatches("Note note NOTE", "note")).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 9 },
      { from: 10, to: 14 },
    ])
    expect(markdownTextMatches("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ])
  })

  it("returns no matches for an empty query", () => {
    expect(markdownTextMatches("正文", "")).toEqual([])
  })
})
