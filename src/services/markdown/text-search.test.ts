import { describe, expect, it } from "vitest"
import { findTextMatches } from "./text-search"

describe("single-note literal search", () => {
  it("大小写和全词组合不会替换词内的子串", () => {
    const text = "cat Cat scatter cat_ cat."
    expect(findTextMatches(text, "cat", { caseSensitive: true, wholeWord: true })).toEqual([{ from: 0, to: 3 }, { from: 21, to: 24 }])
    expect(findTextMatches(text, "cat", { wholeWord: true })).toHaveLength(3)
    expect(findTextMatches(text, "cat")).toHaveLength(5)
  })
  it("中文和组合字符按 Unicode 词边界处理", () => {
    expect(findTextMatches("猫 猫咪 🐱猫", "猫", { wholeWord: true })).toEqual([{ from: 0, to: 1 }, { from: 7, to: 8 }])
    expect(findTextMatches("e\u0301 e", "e", { wholeWord: true })).toEqual([{ from: 3, to: 4 }])
  })
  it("只允许完全位于固定选区的命中，正则字符是字面量", () => {
    expect(findTextMatches("a.b a.b a.b", "a.b", { range: { from: 4, to: 9 } })).toEqual([{ from: 4, to: 7 }])
    expect(findTextMatches("a.b aXb", "a.b")).toEqual([{ from: 0, to: 3 }])
    expect(findTextMatches("cat", "cat", { range: { from: 1, to: 3 } })).toEqual([])
  })
})
