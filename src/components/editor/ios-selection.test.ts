import { describe, expect, it } from "vitest"

import { shouldDrawCodeMirrorSelection } from "./markdown-editor"

describe("CodeMirror selection rendering platform", () => {
  it("iPhone 和 iPadOS 使用系统原生光标与选区", () => {
    expect(shouldDrawCodeMirrorSelection({
      maxTouchPoints: 5,
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    })).toBe(false)
    expect(shouldDrawCodeMirrorSelection({
      maxTouchPoints: 5,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
    })).toBe(false)
  })

  it("macOS 与 Android 继续使用 CodeMirror 自绘选区", () => {
    expect(shouldDrawCodeMirrorSelection({
      maxTouchPoints: 0,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    })).toBe(true)
    expect(shouldDrawCodeMirrorSelection({
      maxTouchPoints: 5,
      platform: "Linux armv8l",
      userAgent: "Mozilla/5.0 (Linux; Android 15)",
    })).toBe(true)
  })
})
