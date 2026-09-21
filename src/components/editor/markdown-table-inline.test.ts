// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { rawOffsetForDisplayOffset, renderTableInlineMarkdown } from "./markdown-table-inline"

function renderInline(source: string) {
  const element = document.createElement("div")
  renderTableInlineMarkdown(element, source)
  return element
}

describe("表格内链接完整展示（不截短、不剥协议头，超出列宽换行）", () => {
  it("带标签的链接原样显示标签文字", () => {
    const element = renderInline("[示例](https://example.com)")
    expect(element.querySelector("a")?.textContent).toBe("示例")
  })

  it("超长 URL 完整显示，不打省略号", () => {
    const url = "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/wx-%E8%AE%BE%E8%AE%A1%E7%A8%BF?node-id=1234-5678&t=abcdef"
    const element = renderInline(url)
    const link = element.querySelector("a")
    expect(link?.textContent).toBe(url)
    expect(link?.textContent).not.toContain("…")
    expect(link?.dataset.mdHref).toBe(url)
  })

  it("非 URL 的长标签同样完整显示", () => {
    const label = "这是一段被用户刻意写得很长很长的链接标签文字，已经超过四十个字符的显示限制长度了，还需要继续截短"
    const element = renderInline(`[${label}](https://example.com)`)
    expect(element.querySelector("a")?.textContent).toBe(label)
  })
})

describe("rawOffsetForDisplayOffset（展示层偏移 → 原文偏移）", () => {
  it("转义标点与实体显示为字面文本，且不会误生成强调", () => {
    const source = "1\\.2\\.3 \\*不是斜体\\* \\&copy; &amp;"
    const element = renderInline(source)
    expect(element.textContent).toBe("1.2.3 *不是斜体* &copy; &")
    expect(element.querySelector("em")).toBeNull()

    // 转义标点吃掉一个反斜杠，实体则把一个显示字符映射到完整原文范围末端。
    expect(rawOffsetForDisplayOffset("\\*甲", 0)).toBe(1)
    expect(rawOffsetForDisplayOffset("\\*甲", 1)).toBe(2)
    expect(rawOffsetForDisplayOffset("&amp;甲", 0)).toBe(0)
    expect(rawOffsetForDisplayOffset("&amp;甲", 1)).toBe(5)
  })

  it("格式标记内部递归处理转义文本并保持显示偏移映射", () => {
    const source = "**1\\.2\\.3 \\*不是斜体\\***"
    const element = renderInline(source)
    expect(element.querySelector("strong")?.textContent).toBe("1.2.3 *不是斜体*")
    expect(element.querySelector("strong em")).toBeNull()

    // 显示到第一个点之后时，应越过 ** 与点前的反斜杠。
    expect(rawOffsetForDisplayOffset(source, 2)).toBe(5)
  })

  it("链接标签允许转义方括号，仍生成单个可点击链接", () => {
    const source = "[\\[文档\\]](https://example.com)"
    const element = renderInline(source)
    const links = element.querySelectorAll("a")
    expect(links).toHaveLength(1)
    expect(links[0].textContent).toBe("[文档]")
    expect(links[0].dataset.mdHref).toBe("https://example.com")
    expect(element.textContent).toBe("[文档]")

    expect(rawOffsetForDisplayOffset(source, 0)).toBe(2)
    expect(rawOffsetForDisplayOffset(source, 1)).toBe(3)
  })

  it("任意长度反引号围栏只生成一个代码节点且不露标记", () => {
    const source = "```a``b```"
    const element = renderInline(source)
    expect(element.querySelectorAll("code")).toHaveLength(1)
    expect(element.querySelector("code")?.textContent).toBe("a``b")
    expect(element.textContent).toBe("a``b")
    expect(rawOffsetForDisplayOffset(source, 3)).toBe(6)
  })
  it("没有行内标记时逐字符对应", () => {
    expect(rawOffsetForDisplayOffset("普通文字", 0)).toBe(0)
    expect(rawOffsetForDisplayOffset("普通文字", 2)).toBe(2)
    expect(rawOffsetForDisplayOffset("普通文字", 9)).toBe(4)
  })

  it("加粗标记被展示层吃掉，偏移落回标记内侧", () => {
    // 原文 "**加粗**文字"，展示 "加粗文字"；边界偏移收敛到标记内侧（等价视觉位置）。
    expect(rawOffsetForDisplayOffset("**加粗**文字", 0)).toBe(2)
    expect(rawOffsetForDisplayOffset("**加粗**文字", 1)).toBe(3)
    expect(rawOffsetForDisplayOffset("**加粗**文字", 2)).toBe(4)
    expect(rawOffsetForDisplayOffset("**加粗**文字", 3)).toBe(7)
    expect(rawOffsetForDisplayOffset("**加粗**文字", 4)).toBe(8)
  })

  it("链接只显示标签文字", () => {
    // 原文 "[标签](https://a.com)"，展示 "标签"
    expect(rawOffsetForDisplayOffset("[标签](https://a.com)", 1)).toBe(2)
    expect(rawOffsetForDisplayOffset("[标签](https://a.com)", 2)).toBe(3)
  })

  it("删除线与行内代码的标记同样跳过", () => {
    // "~~删~~除" 展示 "删除"；边界偏移落在闭合标记内侧（视觉等价位置）。
    expect(rawOffsetForDisplayOffset("~~删~~除", 1)).toBe(3)
    // "`代码` 后" 展示 "代码 后"
    expect(rawOffsetForDisplayOffset("`代码` 后", 2)).toBe(3)
    expect(rawOffsetForDisplayOffset("`代码` 后", 4)).toBe(6)
  })

  it("空单元格与越界偏移安全收敛", () => {
    expect(rawOffsetForDisplayOffset("", 0)).toBe(0)
    expect(rawOffsetForDisplayOffset("", 5)).toBe(0)
    expect(rawOffsetForDisplayOffset("**加粗**", 99)).toBe(6)
  })

  it("裸链接完整展示，显示偏移与原文逐位对应", () => {
    // 展示与原文都是 "https://example.com"，起点越过 0 位、末尾落在原文第 19 位。
    expect(rawOffsetForDisplayOffset("https://example.com", 0)).toBe(0)
    expect(rawOffsetForDisplayOffset("https://example.com", 11)).toBe(11)
    expect(rawOffsetForDisplayOffset("https://example.com", 19)).toBe(19)
    // 前面还有普通文本时段内偏移同样 1:1。
    expect(rawOffsetForDisplayOffset("见 https://example.com 收尾", 13)).toBe(13)
  })

  it("长链接不做截短，显示偏移一直落到原文末尾", () => {
    const url = "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/wx-%E8%AE%BE%E8%AE%A1%E7%A8%BF?node-id=1234-5678&t=abcdef"
    expect(rawOffsetForDisplayOffset(url, 0)).toBe(0)
    expect(rawOffsetForDisplayOffset(url, 40)).toBe(40)
    expect(rawOffsetForDisplayOffset(url, url.length)).toBe(url.length)
  })

  it("带标签的长链接在标签段内 1:1 还原", () => {
    // 原文 "[https://example.com](https://a.com)"，展示 "https://example.com"，起始要越过 "[" 一位。
    expect(rawOffsetForDisplayOffset("[https://example.com](https://a.com)", 11)).toBe(12)
  })
})
