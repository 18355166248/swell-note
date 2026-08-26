import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import MarkdownPreview from "./markdown-preview"

const baseProps = {
  onLoadWikiNote: vi.fn(),
  onResolveAsset: vi.fn(),
  onWikiLink: vi.fn(),
}

describe("Markdown preview integration", () => {
  it("renders frontmatter as a properties panel instead of Markdown body", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"---\ntitle: 示例标题\ntags: [工作, 计划]\n---\n![[目标笔记]]"}
        onResolveWikiNote={() => ({ note: { content: "## 嵌入正文", title: "目标笔记" }, status: "ready" })}
      />,
    )

    expect(output).toContain("<section class=\"wiki-embed\">")
    expect(output).toContain("嵌入正文")
    expect(output).not.toContain("<p><section")
    expect(output).toContain("markdown-properties")
    expect(output).toContain("示例标题")
    expect(output).toContain("#工作")
    expect(output).not.toContain("<hr")
  })

  it("wraps wide tables and keeps internal anchors inside the note route", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"[跳到小节](#目标小节)\n\n## 目标小节\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    )

    expect(output).toContain('class="wiki-link markdown-anchor-link"')
    expect(output).toContain('id="目标小节"')
    expect(output).toContain('<div class="markdown-table-wrap"><table>')
    expect(output).not.toContain('href="#目标小节"')
  })

  it("routes standard Markdown note links through the workspace", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"[打开方案](../docs/方案%20A.md#目标)\n\n[官网](https://example.com)"}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    )

    expect(output).toContain('class="wiki-link markdown-note-link"')
    expect(output).toContain("打开方案")
    expect(output).not.toContain('href="../docs/方案%20A.md#目标"')
    expect(output).toContain('href="https://example.com"')
  })

  it("shows a useful empty-note state", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview {...baseProps} content="" editable onResolveWikiNote={() => ({ status: "missing" })} />,
    )

    expect(output).toContain("这篇笔记还没有正文")
    expect(output).toContain("切换到编辑模式开始记录")
  })

  it("renders remote images and legacy alt-based dimensions", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={'![架构图|320x180](https://example.com/diagram.png)'}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    )

    expect(output).toContain('alt="架构图"')
    expect(output).toContain('src="https://example.com/diagram.png"')
    expect(output).toContain('width:320px')
    expect(output).toContain('height:180px')
    expect(output).toContain('referrerPolicy="no-referrer"')
  })

  it("treats hybrid Obsidian image labels as images instead of links", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={'![[截图.png|300]](../attachments/IMG.png)'}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    )

    // 本地附件会在 effect 中异步读取，SSR 首帧应是图片加载态，而不是可点击的蓝色链接。
    expect(output).toContain("正在读取图片")
    expect(output).not.toContain("<a ")
    expect(output).not.toContain("截图.png|300]]")
  })

  it("renders only the referenced block for anchored embeds", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"![[目标笔记#^quote-01]]\n\n![[目标笔记#不存在的章节]]"}
        onResolveWikiNote={() => ({
          note: { content: "引用目标段落 ^quote-01\n\n其他段落", title: "目标笔记" },
          status: "ready",
        })}
      />,
    )

    expect(output).toContain("目标笔记 › quote-01")
    expect(output).toContain("引用目标段落")
    expect(output).not.toContain("其他段落")
    expect(output).toContain("找不到引用的块或标题：不存在的章节")
  })

  it("applies syntax highlighting to fenced code blocks", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"```ts\nconst value: number = 1\n```"}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    )

    expect(output).toContain("hljs language-ts")
    expect(output).toContain("hljs-keyword")
  })

  it("leaves unknown code languages as plain text without throwing", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"```mermaid\ngraph TD\nA-->B\n```"}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    )

    expect(output).toContain("graph TD")
  })

  it("renders ==highlights== as mark and hides %%comments%%", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"重点 ==是这里== %%内部注释%%\n\n%%整段注释%%"}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    )

    expect(output).toContain("<mark>是这里</mark>")
    expect(output).not.toContain("内部注释")
    expect(output).not.toContain("整段注释")
  })

  it("exposes source lines on preview task checkboxes", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"---\ntitle: 示例\n---\n- [ ] 未完成任务\n\n- [x] 已完成任务"}
        onResolveWikiNote={() => ({ status: "missing" })}
        onToggleTask={() => undefined}
      />,
    )

    expect(output).toContain('class="task-checkbox"')
    expect(output).toContain('data-source-line="4"')
    expect(output).toContain('data-source-line="6"')
    expect(output).not.toContain("disabled")
  })

  it("keeps task checkboxes disabled without a toggle handler", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"- [ ] 未完成任务"}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    )

    expect(output).toContain('type="checkbox"')
    expect(output).toContain("disabled")
    expect(output).not.toContain("task-checkbox")
  })

  it("renders collapsed and expanded callouts with native details", () => {
    const collapsed = renderToStaticMarkup(
      <MarkdownPreview {...baseProps} content={"> [!warning]- 注意\n> 正文"} onResolveWikiNote={() => ({ status: "missing" })} />,
    )
    const expanded = renderToStaticMarkup(
      <MarkdownPreview {...baseProps} content={"> [!tip]+ 提示\n> 正文"} onResolveWikiNote={() => ({ status: "missing" })} />,
    )

    expect(collapsed).toContain("<details")
    expect(collapsed).not.toContain("open=\"\"")
    expect(expanded).toContain("open=\"\"")
    expect(expanded).toContain("<summary class=\"obsidian-callout-title\">")
  })
})
