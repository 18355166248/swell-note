// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import MarkdownPreview from "./markdown-preview"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const baseProps = {
  onLoadWikiNote: vi.fn(),
  onResolveAsset: vi.fn(),
  onWikiLink: vi.fn(),
}

describe("Markdown preview integration", () => {
  it("does not remount vault images when parent callbacks change", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    const pendingAsset = new Promise<null>(() => undefined)
    const firstResolver = vi.fn(() => pendingAsset)
    const secondResolver = vi.fn(() => pendingAsset)
    const renderPreview = (onResolveAsset: typeof firstResolver) => (
      <MarkdownPreview
        {...baseProps}
        content="![截图](./attachments/image.png)"
        onResolveAsset={onResolveAsset}
        onResolveWikiNote={() => ({ status: "missing" })}
      />
    )

    await act(async () => root.render(renderPreview(firstResolver)))
    const initialLoadingNode = container.querySelector(".markdown-image-state")
    await act(async () => root.render(renderPreview(secondResolver)))

    expect(container.querySelector(".markdown-image-state")).toBe(initialLoadingNode)
    expect(firstResolver).toHaveBeenCalledTimes(1)
    expect(secondResolver).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it("lets a mobile reader tap normal text to edit at the matching source line", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    const onRequestEditAtLine = vi.fn()
    await act(async () => root.render(
      <MarkdownPreview
        {...baseProps}
        content={"---\ntitle: 示例\n---\n\n## 小节\n\n点击正文\n\n[保留链接](https://example.com)"}
        onRequestEditAtLine={onRequestEditAtLine}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    ))

    await act(async () => container.querySelector("p")?.click())
    expect(onRequestEditAtLine).toHaveBeenCalledWith(7)

    onRequestEditAtLine.mockClear()
    await act(async () => (container.querySelector("a") as HTMLAnchorElement | null)?.click())
    expect(onRequestEditAtLine).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it("reuses a loaded vault image when sync remounts the preview", async () => {
    vi.useFakeTimers()
    const originalCreateObjectUrl = URL.createObjectURL
    const originalRevokeObjectUrl = URL.revokeObjectURL
    const createObjectUrl = vi.fn(() => "blob:stable-preview-image")
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl })
    const resolver = vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }))
    const renderPreview = () => (
      <MarkdownPreview
        {...baseProps}
        assetScope="cache-a:note-a"
        content="![截图](./attachments/stable.png)"
        onResolveAsset={resolver}
        onResolveWikiNote={() => ({ status: "missing" })}
      />
    )
    const firstContainer = document.createElement("div")
    const firstRoot = createRoot(firstContainer)

    await act(async () => firstRoot.render(renderPreview()))
    await act(async () => Promise.resolve())
    expect(firstContainer.querySelector("img")?.getAttribute("src")).toBe("blob:stable-preview-image")
    await act(async () => firstRoot.unmount())

    const secondContainer = document.createElement("div")
    const secondRoot = createRoot(secondContainer)
    await act(async () => secondRoot.render(renderPreview()))
    expect(secondContainer.querySelector(".markdown-image-state")).toBeNull()
    expect(secondContainer.querySelector("img")?.getAttribute("src")).toBe("blob:stable-preview-image")
    expect(resolver).toHaveBeenCalledTimes(1)

    await act(async () => secondRoot.unmount())
    await act(async () => vi.advanceTimersByTime(30_000))
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:stable-preview-image")
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectUrl })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectUrl })
    vi.useRealTimers()
  })

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
    expect(output).toContain('class="markdown-table-shell"')
    expect(output).toContain('class="markdown-table-wrap"')
    expect(output).toContain('class="markdown-table-scroll-hint">左右滑动')
    expect(output).not.toContain('href="#目标小节"')
  })

  it("exposes overflowing tables as keyboard-scrollable regions", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    await act(async () => root.render(
      <MarkdownPreview
        {...baseProps}
        content={"| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |"}
        onResolveWikiNote={() => ({ status: "missing" })}
      />,
    ))
    const viewport = container.querySelector(".markdown-table-wrap") as HTMLDivElement
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 300 })
    Object.defineProperty(viewport, "scrollWidth", { configurable: true, value: 600 })
    await act(async () => window.dispatchEvent(new Event("resize")))

    expect(viewport.getAttribute("role")).toBe("region")
    expect(viewport.getAttribute("aria-label")).toBe("可横向滚动的表格")
    expect(viewport.tabIndex).toBe(0)
    expect(viewport.parentElement?.dataset.atStart).toBe("true")

    await act(async () => viewport.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" })))
    expect(viewport.scrollLeft).toBeGreaterThan(0)
    expect(viewport.parentElement?.dataset.atStart).toBe("false")

    await act(async () => viewport.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" })))
    expect(viewport.scrollLeft).toBe(300)
    expect(viewport.parentElement?.dataset.atStart).toBe("false")
    expect(viewport.parentElement?.dataset.atEnd).toBe("true")
    await act(async () => root.unmount())
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
