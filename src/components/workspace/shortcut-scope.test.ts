// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import { hasOpenModal, isTextEntryElement, selectElementContents } from "./shortcut-scope"

afterEach(() => {
  document.body.innerHTML = ""
  window.getSelection()?.removeAllRanges()
})

describe("isTextEntryElement", () => {
  it("输入框自己的全选范围就是对的，不该被接管", () => {
    document.body.innerHTML = `<input id="search" />`

    expect(isTextEntryElement(document.getElementById("search"))).toBe(true)
  })

  it("多行输入同理", () => {
    document.body.innerHTML = `<textarea id="note"></textarea>`

    expect(isTextEntryElement(document.getElementById("note"))).toBe(true)
  })

  it("可编辑正文交给 CodeMirror 自己的全选", () => {
    document.body.innerHTML = `<div contenteditable="true"><span id="line">正文</span></div>`

    expect(isTextEntryElement(document.getElementById("line"))).toBe(true)
  })

  it("只读编辑器不是输入区，全选要由外层接管", () => {
    document.body.innerHTML = `<div contenteditable="false"><span id="line">正文</span></div>`

    expect(isTextEntryElement(document.getElementById("line"))).toBe(false)
  })

  it("焦点落在正文之外时接管，这正是整页全选的来源", () => {
    document.body.innerHTML = `<aside id="sidebar">笔记库</aside>`

    expect(isTextEntryElement(document.getElementById("sidebar"))).toBe(false)
  })

  it("没有焦点元素时按接管处理", () => {
    expect(isTextEntryElement(null)).toBe(false)
  })
})

describe("hasOpenModal", () => {
  it("重命名等弹窗开着时，快捷键不该去动它背后的笔记", () => {
    document.body.innerHTML = `<div data-slot="dialog-content"><input /></div>`

    expect(hasOpenModal()).toBe(true)
  })

  it("移动端动作面板同样是弹窗", () => {
    document.body.innerHTML = `<div class="mobile-action-sheet" data-slot="dialog-content"></div>`

    expect(hasOpenModal()).toBe(true)
  })

  it("没有弹窗时快捷键照常工作", () => {
    document.body.innerHTML = `<article class="note-editor"></article>`

    expect(hasOpenModal()).toBe(false)
  })
})

describe("selectElementContents", () => {
  it("只选中给定元素的内容，侧边栏不会被带进去", () => {
    document.body.innerHTML = `<aside>笔记库 全部笔记</aside><article class="markdown-preview">正文内容</article>`
    const preview = document.querySelector(".markdown-preview")

    expect(selectElementContents(preview)).toBe(true)
    expect(window.getSelection()?.toString()).toBe("正文内容")
  })

  it("替换掉上一次的选区，不会累加", () => {
    document.body.innerHTML = `<p id="first">第一段</p><p id="second">第二段</p>`
    selectElementContents(document.getElementById("first"))
    selectElementContents(document.getElementById("second"))

    expect(window.getSelection()?.toString()).toBe("第二段")
  })

  it("目标不存在时不动选区", () => {
    expect(selectElementContents(null)).toBe(false)
  })
})
