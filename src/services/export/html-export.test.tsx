// @vitest-environment jsdom
import { expect, it, vi } from "vitest"
import { createHtmlDocument } from "./html-export"
it("完整树收集引用式图片，内嵌附件、MathML 和表格，转义标题并忽略原始脚本", async () => {
  const read = vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }))
  const { html, warnings } = await createHtmlDocument({ title: '<危险>"标题"', content: '![图][pic]\n\n[pic]: attachments/a.png\n\n$$\nx^2\n$$\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n<script>alert(1)</script>', readAsset: read })
  expect(read).toHaveBeenCalledExactlyOnceWith("attachments/a.png")
  expect(html).toContain("data:image/png;base64,AQID")
  expect(html).toContain("<math")
  expect(html).toContain("<table>")
  expect(html).toContain("&lt;危险&gt;")
  expect(html).not.toContain("<script>")
  expect(warnings).toEqual([])
})
it("缺失附件和未展开笔记嵌入显示说明，正文保留且不请求外网", async () => {
  const read = vi.fn(async () => null)
  const result = await createHtmlDocument({ title: "标题", content: '![失效](a.png)\n\n![[另篇]]\n\n![远图](https://example.com/a.png)\n\n继续正文', readAsset: read })
  expect(read).toHaveBeenCalledExactlyOnceWith("a.png")
  expect(result.warnings).toHaveLength(3)
  expect(result.html).toContain("未包含图片：失效")
  expect(result.html).toContain("笔记嵌入：另篇")
  expect(result.html).toContain("继续正文")
})

it.each([
  ["旧 title 尺寸", '![图](a.png "480")', "480px"],
  ["新宽度优先", '![图](a.png "480")<!-- swell-image:width=640 -->', "640px"],
  ["新自适应覆盖旧宽度", '![图](a.png "480")<!-- swell-image:width=auto -->', ""],
])("导出图片保留 %s 并保留 title", async (_scenario, content, expectedWidth) => {
  const { html } = await createHtmlDocument({
    title: "尺寸兼容",
    content,
    readAsset: async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }),
  })
  const image = new DOMParser().parseFromString(html, "text/html").querySelector("img")
  expect(image?.style.width).toBe(expectedWidth)
  expect(image?.getAttribute("title")).toBe("480")
})
