// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { markdownLanguage } from "@codemirror/lang-markdown"

import { htmlToMarkdown, isInlineMarkdownFragment } from "./html-to-markdown"

describe("htmlToMarkdown", () => {
  it("没有可用结构时返回 null，交给纯文本粘贴", () => {
    expect(htmlToMarkdown("")).toBeNull()
    expect(htmlToMarkdown("只是一段纯文本")).toBeNull()
    expect(htmlToMarkdown("<span>只有行内容</span>")).toBeNull()
  })

  it("转换标题、段落与行内格式", () => {
    const html = "<h2>标题</h2><p>普通<strong>加粗</strong><em>斜体</em><del>删除</del><code>code</code></p>"
    expect(htmlToMarkdown(html)).toBe("## 标题\n\n普通**加粗***斜体*~~删除~~`code`")
  })

  it("链接只保留安全协议，javascript: 降级为纯文字", () => {
    expect(htmlToMarkdown('<p><a href="https://example.com">站点</a></p>')).toBe("[站点](https://example.com)")
    expect(htmlToMarkdown('<p><a href="javascript:alert(1)">危险</a></p>')).toBe("危险")
    expect(htmlToMarkdown('<p><a href="mailto:a@b.com">邮件</a></p>')).toBe("[邮件](mailto:a@b.com)")
  })

  it("script/style 等内容被丢弃，不进入笔记", () => {
    const html = '<p>前</p><script>alert(1)</script><style>.x{}</style><p>后</p>'
    expect(htmlToMarkdown(html)).toBe("前\n\n后")
  })

  it("列表支持嵌套与有序起始编号", () => {
    const html = "<ul><li>甲<ul><li>子项</li></ul></li><li>乙</li></ul><ol start=\"3\"><li>三</li></ol>"
    expect(htmlToMarkdown(html)).toBe("- 甲\n  - 子项\n- 乙\n\n3. 三")
  })

  it("引用与代码块保留，代码内容含 ``` 时换更长的围栏", () => {
    expect(htmlToMarkdown("<blockquote><p>引文</p></blockquote>")).toBe("> 引文")
    expect(htmlToMarkdown("<pre>const a = 1</pre>")).toBe("```\nconst a = 1\n```")
    expect(htmlToMarkdown("<pre>```js\nx\n```</pre>")).toBe("````\n```js\nx\n```\n````")
  })

  it("表格转 GFM：首行作表头，管道转义，换行变 <br>", () => {
    const html = '<table><tr><th>名</th><th>值</th></tr><tr><td>a|b</td><td>多<br>行</td></tr></table>'
    expect(htmlToMarkdown(html)).toBe("| 名 | 值 |\n| --- | --- |\n| a\\|b | 多<br>行 |")
  })

  it("合并单元格展开为完整网格，文字保留在起始格不丢失", () => {
    const html = '<table><tr><td colspan="2">横跨</td><td>右</td></tr><tr><td>甲</td><td>乙</td><td>丙</td></tr></table>'
    expect(htmlToMarkdown(html)).toBe("| 横跨 |  | 右 |\n| --- | --- | --- |\n| 甲 | 乙 | 丙 |")
  })

  it("图片只保留 http(s) 地址，其余协议只留 alt 文字", () => {
    expect(htmlToMarkdown('<p><img src="https://a.com/x.png" alt="示意"></p>')).toBe("![示意](https://a.com/x.png)")
    expect(htmlToMarkdown('<p><img src="data:image/png;base64,xx" alt="内嵌"></p>')).toBe("内嵌")
  })

  it("解析异常时返回 null 而不是抛出", () => {
    // DOMParser 对任何字符串都不抛错，这里主要断言畸形输入也能安全降级。
    expect(() => htmlToMarkdown("<table><tr><td>未闭合")).not.toThrow()
  })

  it("rowspan 覆盖到跨度的最后一行，后续行的单元格不错列", () => {
    // 首行 A 纵跨两行：次行的 C 应落在 B 列，而不是被提前失效的占位挤到 A 列。
    const html = '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>'
    expect(htmlToMarkdown(html)).toBe("| A | B |\n| --- | --- |\n|  | C |")
  })

  it("任务列表保留列表标记，复选框可继续勾选", () => {
    const html = '<ul><li><input type="checkbox" checked>done</li><li><input type="checkbox">todo</li></ul>'
    expect(htmlToMarkdown(html)).toBe("- [x] done\n- [ ] todo")
  })

  it("嵌套列表按父条目标记宽度缩进，有序列表内层级不丢", () => {
    const html = '<ol><li>甲<ul><li>子项</li></ul></li><li>乙</li></ol>'
    expect(htmlToMarkdown(html)).toBe("1. 甲\n   - 子项\n2. 乙")
    // 两位编号的有序标记更宽，子列表仍须对齐内容起始位置。
    const wide = '<ol start="10"><li>甲<ul><li>子项</li></ul></li></ol>'
    expect(htmlToMarkdown(wide)).toBe("10. 甲\n    - 子项")
  })

  it("代码块内部的空行原样保留，块间空行仍被压缩", () => {
    expect(htmlToMarkdown("<pre>a\n\n\nb</pre>")).toBe("```\na\n\n\nb\n```")
    // 容器嵌套里的代码块同样不受排版空行压缩影响。
    expect(htmlToMarkdown("<div><p>前</p><pre>a\n\n\nb</pre></div>")).toBe("前\n\n```\na\n\n\nb\n```")
  })

  it("外层用更长围栏时，内层短围栏不干扰空行保留", () => {
    // 代码含 ``` 时外层用 ```` 包裹：内层 ```js 不是关闭围栏，其后的空行仍属代码内容。
    expect(htmlToMarkdown("<pre>```js\nx\n```\n\n\ny</pre>")).toBe("````\n```js\nx\n```\n\n\ny\n````")
  })

  it("带尾随文字的等长反引号行是代码内容，不关闭围栏", () => {
    // 关闭围栏要求反引号之后仅余空白：````js 只是代码内容，其后的空行必须保留。
    expect(htmlToMarkdown("<pre>````js\n\n\nx</pre>")).toBe("````\n````js\n\n\nx\n````")
  })

  it("行内片段与块级结构的判定", () => {
    expect(isInlineMarkdownFragment("**词语**")).toBe(true)
    expect(isInlineMarkdownFragment("[站点](https://example.com)")).toBe(true)
    expect(isInlineMarkdownFragment("![示意](https://a.com/x.png)")).toBe(true)
    expect(isInlineMarkdownFragment("普通一段")).toBe(true)
    expect(isInlineMarkdownFragment("## 标题")).toBe(false)
    expect(isInlineMarkdownFragment("- 列表项")).toBe(false)
    expect(isInlineMarkdownFragment("- [x] 任务")).toBe(false)
    expect(isInlineMarkdownFragment("1. 有序")).toBe(false)
    expect(isInlineMarkdownFragment("> 引用")).toBe(false)
    expect(isInlineMarkdownFragment("---")).toBe(false)
    expect(isInlineMarkdownFragment("```\ncode\n```")).toBe(false)
    expect(isInlineMarkdownFragment("前\n后")).toBe(false)
  })

  it("转换结果被项目 Markdown 解析器识别为正确的层级与任务标记", () => {
    // 有序列表内嵌无序列表：顶层只有有序列表，子列表嵌在其中而不是平级。
    const nested = markdownLanguage.parser.parse(htmlToMarkdown('<ol><li>甲<ul><li>子项</li></ul></li><li>乙</li></ol>')!)
    const top: string[] = []
    for (let node = nested.topNode.firstChild; node; node = node.nextSibling) top.push(node.name)
    expect(top).toEqual(["OrderedList"])
    let hasNestedBullet = false
    nested.cursor().iterate((node) => { if (node.name === "BulletList") hasNestedBullet = true })
    expect(hasNestedBullet).toBe(true)

    // 任务列表：复选框是 TaskMarker，而不是普通段落文字。
    const tasks = markdownLanguage.parser.parse(htmlToMarkdown('<ul><li><input type="checkbox" checked>done</li></ul>')!)
    let hasTaskMarker = false
    tasks.cursor().iterate((node) => { if (node.name === "TaskMarker") hasTaskMarker = true })
    expect(hasTaskMarker).toBe(true)
  })
})
