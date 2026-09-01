// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { isSelectionDismissTap, keepsSelectionAlive } from "./selection-dismiss"

const origin = { at: 1000, x: 100, y: 200 }

describe("isSelectionDismissTap", () => {
  it("原地快速点按算点击，选区该收起", () => {
    expect(isSelectionDismissTap(origin, { at: 1120, x: 101, y: 199 })).toBe(true)
  })

  it("滑动看正文不算点击，选区要留着", () => {
    expect(isSelectionDismissTap(origin, { at: 1150, x: 104, y: 260 })).toBe(false)
  })

  it("横向拖动同样不算点击", () => {
    expect(isSelectionDismissTap(origin, { at: 1150, x: 180, y: 202 })).toBe(false)
  })

  it("长按选词的抬手没有位移，靠时长排除，否则刚选中的词会被立刻取消", () => {
    expect(isSelectionDismissTap(origin, { at: 1700, x: 100, y: 200 })).toBe(false)
  })

  it("刚好压在时长上限内仍算点击", () => {
    expect(isSelectionDismissTap(origin, { at: 1400, x: 100, y: 200 })).toBe(true)
  })

  it("没有起点时不做判断", () => {
    expect(isSelectionDismissTap(null, { at: 1100, x: 100, y: 200 })).toBe(false)
  })
})

describe("keepsSelectionAlive", () => {
  it("选区操作条上的按钮要保住选区，否则复制到的是空内容", () => {
    document.body.innerHTML = `<div class="selection-action-bar"><button id="copy">复制</button></div>`

    expect(keepsSelectionAlive(document.getElementById("copy"))).toBe(true)
  })

  it("格式工具栏同样作用在选区上", () => {
    document.body.innerHTML = `<div class="formatting-toolbar"><button id="bold">B</button></div>`

    expect(keepsSelectionAlive(document.getElementById("bold"))).toBe(true)
  })

  it("正文与留白不属于工具栏，点了就收起选区", () => {
    document.body.innerHTML = `<div class="markdown-editor-shell"><div id="blank"></div></div>`

    expect(keepsSelectionAlive(document.getElementById("blank"))).toBe(false)
  })

  it("没有命中元素时按收起处理", () => {
    expect(keepsSelectionAlive(null)).toBe(false)
  })
})
