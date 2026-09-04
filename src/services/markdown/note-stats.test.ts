import { describe, expect, it } from "vitest"

import { countWords, estimateReadingMinutes } from "./note-stats"

describe("countWords", () => {
  it("counts CJK characters individually", () => {
    expect(countWords("今天写了三行字")).toBe(7)
  })

  it("counts latin runs as one word each", () => {
    expect(countWords("hello  world\nfoo-bar it's")).toBe(4)
  })

  it("mixes CJK and latin", () => {
    // 在 里 写 = 3 个字，React / hook = 2 个词
    expect(countWords("在 React 里写 hook")).toBe(5)
  })

  it("is zero for whitespace and punctuation only", () => {
    expect(countWords("  \n\t —— ，。！ ")).toBe(0)
  })
})

describe("estimateReadingMinutes", () => {
  it("is zero for empty content", () => {
    expect(estimateReadingMinutes("   ")).toBe(0)
  })

  it("rounds up to at least one minute for short notes", () => {
    expect(estimateReadingMinutes("短笔记")).toBe(1)
  })

  it("scales at roughly 300 words per minute", () => {
    expect(estimateReadingMinutes("字".repeat(900))).toBe(3)
  })
})
