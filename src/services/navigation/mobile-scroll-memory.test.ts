import { describe, expect, it } from "vitest"

import { createScrollPositionMemory } from "./mobile-scroll-memory"

describe("mobile scroll position memory", () => {
  it("按页面键保存位置并把负值归零", () => {
    const memory = createScrollPositionMemory()
    memory.set("folder:a", 860)
    memory.set("folder:b", -20)

    expect(memory.get("folder:a")).toBe(860)
    expect(memory.get("folder:b")).toBe(0)
    expect(memory.get("missing")).toBe(0)
  })

  it("超过容量时淘汰最久未访问的位置", () => {
    const memory = createScrollPositionMemory(2)
    memory.set("a", 10)
    memory.set("b", 20)
    expect(memory.get("a")).toBe(10)
    memory.set("c", 30)

    expect(memory.get("b")).toBe(0)
    expect(memory.get("a")).toBe(10)
    expect(memory.get("c")).toBe(30)
  })
})
