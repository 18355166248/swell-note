import { describe, expect, it } from "vitest"

import { buildNoteLineDiff } from "./note-line-diff"

describe("note line diff", () => {
  it("按当前到历史的方向标出删除和新增及行号", () => {
    const diff = buildNoteLineDiff("相同\n当前行\n末尾", "相同\n历史行\n末尾")
    expect(diff.added).toBe(1)
    expect(diff.removed).toBe(1)
    expect(diff.rows).toEqual([
      { currentLine: 1, kind: "context", selectedLine: 1, text: "相同" },
      { currentLine: 2, kind: "removed", text: "当前行" },
      { kind: "added", selectedLine: 2, text: "历史行" },
      { currentLine: 3, kind: "context", selectedLine: 3, text: "末尾" },
    ])
  })

  it("长段未变化内容保留两端上下文", () => {
    const current = Array.from({ length: 20 }, (_, index) => `行 ${index}`).join("\n")
    const diff = buildNoteLineDiff(current, current.replace("行 18", "新行"))
    expect(diff.rows.some((row) => row.kind === "omitted" && row.omittedCount === 12)).toBe(true)
    expect(diff.rows.some((row) => row.kind === "added" && row.text === "新行")).toBe(true)
  })

  it("大量完全不同的行限时计算并截断预览", () => {
    const current = Array.from({ length: 2_500 }, (_, index) => `当前 ${index}`).join("\n")
    const selected = Array.from({ length: 2_500 }, (_, index) => `历史 ${index}`).join("\n")
    const diff = buildNoteLineDiff(current, selected)
    expect(diff.simplified).toBe(true)
    expect(diff.truncated).toBe(true)
    expect(diff.rows.length).toBe(601)
  })
})
