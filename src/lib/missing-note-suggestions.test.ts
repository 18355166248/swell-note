import { describe, expect, it } from "vitest"

import type { Note } from "@/types/note"
import { findMissingNoteSuggestions } from "./missing-note-suggestions"

function note(title: string, folder = "XIMA广告"): Note {
  const path = `/Swell/${folder}/${title}.md`
  return {
    content: "",
    folder,
    id: `webdav:${path}`,
    preview: "",
    remotePath: path,
    source: "webdav",
    starred: false,
    title,
    updatedAt: "刚刚",
  }
}

describe("missing note suggestions", () => {
  it("prioritizes related renamed notes in the same folder", () => {
    const suggestions = findMissingNoteSuggestions(
      "webdav:/Swell/XIMA广告/【喜马】网赚提现接入下载.md",
      [note("无关广告需求"), note("提现页面"), note("【网赚】【web后端】提现流程优化")],
    )

    expect(suggestions.map((item) => item.title)).toEqual([
      "提现页面",
      "【网赚】【web后端】提现流程优化",
    ])
  })

  it("does not recommend unrelated notes only because they share a folder", () => {
    expect(findMissingNoteSuggestions(
      "webdav:/Swell/XIMA广告/提现下载.md",
      [note("广告实验"), note("播放器改造")],
    )).toEqual([])
  })

  it("understands encoded legacy paths", () => {
    const result = findMissingNoteSuggestions(
      "webdav:/Swell/XIMA%E5%B9%BF%E5%91%8A/%E6%8F%90%E7%8E%B0%E4%B8%8B%E8%BD%BD.md",
      [note("提现下载方案")],
    )
    expect(result[0]?.title).toBe("提现下载方案")
  })
})
