// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { history, undo } from "@codemirror/commands"
import { EditorState, StateEffect } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { collectCompatibilityBlocks, CompatibilityBlockWidget, type CompatibilityBlockOptions } from "./compatibility-blocks"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function editorExtensions(readOnly = false) {
  return [
    markdown({ base: markdownLanguage }),
    history(),
    ...(readOnly ? [EditorState.readOnly.of(true)] : []),
  ]
}

function createView(source: string, readOnly = false) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: source,
      extensions: editorExtensions(readOnly),
    }),
  })
}

async function renderWidget(view: EditorView, index = 0, options: CompatibilityBlockOptions = {}) {
  const block = collectCompatibilityBlocks(view.state)[index]
  if (!block) throw new Error("没有找到兼容块")
  const widget = new CompatibilityBlockWidget(block, options, view)
  let host!: HTMLElement
  await act(async () => {
    host = widget.toDOM()
    document.body.append(host)
    await Promise.resolve()
  })
  // CompatibilityPreview 使用 React.lazy；等待按需模块完成后再断言实际预览语义。
  await act(async () => { await vi.dynamicImportSettled() })
  return { block, host, widget }
}

function setTextareaValue(input: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe("compatibility block collection", () => {
  it("collects closed frontmatter, foldable callouts, and standalone note embeds", () => {
    const source = [
      "---",
      "title: 示例",
      "tags: [工作, 周报]",
      "---",
      "",
      "> [!warning]- 注意",
      "> 正文",
      "",
      "![[目标笔记#章节|显示名]]",
    ].join("\n")
    const view = createView(source)

    expect(collectCompatibilityBlocks(view.state)).toEqual([
      expect.objectContaining({ kind: "frontmatter", source: "---\ntitle: 示例\ntags: [工作, 周报]\n---" }),
      expect.objectContaining({ calloutType: "warning", fold: "-", kind: "callout", source: "> [!warning]- 注意\n> 正文", title: "注意" }),
      expect.objectContaining({ kind: "wiki-embed", source: "![[目标笔记#章节|显示名]]", target: "目标笔记#章节" }),
    ])
    view.destroy()
  })

  it("keeps unfinished YAML, code examples, and attachment embeds as source", () => {
    const source = [
      "---",
      "formula: $$x$$",
      "title: 尚未闭合",
      "",
      "```md",
      "> [!note] 代码示例",
      "![[代码笔记]]",
      "```",
      "",
      "![[附件.pdf]]",
    ].join("\n")
    const view = createView(source)

    expect(collectCompatibilityBlocks(view.state)).toEqual([])
    view.destroy()
  })
})

describe("compatibility block widget", () => {
  it("reuses the safe preview renderer for folded callouts", async () => {
    const view = createView("> [!tip]- 默认收起\n> **提示正文**")
    const { host, widget } = await renderWidget(view)

    const details = host.querySelector("details.obsidian-callout")
    expect(details).not.toBeNull()
    expect(details?.hasAttribute("open")).toBe(false)
    expect(host.querySelector("summary")?.textContent).toContain("默认收起")
    expect(host.querySelector("strong")?.textContent).toBe("提示正文")

    widget.destroy(host)
    view.destroy()
  })

  it("renders only the requested wiki fragment and keeps embedded tasks read-only", async () => {
    const openWiki = vi.fn()
    const embedded = [
      "# 之前",
      "不应展示",
      "## 目标章节",
      "- [ ] 子笔记任务",
      "## 后续",
      "也不应展示",
    ].join("\n")
    const view = createView("![[子笔记#目标章节]]")
    const { host, widget } = await renderWidget(view, 0, {
      onOpenWikiLink: openWiki,
      onResolveWikiNote: () => ({ note: { content: embedded, title: "子笔记" }, status: "ready" }),
    })

    expect(host.textContent).toContain("目标章节")
    expect(host.textContent).toContain("子笔记任务")
    expect(host.textContent).not.toContain("不应展示")
    expect(host.textContent).not.toContain("也不应展示")
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true)
    await act(async () => { host.querySelector<HTMLButtonElement>(".wiki-embed-title")?.click() })
    expect(openWiki).toHaveBeenCalledWith("子笔记#目标章节")

    widget.destroy(host)
    view.destroy()
  })

  it("refreshes a loading wiki embed when the existing resolver cache becomes ready", async () => {
    vi.useFakeTimers()
    let loaded = false
    const view = createView("![[稍后加载]]")
    const { host, widget } = await renderWidget(view, 0, {
      onLoadWikiNote: () => { loaded = true },
      onResolveWikiNote: () => loaded
        ? { note: { content: "加载完成正文", title: "稍后加载" }, status: "ready" }
        : { status: "loading" },
    })

    expect(host.textContent).toContain("正在读取嵌入笔记")
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(host.textContent).toContain("加载完成正文")

    widget.destroy(host)
    view.destroy()
  })

  it("edits exactly one source range and groups the save into one undo step", async () => {
    const original = "> [!note] 原标题\n> 原正文"
    const changed = "> [!success]+ 新标题\n> 新正文"
    const view = createView(`${original}\n\n尾部不变`)
    const { host, widget } = await renderWidget(view)

    await act(async () => { host.querySelector<HTMLButtonElement>(".cm-md-compat-edit")?.click() })
    const input = host.querySelector<HTMLTextAreaElement>("textarea")!
    await act(async () => { setTextareaValue(input, changed) })
    await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "保存")?.click() })

    expect(view.state.doc.toString()).toBe(`${changed}\n\n尾部不变`)
    undo(view)
    expect(view.state.doc.toString()).toBe(`${original}\n\n尾部不变`)

    widget.destroy(host)
    view.destroy()
  })

  it("cancels drafts and refuses stale source snapshots", async () => {
    const original = "![[原笔记]]"
    const view = createView(original)
    const { host, widget } = await renderWidget(view)

    await act(async () => { host.querySelector<HTMLButtonElement>(".cm-md-compat-edit")?.click() })
    await act(async () => { setTextareaValue(host.querySelector("textarea")!, "![[草稿]]") })
    await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "取消")?.click() })
    expect(view.state.doc.toString()).toBe(original)

    await act(async () => { host.querySelector<HTMLButtonElement>(".cm-md-compat-edit")?.click() })
    await act(async () => { setTextareaValue(host.querySelector("textarea")!, "![[过期草稿]]") })
    view.dispatch({ changes: { from: 3, to: 4, insert: "新" } })
    await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "保存")?.click() })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("源码已发生变化")
    expect(view.state.doc.toString()).toBe("![[新笔记]]")

    widget.destroy(host)
    view.destroy()
  })

  it("keeps a draft across range mapping and a temporary read-only lock", async () => {
    const source = "> [!note] 标题\n> 正文"
    const view = createView(`${source}\n\n尾部`)
    const { host } = await renderWidget(view)
    await act(async () => { host.querySelector<HTMLButtonElement>(".cm-md-compat-edit")?.click() })
    await act(async () => { setTextareaValue(host.querySelector("textarea")!, "> [!note] 草稿标题\n> 草稿正文") })

    view.dispatch({ changes: { from: 0, insert: "前言\n\n" } })
    let current = new CompatibilityBlockWidget(collectCompatibilityBlocks(view.state)[0], {}, view)
    await act(async () => { expect(current.updateDOM(host)).toBe(true); await Promise.resolve() })
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain("草稿正文")

    view.dispatch({ effects: StateEffect.reconfigure.of(editorExtensions(true)) })
    current = new CompatibilityBlockWidget(collectCompatibilityBlocks(view.state)[0], {}, view)
    await act(async () => { expect(current.updateDOM(host)).toBe(true); await Promise.resolve() })
    expect(host.querySelector(".cm-md-compat-edit")).toBeNull()
    expect(host.querySelector("textarea")).toBeNull()

    view.dispatch({ effects: StateEffect.reconfigure.of(editorExtensions(false)) })
    current = new CompatibilityBlockWidget(collectCompatibilityBlocks(view.state)[0], {}, view)
    await act(async () => { expect(current.updateDOM(host)).toBe(true); await Promise.resolve() })
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain("草稿正文")

    current.destroy(host)
    view.destroy()
  })

  it("shows a conflict after the rendered source changes and never overwrites it", async () => {
    const view = createView("> [!note] 标题\n> 正文")
    const { host } = await renderWidget(view)
    await act(async () => { host.querySelector<HTMLButtonElement>(".cm-md-compat-edit")?.click() })
    await act(async () => { setTextareaValue(host.querySelector("textarea")!, "> [!note] 草稿\n> 草稿正文") })

    const body = view.state.doc.toString().indexOf("正文")
    view.dispatch({ changes: { from: body, to: body + 2, insert: "外部正文" } })
    const current = new CompatibilityBlockWidget(collectCompatibilityBlocks(view.state)[0], {}, view)
    await act(async () => { expect(current.updateDOM(host)).toBe(true); await Promise.resolve() })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("源码已发生变化")
    await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "保存")?.click() })
    expect(view.state.doc.toString()).toContain("外部正文")
    expect(view.state.doc.toString()).not.toContain("草稿正文")

    current.destroy(host)
    view.destroy()
  })

  it("never exposes an edit entry for read-only notes", async () => {
    const view = createView("---\ntitle: 只读\n---", true)
    const { host, widget } = await renderWidget(view)

    expect(host.textContent).toContain("只读")
    expect(host.querySelector(".cm-md-compat-edit")).toBeNull()

    widget.destroy(host)
    view.destroy()
  })
})
