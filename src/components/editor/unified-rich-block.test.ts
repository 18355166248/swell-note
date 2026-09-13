// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { history, undo } from "@codemirror/commands"
import { Compartment, EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { markdownLivePreview } from "./live-preview"
import { collectInlineMath, collectUnifiedRichBlocks } from "./unified-rich-block"

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => {
    if (source.includes("INVALID")) throw new Error("invalid mermaid")
    return { svg: "<svg></svg>" }
  }),
}))

vi.mock("mermaid", () => ({ default: mermaidMocks }))

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
}

function state(doc: string) {
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
}

function createView(doc: string, readOnly = false) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [history(), markdown({ base: markdownLanguage }), markdownLivePreview({}), EditorState.readOnly.of(readOnly)],
      selection: { anchor: 0 },
    }),
  })
}

async function settle() {
  for (let attempt = 0; attempt < 12; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
}

function button(root: ParentNode, label: string) {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === label)
  if (!found) throw new Error(`未找到按钮：${label}`)
  return found
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

beforeEach(() => {
  mermaidMocks.initialize.mockClear()
  mermaidMocks.render.mockClear()
  mermaidMocks.render.mockImplementation(async (_id: string, source: string) => {
    if (source.includes("INVALID")) throw new Error("invalid mermaid")
    return { svg: "<svg></svg>" }
  })
})

describe("统一富块识别", () => {
  it("只识别公式和 mermaid，不误判普通代码围栏与代码中的美元符号", () => {
    const doc = [
      "正文 $a+b$ 与 \\$保留$",
      "",
      "$$",
      "x^2 + y^2",
      "$$",
      "",
      "```mermaid",
      "graph TD",
      "A-->B",
      "```",
      "",
      "```js",
      "const price = '$12$'",
      "```",
    ].join("\n")
    const editorState = state(doc)

    expect(collectUnifiedRichBlocks(editorState).map((block) => [block.kind, block.expression])).toEqual([
      ["math", "x^2 + y^2"],
      ["mermaid", "graph TD\nA-->B"],
    ])
    expect(collectInlineMath(editorState).map((formula) => formula.expression)).toEqual(["a+b"])
  })

  it("未闭合的公式与 Mermaid 围栏保持源码", () => {
    const doc = "$$\nx + y\n\n```mermaid\ngraph TD\nA-->B"
    expect(collectUnifiedRichBlocks(state(doc))).toEqual([])
  })
})

describe("统一富块交互", () => {
  it("公式默认显示结果，光标经过时仍由明确入口局部编辑", async () => {
    const doc = "开头\n\n行内 $a+b$ 结尾\n\n$$\nx^2\n$$"
    const view = createView(doc)
    await settle()

    expect(view.dom.querySelectorAll(".cm-md-rich-math")).toHaveLength(2)
    expect(view.dom.querySelector(".cm-md-rich-block .katex-display")).not.toBeNull()

    const inlineFrom = doc.indexOf("$a+b$")
    view.dispatch({ selection: { anchor: inlineFrom + 2 } })
    await settle()
    expect(view.dom.querySelector(".cm-md-rich-inline")).not.toBeNull()
    expect(view.dom.querySelector('[aria-label="编辑公式源码"]')).not.toBeNull()
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

  it("局部编辑保存为单次可撤销事务，取消不改 Markdown", async () => {
    const original = "前文\n\n$$\nx^2\n$$\n\n后文"
    const view = createView(original)
    await settle()
    const block = view.dom.querySelector<HTMLElement>(".cm-md-rich-block")!

    button(block, "编辑").click()
    expect(block.classList.contains("cm-md-rich-editing")).toBe(true)
    expect(Array.from(block.querySelectorAll(".cm-md-rich-editor-actions button"), (candidate) => candidate.textContent)).toEqual(["保存", "取消"])
    const input = block.querySelector<HTMLTextAreaElement>("textarea")!
    input.value = "$$\ny^2\n$$"
    button(block, "保存").click()
    expect(view.state.doc.toString()).toBe("前文\n\n$$\ny^2\n$$\n\n后文")
    undo(view)
    expect(view.state.doc.toString()).toBe(original)

    await settle()
    const restored = view.dom.querySelector<HTMLElement>(".cm-md-rich-block")!
    button(restored, "编辑").click()
    restored.querySelector<HTMLTextAreaElement>("textarea")!.value = "$$\nz^2\n$$"
    button(restored, "取消").click()
    expect(restored.classList.contains("cm-md-rich-editing")).toBe(false)
    expect(view.state.doc.toString()).toBe(original)
    view.destroy()
  })

  it("中文 composition 确认不会触发快捷保存", async () => {
    const original = "正文\n\n$$\nx\n$$"
    const view = createView(original)
    await settle()
    const block = view.dom.querySelector<HTMLElement>(".cm-md-rich-block")!
    button(block, "编辑").click()
    const input = block.querySelector<HTMLTextAreaElement>("textarea")!
    input.value = "$$\n中文变量\n$$"
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, isComposing: true, key: "Enter" }))

    expect(view.state.doc.toString()).toBe(original)
    expect(block.querySelector("textarea")).toBe(input)
    view.destroy()
  })

  it("只读状态保留结果并移除编辑入口", async () => {
    const view = createView("正文\n\n$$\nx\n$$\n\n```mermaid\ngraph TD\nA-->B\n```", true)
    await settle()

    expect(view.dom.querySelectorAll(".cm-md-rich-block")).toHaveLength(2)
    expect(view.dom.querySelector(".cm-md-rich-edit")).toBeNull()
    view.destroy()
  })

  it("同一编辑器动态切只读会锁住草稿，解除后继续编辑", async () => {
    const lock = new Compartment()
    const doc = "行内 $a+b$\n\n$$\nx\n$$"
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [history(), markdown({ base: markdownLanguage }), markdownLivePreview({}), lock.of(EditorState.readOnly.of(false))],
      }),
    })
    await settle()
    const block = view.dom.querySelector<HTMLElement>(".cm-md-rich-block")!
    button(block, "编辑").click()
    const draft = block.querySelector<HTMLTextAreaElement>("textarea")!
    draft.value = "尚未保存的草稿"
    draft.dispatchEvent(new Event("input"))

    view.dispatch({ effects: lock.reconfigure(EditorState.readOnly.of(true)) })
    await settle()
    expect(view.dom.querySelectorAll(".cm-md-rich")).toHaveLength(2)
    expect(view.dom.querySelector(".cm-md-rich-edit")).toBeNull()
    expect(view.dom.querySelector(".cm-md-rich-editor")).toBeNull()
    expect(view.dom.textContent).toContain("局部草稿已保留")
    expect(view.state.doc.toString()).toBe(doc)

    view.dispatch({ effects: lock.reconfigure(EditorState.readOnly.of(false)) })
    await settle()
    expect(view.dom.querySelector<HTMLTextAreaElement>(".cm-md-rich-editor textarea")?.value).toBe("尚未保存的草稿")
    view.destroy()
  })

  it("外部源码变化后保留局部草稿并拒绝覆盖新正文", async () => {
    const original = "前文\n\n$$\nx\n$$"
    const view = createView(original)
    await settle()
    const oldBlock = view.dom.querySelector<HTMLElement>(".cm-md-rich-block")!
    button(oldBlock, "编辑").click()
    const input = oldBlock.querySelector<HTMLTextAreaElement>("textarea")!
    input.value = "$$\n草稿\n$$"
    input.dispatchEvent(new Event("input"))

    const sourceFrom = original.indexOf("x")
    view.dispatch({ changes: { from: sourceFrom, to: sourceFrom + 1, insert: "外部新值" } })
    await settle()
    const currentBlock = view.dom.querySelector<HTMLElement>(".cm-md-rich-block")!
    expect(currentBlock.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("$$\n草稿\n$$")
    expect(currentBlock.querySelector('[role="alert"]')?.textContent).toContain("源码已发生变化")
    button(currentBlock, "保存").click()
    expect(view.state.doc.toString()).toContain("外部新值")
    expect(view.state.doc.toString()).not.toContain("草稿")
    view.destroy()
  })

  it("不合法公式或图表只降级当前块并保留编辑入口", async () => {
    const view = createView([
      "正文",
      "",
      "$$",
      "\\notARealKatexCommand{x}",
      "$$",
      "",
      "$$",
      "x+y",
      "$$",
      "",
      "```mermaid",
      "INVALID",
      "```",
    ].join("\n"))
    let blocks: HTMLElement[] = []
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      blocks = Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-md-rich-block"))
      if (blocks.length === 3 && blocks.every((block) => block.dataset.renderState !== "loading")) break
    }

    expect(blocks.map((block) => block.dataset.renderState)).toEqual(["error", "ready", "error"])
    expect(blocks[0].textContent).toContain("公式语法有误")
    expect(blocks[2].textContent).toContain("图表语法有误")
    expect(blocks[1].querySelector(".katex")).not.toBeNull()
    expect(blocks[0].querySelector('[aria-label="编辑公式源码"]')).not.toBeNull()
    expect(blocks[2].querySelector('[aria-label="编辑图表源码"]')).not.toBeNull()
    view.destroy()
  })

  it("合法 Mermaid 围栏显示安全渲染结果", async () => {
    const view = createView("正文\n\n```mermaid\ngraph TD\nA-->B\n```")
    let block: HTMLElement | null = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      block = view.dom.querySelector<HTMLElement>(".cm-md-rich-mermaid")
      if (block?.dataset.renderState === "ready") break
    }
    expect(block?.dataset.renderState).toBe("ready")
    expect(block?.querySelector("svg")).not.toBeNull()
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", suppressErrorRendering: true }))
    view.destroy()
  })

  it("迟到的异步图表结果不会写入已修改源码或已销毁编辑器", async () => {
    let resolveFirst: ((value: { svg: string }) => void) | undefined
    mermaidMocks.render.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    const view = createView("前文\n\n```mermaid\ngraph TD\nA-->B\n```")
    await settle()
    expect(resolveFirst).toBeTypeOf("function")

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "已经切换到新笔记" } })
    resolveFirst?.({ svg: '<svg data-stale="true"></svg>' })
    await settle()
    expect(view.dom.querySelector('[data-stale="true"]')).toBeNull()
    expect(view.state.doc.toString()).toBe("已经切换到新笔记")

    let resolveDestroyed: ((value: { svg: string }) => void) | undefined
    mermaidMocks.render.mockImplementationOnce(() => new Promise((resolve) => { resolveDestroyed = resolve }))
    const destroyed = createView("```mermaid\ngraph TD\nB-->C\n```")
    await settle()
    destroyed.destroy()
    resolveDestroyed?.({ svg: '<svg data-destroyed="true"></svg>' })
    await settle()
    expect(document.querySelector('[data-destroyed="true"]')).toBeNull()
    view.destroy()
  })

  it("普通代码围栏仍走原有源码展示，不创建富块", async () => {
    const view = createView("正文\n\n```ts\nconst a = 1\n```")
    await settle()

    expect(view.dom.querySelector(".cm-md-rich")).toBeNull()
    expect(view.dom.querySelector(".cm-md-codeblock")).not.toBeNull()
    view.destroy()
  })
})
