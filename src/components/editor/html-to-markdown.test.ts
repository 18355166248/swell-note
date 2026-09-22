// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { markdownLanguage } from "@codemirror/lang-markdown"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { remarkObsidian } from "@/services/markdown/remark-obsidian"

import { createClipboardImageCoverage, htmlNeedsClipboardImageFiles, htmlToMarkdown, isInlineMarkdownFragment, shouldInsertClipboardImageFiles, type HtmlImagePlaceholder } from "./html-to-markdown"

function renderMarkdown(markdown: string) {
  // 与正式阅读态一致，兼容旧 Vault 语法的 remark 插件也参与转换结果验收。
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkObsidian] }, markdown))
  return new DOMParser().parseFromString(html, "text/html").body
}

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

  it("图片只保留 http(s) 地址，其余协议保留可见占位而不是静默丢弃", () => {
    expect(htmlToMarkdown('<p><img src="https://a.com/x.png" alt="示意"></p>')).toBe("![示意](https://a.com/x.png)")
    // 非 http(s)：alt 作为说明保留，并附上无法导入的原因，用户能看到这里原本有一张图。
    expect(htmlToMarkdown('<p><img src="data:image/png;base64,xx" alt="内嵌"></p>')).toBe("内嵌（图片无法导入：data: 地址不导入）")
    expect(htmlToMarkdown('<p><img src="file:///tmp/a.png" alt="本地"></p>')).toBe("本地（图片无法导入：本地文件地址不导入）")
  })

  it("非 http(s) 图片没有 alt 时也留下可见占位", () => {
    const markdown = htmlToMarkdown('<p><img src="data:image/png;base64,xx"></p>')
    expect(markdown).toBe("（图片无法导入：data: 地址不导入）")
    // 渲染成正文后必须仍有可见文字，而不是空白段落。
    expect(renderMarkdown(markdown!).textContent).toContain("图片无法导入")
  })

  it("剪贴板同时给了图片文件时，本地图片留下待写入占位交由附件队列原地替换", () => {
    const html = '<p>前<img src="file:///tmp/a.png" alt="示意">后</p>'
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" })
    const placeholders: HtmlImagePlaceholder[] = []
    const markdown = htmlToMarkdown(html, {
      imageCoveredByFile: createClipboardImageCoverage(html, [file]),
      onImagePlaceholder: (placeholder) => placeholders.push(placeholder),
    })
    expect(markdown).toBe("前示意（图片写入中…）后")
    // 偏移必须精确指向占位文字，调用方据此把引用填回原处，而不是追加到末尾。
    expect(markdown!.slice(placeholders[0].offset, placeholders[0].offset + placeholders[0].text.length))
      .toBe("示意（图片写入中…）")
    expect(placeholders[0].text).toBe("示意（图片写入中…）")
    expect(placeholders[0].fileIndex).toBe(0)
    // 选项只作用于本次调用，不能泄漏给下一次转换。
    expect(htmlToMarkdown(html)).toBe("前示意（图片无法导入：本地文件地址不导入）后")
  })

  it("有文件补上引用时，没有 alt 的图片不能留下「导入失败」的假消息", () => {
    const html = '<p>看图：<img src="data:image/png;base64,xx"></p>'
    const file = new File([new Uint8Array([1])], "截图.png", { type: "image/png" })
    // 图片马上由剪贴板文件写入正文并附上引用，这里再说一句「图片无法导入」就是假消息，
    // 用户会以为粘贴失败，紧接着却看到图片出现。
    expect(htmlToMarkdown(html, { imageCoveredByFile: createClipboardImageCoverage(html, [file]) }))
      .toBe("看图：（图片写入中…）")
    // 没有文件兜底时仍然必须给出可见占位，两条路径不能互相污染。
    expect(htmlToMarkdown(html)).toBe("看图：（图片无法导入：data: 地址不导入）")
  })

  it("剪贴板只给一个文件却有两张导入不了的图片时，只有那张有文件补上的才留待写入占位", () => {
    // 回归点：覆盖判定如果退化成一个全局布尔值，两张图的占位会一起被删掉，
    // 可只有一张真会被补上引用，另一张从此在正文里没有任何痕迹。
    const html = '<p><img src="file:///tmp/a.png"><img src="file:///tmp/b.png" alt="乙图"></p>'
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" })
    const coverage = createClipboardImageCoverage(html, [file])
    expect(coverage({ alt: "", src: "file:///tmp/a.png" })).toBe(0)
    expect(coverage({ alt: "乙图", src: "file:///tmp/b.png" })).toBeNull()
    // 甲图有文件补引用 → 待写入占位；乙图没有文件补，必须留住「无法导入」的真实原因。
    expect(htmlToMarkdown(html, { imageCoveredByFile: coverage }))
      .toBe("（图片写入中…）乙图（图片无法导入：本地文件地址不导入）")
    // 全局布尔值的写法会把乙图的占位一起删掉，整段只剩一个空段落——这正是回归点。
    expect(htmlToMarkdown(html)).toBe("（图片无法导入：本地文件地址不导入）乙图（图片无法导入：本地文件地址不导入）")
  })

  it("多张图各自留下占位，偏移按文档顺序精确递增", () => {
    // 保序的核心：每张图的位置必须与它在原文里的位置一致，而不是全部堆到末尾。
    const html = '<p>文字 A</p><p><img src="file:///tmp/1.png" alt="甲"></p><p>文字 B</p><p><img src="file:///tmp/2.png" alt="乙"></p>'
    const files = [
      new File([new Uint8Array([1])], "1.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "2.png", { type: "image/png" }),
    ]
    const placeholders: HtmlImagePlaceholder[] = []
    const markdown = htmlToMarkdown(html, {
      imageCoveredByFile: createClipboardImageCoverage(html, files),
      onImagePlaceholder: (placeholder) => placeholders.push(placeholder),
    })!
    expect(markdown).toBe("文字 A\n\n甲（图片写入中…）\n\n文字 B\n\n乙（图片写入中…）")
    // 下标与 files 对齐，偏移与文字一致，且两个占位是按顺序报出来的。
    expect(placeholders.map((placeholder) => placeholder.fileIndex)).toEqual([0, 1])
    expect(placeholders.map((placeholder) => markdown.slice(placeholder.offset, placeholder.offset + placeholder.text.length)))
      .toEqual(["甲（图片写入中…）", "乙（图片写入中…）"])
    expect(placeholders[0].offset).toBeLessThan(placeholders[1].offset)
  })

  it("占位文字按行首状态转义，文件名里的 Markdown 标记不会变成语法", () => {
    // 占位多半写在段首，文件名里的 * 与 [ 若不转义，整段会被解析成强调或链接。
    const html = '<p><img src="file:///tmp/a.png"></p>'
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" })
    const placeholders: HtmlImagePlaceholder[] = []
    const markdown = htmlToMarkdown(html, {
      imageCoveredByFile: createClipboardImageCoverage(html, [file]),
      imagePlaceholder: () => "*重点* [一]",
      onImagePlaceholder: (placeholder) => placeholders.push(placeholder),
    })!
    // 星号与方括号在段首转义后才是字面量；text 报的是**已转义**的文字，
    // 落笔前用它校验这一段没被改过。
    expect(markdown).toBe("\\*重点\\* \\[一\\]")
    expect(placeholders[0].text).toBe(markdown)
  })

  it("自定义占位文字回调收到的 fileIndex 与剪贴板文件下标一致", () => {
    const html = '<p><img src="file:///tmp/a.png"><img src="file:///tmp/b.png"></p>'
    const files = [
      new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "b.png", { type: "image/png" }),
    ]
    const seen: number[] = []
    htmlToMarkdown(html, {
      imageCoveredByFile: createClipboardImageCoverage(html, files),
      imagePlaceholder: (_image, fileIndex) => {
        seen.push(fileIndex)
        return `图 ${fileIndex}`
      },
    })
    expect(seen).toEqual([0, 1])
  })

  it("输出里不得残留占位哨兵", () => {
    // 哨兵只是内部机制；漏到正文里就是用户可见的乱码，且会随自动保存落盘。
    const html = '<p>前<img src="file:///tmp/a.png" alt="示意图">后<img src="file:///tmp/b.png"></p>'
    const files = [
      new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "b.png", { type: "image/png" }),
    ]
    const markdown = htmlToMarkdown(html, { imageCoveredByFile: createClipboardImageCoverage(html, files) })!
    expect([...markdown].some((character) => character >= "\uE001" && character <= "\uE002")).toBe(false)
  })

  it("没有文件补的图片与有文件补的图片混排时，只有前者留下「无法导入」说明", () => {
    const html = '<p>甲<img src="file:///tmp/a.png" alt="有文件">乙<img src="file:///tmp/b.png" alt="没文件">丙</p>'
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" })
    expect(htmlToMarkdown(html, { imageCoveredByFile: createClipboardImageCoverage(html, [file]) }))
      .toBe("甲有文件（图片写入中…）乙没文件（图片无法导入：本地文件地址不导入）丙")
  })

  it("不同路径的同名图片不能由一个文件同时覆盖，重复检查不改变判定", () => {
    const html = '<p><img src="file:///a/image.png" alt="甲"><img src="file:///b/image.png" alt="乙"></p>'
    const coverage = createClipboardImageCoverage(html, [new File(["image"], "image.png", { type: "image/png" })])
    const expected = "甲（图片无法导入：本地文件地址不导入）乙（图片无法导入：本地文件地址不导入）"
    expect(htmlToMarkdown(html, { imageCoveredByFile: coverage })).toBe(expected)
    expect(htmlToMarkdown(html, { imageCoveredByFile: coverage })).toBe(expected)
  })

  it("导入不了的图片数与图片文件数一一对应时，按顺序认作全覆盖（Word / 飞书的形态）", () => {
    // 这类来源的 src 常指向临时目录甚至 data:，只按文件名比对会把每一张都判成未覆盖，
    // 于是正文里每张图前面多出一句「导入失败」，而引用紧接着就插了进来。
    const html = '<p><img src="file:///tmp/1.png"><img src="data:image/png;base64,yy"></p>'
    const files = [
      new File([new Uint8Array([1])], "图片1.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "图片2.png", { type: "image/png" }),
    ]
    // 两张图都按顺序配上文件，各自留下待写入占位；正文不再是「空内容 → 返回 null」，
    // 而是有两个位置明确的占位，引用写完后原位替换（这是保序的前提）。
    const placeholders: HtmlImagePlaceholder[] = []
    const markdown = htmlToMarkdown(html, {
      imageCoveredByFile: createClipboardImageCoverage(html, files),
      onImagePlaceholder: (placeholder) => placeholders.push(placeholder),
    })
    expect(markdown).toBe("（图片写入中…）（图片写入中…）")
    expect(placeholders.map((placeholder) => placeholder.fileIndex)).toEqual([0, 1])
    // 顺序配对不能把同一个文件发给两张图：两张图的 fileIndex 必须不同。
    expect(new Set(placeholders.map((placeholder) => placeholder.fileIndex)).size).toBe(2)
  })

  it("按顺序配对时每个文件只被领走一次，反复求值不会把同一个下标发给两张图", () => {
    const html = '<p><img src="file:///tmp/1.png"><img src="file:///tmp/2.png"></p>'
    const files = [
      new File([new Uint8Array([1])], "甲.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "乙.png", { type: "image/png" }),
    ]
    const coverage = createClipboardImageCoverage(html, files)
    expect(coverage({ alt: "", src: "file:///tmp/1.png" })).toBe(0)
    expect(coverage({ alt: "", src: "file:///tmp/2.png" })).toBe(1)
    // 游标用尽后不再发号，避免第三张图复用第一张的引用。
    expect(coverage({ alt: "", src: "file:///tmp/3.png" })).toBeNull()
  })

  it("HTML 里是否存在导入不了的图片", () => {
    // 网页富文本：图片本身就是可用的外链，附带的资源文件不是用户要插入的附件。
    expect(htmlNeedsClipboardImageFiles('<p><img src="https://a.com/x.png" alt="示意"></p>')).toBe(false)
    expect(htmlNeedsClipboardImageFiles("<p>没有图片</p>")).toBe(false)
    // Word / 飞书：本地图片在正文里没有可用引用，必须靠剪贴板文件补齐。
    expect(htmlNeedsClipboardImageFiles('<p><img src="file:///tmp/a.png"></p>')).toBe(true)
    expect(htmlNeedsClipboardImageFiles('<p><img src="data:image/png;base64,xx"></p>')).toBe(true)
  })

  it("只有 HTML、剪贴板没给文件时，图片不能只留 alt 而把占位一起丢掉", () => {
    const html = '<p>看图：<img src="data:image/png;base64,xx" alt="红点图"></p>'
    // 回归点：`图片数 === 文件数` 在 0 === 0 时也成立，单凭它判断会让这次粘贴走进
    // 「文件会补上引用」的分支——但根本没有文件，结果图片既没有引用也没有占位，静默消失。
    expect(shouldInsertClipboardImageFiles(html, [])).toBe(false)
    expect(shouldInsertClipboardImageFiles(null, [])).toBe(false)
    // 因此这条路径必须保留可见占位。
    expect(htmlToMarkdown(html, { imageCoveredByFile: createClipboardImageCoverage(html, []) }))
      .toBe("看图：红点图（图片无法导入：data: 地址不导入）")
  })

  it("只有 HTML 里确实有导入不了的图片、且剪贴板给了图片文件时，才走附件队列", () => {
    const localHtml = '<p>看图：<img src="file:///tmp/a.png" alt="本地图"></p>'
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" })
    expect(shouldInsertClipboardImageFiles(localHtml, [file])).toBe(true)
    // 混进非图片文件时宁可不接管：文件与图片对不上就不能假定它们一一对应。
    expect(shouldInsertClipboardImageFiles(localHtml, [file, new File([new Uint8Array([2])], "a.txt", { type: "text/plain" })])).toBe(false)
    // 图片本来就是 http(s) 外链：附带的文件不是用户要插入的附件。
    expect(shouldInsertClipboardImageFiles('<p><img src="https://a.com/x.png"></p>', [file])).toBe(false)
    // 对不上时转换仍留在 HTML 自己渲染引用的老路上。
    expect(htmlToMarkdown(localHtml, { imageCoveredByFile: createClipboardImageCoverage(localHtml, []) }))
      .toBe("看图：本地图（图片无法导入：本地文件地址不导入）")
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
    expect(htmlToMarkdown("<pre>````js\n\n\nx</pre>")).toBe("`````\n````js\n\n\nx\n`````")
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

  it("按源文本节点转义字面 Markdown，预览不会把内容误识别成格式", () => {
    const markdown = htmlToMarkdown("<p>请原样输入 **关键词** 和 [说明](地址)，还有 # 标题与 a|b</p>")!
    const body = renderMarkdown(markdown)
    expect(body.textContent).toBe("请原样输入 **关键词** 和 [说明](地址)，还有 # 标题与 a|b")
    expect(body.querySelector("strong, a, h1")).toBeNull()
  })

  it("链接保留方括号标签并安全序列化含空格、括号的地址", () => {
    const markdown = htmlToMarkdown('<p><a href="https://example.com/a (b)?q=x y">数组[0]</a></p>')!
    const body = renderMarkdown(markdown)
    const link = body.querySelector("a")
    expect(link?.textContent).toBe("数组[0]")
    expect(link?.getAttribute("href")).toBe("https://example.com/a%20(b)?q=x%20y")
  })

  it("行内格式把两侧空格移到标记外，可见文字不粘连", () => {
    const body = renderMarkdown(htmlToMarkdown("<p>Hello<strong> world </strong>again</p>")!)
    expect(body.textContent).toBe("Hello world again")
    expect(body.querySelector("strong")?.textContent).toBe("world")
  })

  it("任意长度反引号在行内代码和代码块中均完整保留", () => {
    const inlineText = "a``b```c"
    const inline = renderMarkdown(htmlToMarkdown(`<p><code>${inlineText}</code></p>`)!)
    expect(inline.querySelector("code")?.textContent).toBe(inlineText)

    const blockText = "before\n````\nafter"
    const block = renderMarkdown(htmlToMarkdown(`<pre>${blockText}</pre>`)!)
    expect(block.querySelector("pre code")?.textContent).toBe(`${blockText}\n`)
  })

  it("BR 在预览中保持视觉换行，列表内多个段落仍属于同一列表项", () => {
    const breakBody = renderMarkdown(htmlToMarkdown("<p>第一行<br>第二行</p>")!)
    expect(breakBody.querySelector("br")).not.toBeNull()
    expect(breakBody.textContent).toBe("第一行\n第二行")

    const listBody = renderMarkdown(htmlToMarkdown("<ul><li><p>首段</p><p>续段</p><pre>code\nline</pre></li></ul>")!)
    const items = listBody.querySelectorAll("li")
    expect(items).toHaveLength(1)
    expect(items[0].querySelectorAll("p")).toHaveLength(2)
    expect(items[0].querySelector("pre code")?.textContent).toBe("code\nline\n")
  })

  it("格式标签内部的 BR 仍渲染成硬换行", () => {
    const markdown = htmlToMarkdown("<p><strong>甲<br>乙</strong></p>")!
    const body = renderMarkdown(markdown)
    expect(body.querySelector("strong br")).not.toBeNull()
    expect(body.textContent).toBe("甲\n乙")
  })

  it("HTML 解码后形似 Markdown 实体的文本不会被二次解码", () => {
    const markdown = htmlToMarkdown("<p>&amp;amp; &amp;copy;</p>")!
    const body = renderMarkdown(markdown)
    expect(body.textContent).toBe("&amp; &copy;")
  })

  it("列表首块为 PRE 时缩进全部围栏内容，真实渲染保持在列表项内", () => {
    const markdown = htmlToMarkdown("<ul><li><pre><code>a\nb</code></pre></li></ul>")!
    const body = renderMarkdown(markdown)
    expect(body.querySelectorAll("li")).toHaveLength(1)
    expect(body.querySelector("li pre code")?.textContent).toBe("a\nb\n")
    expect(body.querySelector("body > pre")).toBeNull()
  })

  it("列表中的行内与段落按 DOM 原顺序渲染", () => {
    const markdown = htmlToMarkdown("<ul><li><p>首</p>中间<p>尾</p></li></ul>")!
    const body = renderMarkdown(markdown)
    const item = body.querySelector("li")!
    expect(item.textContent?.trim()).toBe("首\n中间\n尾")
    expect(Array.from(item.querySelectorAll("p"), (node) => node.textContent)).toEqual(["首", "中间", "尾"])
  })

  it("行内的破折号、小数点与百分号不转义，粘贴后能按原文搜索", () => {
    const html = "<p>价格 100-200 元，版本 v1.2.3 于 2026.09.21 发布，完成 50% ，见 a_b_c 。</p>"
    expect(htmlToMarkdown(html)).toBe("价格 100-200 元，版本 v1.2.3 于 2026.09.21 发布，完成 50% ，见 a_b_c 。")
    // 预览仍须是同一段文字，不能因为少了反斜杠被拆成标题、列表或表格。
    const body = renderMarkdown(htmlToMarkdown(html)!)
    expect(body.querySelector("h1, ul, ol, table, hr")).toBeNull()
    expect(body.textContent).toBe("价格 100-200 元，版本 v1.2.3 于 2026.09.21 发布，完成 50% ，见 a_b_c 。")
  })

  it("行内的 ` * [ < ~ 仍然转义，不生成代码、强调、链接与删除线", () => {
    const html = "<p>a `b` c *d* e [f] g 1 < 2 与 i~j~k 还有 l~~m</p>"
    const body = renderMarkdown(htmlToMarkdown(html)!)
    expect(body.querySelector("code, strong, em, a, del")).toBeNull()
    expect(body.textContent).toBe("a `b` c *d* e [f] g 1 < 2 与 i~j~k 还有 l~~m")
  })

  it("文本节点以块级标记开头时仍按字面渲染", () => {
    const html = "<p># 井号开头</p><p>- 短横开头</p><p>1. 序号开头</p><p>&gt; 引用开头</p>"
    const body = renderMarkdown(htmlToMarkdown(html)!)
    expect(body.querySelector("h1, ul, ol, blockquote")).toBeNull()
    expect(Array.from(body.querySelectorAll("p"), (node) => node.textContent)).toEqual(["# 井号开头", "- 短横开头", "1. 序号开头", "> 引用开头"])
  })

  it("词中的下划线不转义，snake_case 保持可搜索", () => {
    expect(htmlToMarkdown("<p>字段 user_name 与 file_path_2 未变</p>")).toBe("字段 user_name 与 file_path_2 未变")
  })

  it("段落中间的块级标记不转义，富文本切分文本节点后仍能按原文搜索", () => {
    // 富文本常用 span/strong 把一句话切成多个文本节点。若按「文本节点开头」判断行首，
    // # 与 - 会被平白塞进反斜杠，粘贴后按原文搜索就搜不到了。
    expect(htmlToMarkdown("<p>前缀<strong>粗体</strong># 标签</p>")).toBe("前缀**粗体**# 标签")
    expect(htmlToMarkdown("<p>说明<span>-</span> 后缀</p>")).toBe("说明- 后缀")
    expect(htmlToMarkdown("<p>甲<span>1. </span>乙</p>")).toBe("甲1. 乙")
    expect(htmlToMarkdown("<p>见 <span>a|b</span> 与 <em>c</em> 号</p>")).toBe("见 a|b 与 *c* 号")
  })

  it("真正的行首仍转义块级标记，不生成标题与列表", () => {
    // 反例的另一面：标记确实落在行首时必须照旧转义，否则内容会被解析成结构。
    const body = renderMarkdown(htmlToMarkdown("<p><span># 井号开头</span></p>")!)
    expect(body.querySelector("h1")).toBeNull()
    expect(body.textContent).toBe("# 井号开头")
    expect(htmlToMarkdown("<p><span>- 短横开头</span></p>")).toContain("\\-")
    // 前面已经带上 ** 前缀时 - 不在行首，不该多转义。
    expect(htmlToMarkdown("<p><strong>- 短横开头</strong></p>")).toBe("**- 短横开头**")
  })

  it("硬换行之后重新算行首，换行后的标记仍转义", () => {
    // <br> 之后的文字落在新的一行上，行首标记重新成为结构。
    const markdown = htmlToMarkdown("<p>首行<br># 次行</p>")!
    expect(markdown).toContain("\\# 次行")
    const body = renderMarkdown(markdown)
    expect(body.querySelector("h1")).toBeNull()
    expect(body.textContent?.replace(/\s+/g, " ").trim()).toBe("首行 # 次行")
  })

  it("嵌套行内节点的硬换行也会恢复行首状态", () => {
    // span 开始时位于段落中间，但它内部的 <br> 会开启新行；行首状态不能被父级的 false 锁死。
    const markdown = htmlToMarkdown("<p>首行<span><br> # 次行</span></p>")!
    expect(markdown).toContain("\\# 次行")
    const body = renderMarkdown(markdown)
    expect(body.querySelector("h1")).toBeNull()
    expect(body.textContent?.replace(/\s+/g, " ").trim()).toBe("首行 # 次行")
  })
})
