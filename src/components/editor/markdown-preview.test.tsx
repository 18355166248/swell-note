import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import MarkdownPreview from "./markdown-preview"

const baseProps = {
  onLoadWikiNote: vi.fn(),
  onResolveAsset: vi.fn(),
  onWikiLink: vi.fn(),
}

describe("Markdown preview integration", () => {
  it("renders note embeds as standalone blocks and hides frontmatter", () => {
    const output = renderToStaticMarkup(
      <MarkdownPreview
        {...baseProps}
        content={"---\ntitle: 不应显示\n---\n![[目标笔记]]"}
        onResolveWikiNote={() => ({ note: { content: "## 嵌入正文", title: "目标笔记" }, status: "ready" })}
      />,
    )

    expect(output).toContain("<section class=\"wiki-embed\">")
    expect(output).toContain("嵌入正文")
    expect(output).not.toContain("<p><section")
    expect(output).not.toContain("不应显示")
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
