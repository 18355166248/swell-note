// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { collectPreviewMatches, PreviewSearch } from "./preview-search"

afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren() })

function preview(html: string) {
  const root = document.createElement("div")
  root.innerHTML = html
  document.body.append(root)
  return root
}

describe("reading-mode search", () => {
  it("searches the body while a closing dialog still hides its outer container", () => {
    const root = preview('<p>目标命中</p><span aria-hidden="true">目标命中</span>')
    document.body.setAttribute("aria-hidden", "true")
    try {
      expect(collectPreviewMatches(root, "目标命中")).toHaveLength(1)
    } finally {
      document.body.removeAttribute("aria-hidden")
    }
  })
  it("finds across inline formatting without joining unrelated paragraphs or buttons", () => {
    const root = preview('<p>查<strong>找</strong>内容</p><p>查</p><p>找</p><button>查找</button><span aria-hidden="true">查找</span>')
    const matches = collectPreviewMatches(root, "查找")
    expect(matches.map((range) => range.toString())).toEqual(["查找"])
  })
  it("treats punctuation literally and keeps unicode offsets correct", () => {
    const root = preview('<p>😀 a.b A.B aXb</p>')
    expect(collectPreviewMatches(root, "a.b").map((range) => range.toString())).toEqual(["a.b", "A.B"])
  })
  it("wraps both directions, resets on a new query, and clears only its own fallback selection", () => {
    const root = preview('<p>查找一</p><p>查找二</p>')
    const search = new PreviewSearch()
    expect(search.find(root, "查找")).toEqual({ current: 1, total: 2 })
    expect(search.find(root, "查找", "previous")).toEqual({ current: 2, total: 2 })
    expect(search.find(root, "查找")).toEqual({ current: 1, total: 2 })
    expect(search.find(root, "查找二")).toEqual({ current: 1, total: 1 })
    expect(window.getSelection()?.toString()).toBe("查找二")
    search.clear()
    expect(window.getSelection()?.toString()).toBe("")
    expect(search.find(root, "不存在")).toEqual({ current: 0, total: 0 })
  })
  it("includes later rendered content without advancing the current result", () => {
    const root = preview('<p>查找一</p>')
    const search = new PreviewSearch()
    search.find(root, "查找")
    const paragraph = document.createElement("p")
    paragraph.textContent = "查找二"
    root.append(paragraph)
    expect(search.find(root, "查找", "next", false, true)).toEqual({ current: 1, total: 2 })
    search.clear()
  })
})
