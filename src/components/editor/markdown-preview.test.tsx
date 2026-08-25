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
