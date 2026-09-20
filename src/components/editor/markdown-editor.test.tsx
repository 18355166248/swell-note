// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { undoDepth } from "@codemirror/commands"
import { ensureSyntaxTree } from "@codemirror/language"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, getDrawSelectionConfig } from "@codemirror/view"

import type { MarkdownEditorHandle } from "./markdown-editor"
import MarkdownEditor, { findPlainTextMatches, findTableWrapperAtLine, formatToolbarText, paragraphSeparatorAtEnd, selectedMarkdownRange, shouldPasteAsPlainText } from "./markdown-editor"
import { markdownLivePreview } from "./live-preview"

// React 19 在测试里要求显式打开 act 环境标记。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom 的 Range 缺少布局 API；焦点回到 CodeMirror 时会读取它来刷新选区层。
if (!Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] })
}

let container: HTMLElement | null = null
let root: Root | null = null
const originalNavigator = {
  maxTouchPoints: Object.getOwnPropertyDescriptor(Navigator.prototype, "maxTouchPoints"),
  platform: Object.getOwnPropertyDescriptor(Navigator.prototype, "platform"),
  userAgent: Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent"),
}

function mount(element: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(element) })
}

/**
 * 需要「同一棵树里换 props」的用例（切换笔记、只读开关）。
 * mount 每次都会新建根节点，看不出视图是否被复用，因此单列一个返回 rerender 的版本。
 */
function mountWithRerender(element: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(element) })
  return {
    rerender(next: React.ReactElement) {
      act(() => { root!.render(next) })
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  const selection = document.getSelection()
  if (selection && "removeAllRanges" in selection) selection.removeAllRanges()
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
  restoreNavigatorPlatform()
})

function setNavigatorPlatform(platform: { maxTouchPoints: number; platform: string; userAgent: string }) {
  Object.defineProperty(Navigator.prototype, "maxTouchPoints", { configurable: true, get: () => platform.maxTouchPoints })
  Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => platform.platform })
  Object.defineProperty(Navigator.prototype, "userAgent", { configurable: true, get: () => platform.userAgent })
}

function restoreNavigatorPlatform() {
  for (const [key, descriptor] of Object.entries(originalNavigator)) {
    if (descriptor) Object.defineProperty(Navigator.prototype, key, descriptor)
    else Reflect.deleteProperty(Navigator.prototype, key)
  }
}

describe("MarkdownEditor", () => {
  function editorView() {
    const view = EditorView.findFromDOM(container!.querySelector<HTMLElement>(".cm-editor")!)
    if (!view) throw new Error("编辑器未挂载")
    return view
  }

  it("桌面端实际组件使用自绘选区，并保持范围尾部额外光标关闭", () => {
    setNavigatorPlatform({
      maxTouchPoints: 0,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    })
    mount(<MarkdownEditor onChange={() => {}} value={"第一行\n第二行"} />)
    const view = editorView()

    expect(view.dom.dataset.selectionRendering).toBe("drawn")
    expect(view.dom.querySelector(".cm-selectionLayer")).not.toBeNull()
    expect(view.dom.querySelector(".cm-cursorLayer")).not.toBeNull()
    expect(getDrawSelectionConfig(view.state).drawRangeCursor).toBe(false)
  })

  it("iOS 实际组件保留原生选区，不挂 CodeMirror 自绘层", () => {
    setNavigatorPlatform({
      maxTouchPoints: 5,
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    })
    mount(<MarkdownEditor onChange={() => {}} value={"第一行\n第二行"} />)
    const view = editorView()

    expect(view.dom.dataset.selectionRendering).toBe("native")
    expect(view.dom.querySelector(".cm-selectionLayer")).toBeNull()
    expect(view.dom.querySelector(".cm-cursorLayer")).toBeNull()
  })

  function pasteEvent(data: { files?: File[]; html?: string; itemFiles?: File[]; text?: string }) {
    const event = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", { value: {
      files: data.files ?? [],
      getData: (type: string) => type === "text/plain" ? data.text ?? "" : type === "text/html" ? data.html ?? "" : "",
      items: (data.itemFiles ?? []).map((file) => ({ getAsFile: () => file, kind: "file" })),
    } })
    return event
  }

  function clipboardEvent(type: "copy" | "cut") {
    const data = new Map<string, string>()
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", { value: {
      clearData: (format?: string) => { format ? data.delete(format) : data.clear() },
      getData: (format: string) => data.get(format) ?? "",
      setData: (format: string, value: string) => { data.set(format, value) },
    } })
    return { data, event }
  }

  function markdownRangeText(content: string, from: number, to: number, reverse = false, livePreview = true) {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: content,
        extensions: livePreview ? [markdown({ base: markdownLanguage }), markdownLivePreview({})] : [markdown({ base: markdownLanguage })],
        selection: reverse ? { anchor: to, head: from } : { anchor: from, head: to },
      }),
    })
    ensureSyntaxTree(view.state, content.length, 1000)
    const selected = selectedMarkdownRange(view)
    view.destroy()
    return selected?.text ?? ""
  }

  it("点击图片本体打开预览，Esc 关闭后焦点回到图片", async () => {
    mount(<MarkdownEditor onChange={() => {}} value={"正文\n\n![截图](data:image/png;base64,cG5n)"} />)
    await act(async () => {
      // 全量并发时图片装饰的异步解析可能超过固定 30ms；等待真实节点就绪并设置上限，
      // 让测试验证组件状态而不是机器调度速度。
      for (let attempt = 0; attempt < 30 && !container?.querySelector(".cm-md-image img"); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })
    const image = container!.querySelector<HTMLImageElement>(".cm-md-image img")!
    expect(image).not.toBeNull()

    await act(async () => { image.click(); await Promise.resolve() })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.activeElement).toBe(document.querySelector(".image-zoom-close"))

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }))
      for (let attempt = 0; attempt < 30 && document.activeElement !== image; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(image)

    await act(async () => { image.click(); await Promise.resolve() })
    act(() => { editorView().dispatch({ selection: { anchor: editorView().state.doc.toString().indexOf("![截图]") } }) })
    expect(image.isConnected).toBe(false)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }))
      for (let attempt = 0; attempt < 30 && !editorView().hasFocus; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })
    expect(editorView().hasFocus).toBe(true)
  })

  it("Cmd-V 可从 items.getAsFile 插入截图，files/items 重复时只插入一次", () => {
    const image = new File(["png"], "截图.png", { type: "image/png" })
    const onInsertFiles = vi.fn()
    mount(<MarkdownEditor onChange={() => {}} onInsertFiles={onInsertFiles} value="正文" />)
    const event = pasteEvent({ files: [image], itemFiles: [image] })
    act(() => { editorView().contentDOM.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(onInsertFiles).toHaveBeenCalledWith([image])
  })

  it("网页混合文字/HTML/图片时保留网页内容，不误选附件", () => {
    const image = new File(["png"], "网页图片.png", { type: "image/png" })
    const onInsertFiles = vi.fn()
    const onChange = vi.fn()
    mount(<MarkdownEditor onChange={onChange} onInsertFiles={onInsertFiles} value="正文" />)
    act(() => { editorView().contentDOM.dispatchEvent(pasteEvent({ files: [image], html: "<strong>网页文字</strong>", text: "网页文字" })) })
    expect(onInsertFiles).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenLastCalledWith("**网页文字**正文", expect.anything())
  })

  it("只读状态不接管图片粘贴", () => {
    const image = new File(["png"], "截图.png", { type: "image/png" })
    const onInsertFiles = vi.fn()
    mount(<MarkdownEditor onChange={() => {}} onInsertFiles={onInsertFiles} readOnly value="正文" />)
    const event = pasteEvent({ itemFiles: [image] })
    act(() => { editorView().contentDOM.dispatchEvent(event) })
    expect(onInsertFiles).not.toHaveBeenCalled()
  })

  it("菜单粘贴可读取浏览器图片，并绑定触发时的插入位置", async () => {
    const handle = createRef<MarkdownEditorHandle>()
    const image = new Blob(["png"], { type: "image/png" })
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn().mockResolvedValue([{ getType: vi.fn().mockResolvedValue(image), types: ["image/png"] }]),
    } })
    const onInsertFiles = vi.fn()
    mount(<MarkdownEditor onChange={() => {}} onInsertFiles={onInsertFiles} ref={handle} value="正文" />)
    act(() => { handle.current!.findText("正文") })
    await act(async () => { expect(await handle.current!.pasteAtSelection()).toBe(true) })
    expect(onInsertFiles).toHaveBeenCalledWith([expect.objectContaining({ type: "image/png" })])
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("菜单读取到网页文字与图片时优先粘贴文字", async () => {
    const handle = createRef<MarkdownEditorHandle>()
    const blobs = {
      "image/png": new Blob(["png"], { type: "image/png" }),
      "text/plain": { text: vi.fn().mockResolvedValue("网页正文") },
    }
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn().mockResolvedValue([{
        getType: vi.fn((type: keyof typeof blobs) => Promise.resolve(blobs[type] as Blob)),
        types: ["text/plain", "image/png"],
      }]),
    } })
    const onChange = vi.fn()
    const onInsertFiles = vi.fn()
    mount(<MarkdownEditor onChange={onChange} onInsertFiles={onInsertFiles} ref={handle} value="原文" />)
    await act(async () => { expect(await handle.current!.pasteAtSelection()).toBe(true) })
    expect(onChange).toHaveBeenLastCalledWith("网页正文原文", expect.anything())
    expect(onInsertFiles).not.toHaveBeenCalled()
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("复制从即时预览结构行可见文字起点开始的选区时补回 Markdown 前缀", async () => {
    const content = [
      "- 第一项",
      "  - [x] 子任务",
      "> 1. 引用有序",
    ].join("\n")
    expect(markdownRangeText(content, content.indexOf("第一项"), content.indexOf("\n  - [x]"))).toBe("- 第一项")
    expect(markdownRangeText(content, content.indexOf("第一项"), content.indexOf("第一项") + 1)).toBe("第")
    expect(markdownRangeText(content, content.indexOf("子任务"), content.indexOf("\n>"))).toBe("  - [x] 子任务")
    expect(markdownRangeText(content, content.indexOf("1. "), content.length, true)).toBe("> 1. 引用有序")
    expect(markdownRangeText("1. 第一项", 3, 6)).toBe("第一项")
    expect(markdownRangeText("- **粗体**", 4, 6)).toBe("- **粗体**")
    expect(markdownRangeText("- 第一项\n- **粗体**", 2, 12)).toBe("- 第一项\n- **粗体**")
    expect(markdownRangeText("- 第一项\n- **粗体** 后续", 2, 12)).toBe("- 第一项\n- **粗体")
    expect(markdownRangeText("# 一级标题", 2, 6)).toBe("# 一级标题")
    expect(markdownRangeText("# 一级标题", 2, 4)).toBe("一级")
    expect(markdownRangeText("Setext\n===", 0, 6)).toBe("Setext")
    expect(markdownRangeText("- &amp;word", 7, 11)).toBe("word")
    expect(markdownRangeText(content, content.indexOf("一项"), content.indexOf("一项") + 2)).toBe("一项")
    expect(markdownRangeText("    - code", 6, 10)).toBe("code")
  })

  it("结构行复制不依赖当前行还在 live-preview 可见装饰范围内", async () => {
    const content = `- 第一项\n\n${"长段落".repeat(2000)}\n\n- 最后一项`
    const from = content.indexOf("第一项")
    const to = content.indexOf("最后一项") + "最后一项".length
    expect(markdownRangeText(content, from, to, false, false)).toBe(content)
  })

  it("空光标停在结构标记上时按即时预览可见源码处理，不补未选前缀", () => {
    const content = "- 第一项"
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: content,
        extensions: [markdown({ base: markdownLanguage }), markdownLivePreview({}), EditorState.allowMultipleSelections.of(true)],
        selection: EditorSelection.create([
          EditorSelection.cursor(0),
          EditorSelection.range(2, content.length),
        ]),
      }),
    })
    ensureSyntaxTree(view.state, content.length, 1000)
    expect(selectedMarkdownRange(view)?.text).toBe("第一项")
    view.destroy()
  })

  it("结构前缀只有部分被隐藏时不补可见且未选中的源码", () => {
    const content = "> - body"
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: content,
        extensions: [markdown({ base: markdownLanguage }), markdownLivePreview({}), EditorState.allowMultipleSelections.of(true)],
        selection: EditorSelection.create([
          EditorSelection.cursor(0),
          EditorSelection.range(4, content.length),
        ]),
      }),
    })
    ensureSyntaxTree(view.state, content.length, 1000)
    expect(selectedMarkdownRange(view)?.text).toBe("body")
    view.destroy()
  })

  it("工具栏复制与剪切使用同一份带 Markdown 前缀的选区文本", async () => {
    const handle = createRef<MarkdownEditorHandle>()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    mount(<MarkdownEditor onChange={() => {}} ref={handle} value={"- 第一项\n- 第二项"} />)
    const view = editorView()
    const from = view.state.doc.toString().indexOf("第一项")
    act(() => { view.dispatch({ selection: { anchor: from, head: view.state.doc.length } }) })

    await act(async () => { expect(await handle.current!.copySelection()).toBe(true) })
    expect(writeText).toHaveBeenLastCalledWith("- 第一项\n- 第二项")

    await act(async () => { expect(await handle.current!.cutSelection()).toBe(true) })
    expect(writeText).toHaveBeenLastCalledWith("- 第一项\n- 第二项")
    expect(editorView().state.doc.toString()).toBe("")
    act(() => { handle.current!.undo() })
    expect(editorView().state.doc.toString()).toBe("- 第一项\n- 第二项")
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("工具栏复制与剪切支持多个选区并按同一批范围删除", async () => {
    const handle = createRef<MarkdownEditorHandle>()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    mount(<MarkdownEditor onChange={() => {}} ref={handle} value={"- 第一项\n- 第二项\n- 第三项"} />)
    const view = editorView()
    const doc = view.state.doc.toString()
    const first = doc.indexOf("第一项")
    const third = doc.indexOf("第三项")
    act(() => {
      view.dispatch({
        selection: EditorSelection.create([
          EditorSelection.range(first, doc.indexOf("\n")),
          EditorSelection.range(third, doc.length),
        ]),
      })
    })

    await act(async () => { expect(await handle.current!.copySelection()).toBe(true) })
    expect(writeText).toHaveBeenLastCalledWith("- 第一项\n- 第三项")

    await act(async () => { expect(await handle.current!.cutSelection()).toBe(true) })
    expect(writeText).toHaveBeenLastCalledWith("- 第一项\n- 第三项")
    expect(editorView().state.doc.toString()).toBe("\n- 第二项\n")
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("原生 copy/cut 与工具栏保持同样的 Markdown 选区语义", () => {
    mount(<MarkdownEditor onChange={() => {}} value={"- 第一项\n- 第二项"} />)
    const view = editorView()
    const from = view.state.doc.toString().indexOf("第一项")
    act(() => { view.focus(); view.dispatch({ selection: { anchor: from, head: view.state.doc.length } }) })

    const copy = clipboardEvent("copy")
    act(() => { view.contentDOM.dispatchEvent(copy.event) })
    expect(copy.event.defaultPrevented).toBe(true)
    expect(copy.data.get("text/plain")).toBe("- 第一项\n- 第二项")

    const cut = clipboardEvent("cut")
    act(() => { view.contentDOM.dispatchEvent(cut.event) })
    expect(cut.event.defaultPrevented).toBe(true)
    expect(cut.data.get("text/plain")).toBe("- 第一项\n- 第二项")
    expect(view.state.doc.toString()).toBe("")
  })

  it("原生复制多个选区时逐段补齐结构前缀并用换行拼接", () => {
    mount(<MarkdownEditor onChange={() => {}} value={"- 第一项\n- 第二项"} />)
    const view = editorView()
    const doc = view.state.doc.toString()
    const first = doc.indexOf("第一项")
    const second = doc.indexOf("第二项")
    act(() => {
      view.focus()
      view.dispatch({
        selection: EditorSelection.create([
          EditorSelection.range(first, doc.indexOf("\n")),
          EditorSelection.range(second, doc.length),
        ]),
      })
    })

    const copy = clipboardEvent("copy")
    act(() => { view.contentDOM.dispatchEvent(copy.event) })
    expect(copy.event.defaultPrevented).toBe(true)
    expect(copy.data.get("text/plain")).toBe("- 第一项\n- 第二项")
  })

  it("原生剪切写剪贴板失败时不删除编辑器内容", () => {
    mount(<MarkdownEditor onChange={() => {}} value="- 第一项" />)
    const view = editorView()
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 2, head: view.state.doc.length } }) })

    const event = new Event("cut", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", { value: {
      clearData: vi.fn(),
      setData: vi.fn(() => { throw new Error("denied") }),
    } })
    act(() => { view.contentDOM.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe("- 第一项")
  })

  it("编辑器失焦时原生复制不截获页面其它 DOM 选区", () => {
    mount(<MarkdownEditor onChange={() => {}} value="- 第一项" />)
    const view = editorView()
    act(() => { view.dispatch({ selection: { anchor: 2, head: view.state.doc.length } }) })
    const input = document.createElement("input")
    document.body.append(input)
    input.focus()

    const copy = clipboardEvent("copy")
    act(() => { view.contentDOM.dispatchEvent(copy.event) })
    expect(copy.event.defaultPrevented).toBe(false)
    expect(copy.data.get("text/plain")).toBeUndefined()
  })

  it("页面真实 DOM 选区不完全属于编辑器时不接管原生复制", () => {
    mount(<MarkdownEditor onChange={() => {}} value="- 第一项" />)
    const view = editorView()
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 2, head: view.state.doc.length } }) })
    const outside = document.createElement("div")
    outside.textContent = "外部文字"
    document.body.append(outside)
    const selection = vi.spyOn(document, "getSelection").mockReturnValue({
      anchorNode: outside.firstChild,
      focusNode: outside.firstChild,
      isCollapsed: false,
      rangeCount: 1,
    } as Selection)

    const copy = clipboardEvent("copy")
    act(() => { view.contentDOM.dispatchEvent(copy.event) })
    expect(copy.data.get("text/plain")).not.toBe("- 第一项")
    selection.mockRestore()
  })

  it("原生复制不接管表格单元格 textarea 自己的选区", () => {
    mount(<MarkdownEditor onChange={() => {}} value={"| A | B |\n| --- | --- |\n| 1 | 2 |"} />)
    const view = editorView()
    const textarea = document.createElement("textarea")
    textarea.value = "cell"
    view.contentDOM.append(textarea)
    textarea.setSelectionRange(0, 4)

    const copy = clipboardEvent("copy")
    act(() => { textarea.dispatchEvent(copy.event) })
    expect(copy.event.defaultPrevented).toBe(false)
    expect(copy.data.get("text/plain")).toBeUndefined()
  })

  it("菜单图片使用默认书签，附件完成后光标落到图片引用之后", async () => {
    const handle = createRef<MarkdownEditorHandle>()
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn().mockResolvedValue([{
        getType: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
        types: ["image/png"],
      }]),
    } })
    const markdown = "![截图](../attachments/截图.png)\n"
    const onInsertFiles = vi.fn(() => {
      const insertion = handle.current!.captureInsertion()
      insertion.insert(markdown)
    })
    mount(<MarkdownEditor onChange={() => {}} onInsertFiles={onInsertFiles} ref={handle} value="正文" />)
    act(() => { handle.current!.findText("正文") })
    await act(async () => { expect(await handle.current!.pasteAtSelection()).toBe(true) })
    expect(onInsertFiles).toHaveBeenCalledWith([expect.objectContaining({ type: "image/png" })])
    expect(editorView().state.selection.main.head).toBe(markdown.length)
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("菜单异步读取期间选区变化会取消图片插入", async () => {
    const handle = createRef<MarkdownEditorHandle>()
    let resolveRead!: (value: ClipboardItem[]) => void
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn(() => new Promise<ClipboardItem[]>((resolve) => { resolveRead = resolve })),
    } })
    const onInsertFiles = vi.fn()
    mount(<MarkdownEditor onChange={() => {}} onInsertFiles={onInsertFiles} ref={handle} value="甲乙" />)
    const pending = handle.current!.pasteAtSelection()
    act(() => { handle.current!.findText("乙") })
    resolveRead([{ getType: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })), types: ["image/png"] } as unknown as ClipboardItem])
    await act(async () => { expect(await pending).toBe(false) })
    expect(onInsertFiles).not.toHaveBeenCalled()
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("菜单图片与快捷粘贴一致，不把附件插进代码范围", async () => {
    const handle = createRef<MarkdownEditorHandle>()
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn().mockResolvedValue([{
        getType: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
        types: ["image/png"],
      }]),
    } })
    const onInsertFiles = vi.fn()
    const onPasteError = vi.fn()
    mount(<MarkdownEditor onChange={() => {}} onInsertFiles={onInsertFiles} onPasteError={onPasteError} ref={handle} value="正文 `code`" />)
    act(() => { handle.current!.findText("code") })
    await act(async () => { expect(await handle.current!.pasteAtSelection()).toBe(false) })
    expect(onInsertFiles).not.toHaveBeenCalled()
    expect(onPasteError).toHaveBeenCalledWith("代码范围内不能插入图片")
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("DOM 空事件异步兜底期间切换会话和附件处理器会取消迟到图片", async () => {
    let resolveRead!: (value: ClipboardItem[]) => void
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      read: vi.fn(() => new Promise<ClipboardItem[]>((resolve) => { resolveRead = resolve })),
    } })
    const first = vi.fn()
    const second = vi.fn()
    mount(<MarkdownEditor onChange={() => {}} onInsertFiles={first} sessionKey="note-a" value="相同正文" />)
    act(() => { editorView().contentDOM.dispatchEvent(pasteEvent({})) })
    act(() => { root!.render(<MarkdownEditor onChange={() => {}} onInsertFiles={second} sessionKey="note-b" value="相同正文" />) })
    resolveRead([{ getType: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })), types: ["image/png"] } as unknown as ClipboardItem])
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    Reflect.deleteProperty(navigator, "clipboard")
  })

  it("代码范围粘贴始终走纯文本路径，不把 URL 或 HTML 转成 Markdown", () => {
    const fenced = EditorState.create({
      doc: "```ts\nconst url = old\n```",
      extensions: [markdown({ base: markdownLanguage })],
      selection: { anchor: 14, head: 17 },
    })
    expect(shouldPasteAsPlainText(fenced)).toBe(true)

    const inline = EditorState.create({
      doc: "正文 `old` 结尾",
      extensions: [markdown({ base: markdownLanguage })],
      selection: { anchor: 4, head: 7 },
    })
    expect(shouldPasteAsPlainText(inline)).toBe(true)

    const paragraph = EditorState.create({
      doc: "正文 old 结尾",
      extensions: [markdown({ base: markdownLanguage })],
      selection: { anchor: 3, head: 6 },
    })
    expect(shouldPasteAsPlainText(paragraph)).toBe(false)
  })
  it("keeps an attachment bookmark while the cursor moves and earlier text changes", () => {
    const handle = createRef<MarkdownEditorHandle>()
    const onChange = vi.fn()
    mount(<MarkdownEditor onChange={onChange} ref={handle} value="开头 目标 结尾" />)
    act(() => { handle.current!.findText("目标") })
    const insertion = handle.current!.captureInsertion()
    act(() => {
      handle.current!.findText("开头", "next", true)
      handle.current!.insertText("更长的开头")
      expect(insertion.insert("附件")).toBe(true)
    })
    expect(onChange).toHaveBeenLastCalledWith("更长的开头 附件目标 结尾", expect.anything())
  })

  it("rejects a late attachment after its editor was unmounted", () => {
    const handle = createRef<MarkdownEditorHandle>()
    mount(<MarkdownEditor onChange={() => {}} ref={handle} value="正文" />)
    const insertion = handle.current!.captureInsertion()
    act(() => { root!.render(<div />) })
    expect(insertion.insert("附件")).toBe(false)
  })

  // 附件书签（captureInsertion → 异步完成后 insert）的行为约定，逐条对应审计场景。
  describe("附件插入书签", () => {
    it("有文字选区时插入图片不删除选中文字，插入点在选区起点", () => {
      const handle = createRef<MarkdownEditorHandle>()
      const onChange = vi.fn()
      mount(<MarkdownEditor onChange={onChange} ref={handle} value="甲乙丙丁" />)
      act(() => { handle.current!.findText("乙丙") })
      const insertion = handle.current!.captureInsertion()
      act(() => { expect(insertion.insert("![图](x.png)\n")).toBe(true) })
      expect(onChange).toHaveBeenLastCalledWith("甲![图](x.png)\n乙丙丁", expect.anything())
    })

    it("等待期间光标移到别处继续写作，插入完成不打断当前光标", () => {
      const handle = createRef<MarkdownEditorHandle>()
      mount(<MarkdownEditor onChange={() => {}} ref={handle} value={"开头 目标 结尾\n\n第二段"} />)
      act(() => { handle.current!.findText("目标") })
      const insertion = handle.current!.captureInsertion()
      act(() => { handle.current!.findText("第二段", "next", true) })
      const before = editorView().state.selection.main.head
      act(() => { expect(insertion.insert("![图](x.png)\n")).toBe(true) })
      const state = editorView().state
      // 光标留在「第二段」所在行（位置随插入映射前移），不跳回插入点。
      expect(state.doc.lineAt(state.selection.main.head).text).toBe("第二段")
      expect(state.selection.main.head).toBeGreaterThan(before)
    })

    it("光标仍停在插入点时，完成后光标落在图片之后", () => {
      const handle = createRef<MarkdownEditorHandle>()
      mount(<MarkdownEditor onChange={() => {}} ref={handle} value="开头 目标 结尾" />)
      act(() => { handle.current!.findText("目标") })
      const insertion = handle.current!.captureInsertion()
      const text = "![图](x.png)\n"
      act(() => { expect(insertion.insert(text)).toBe(true) })
      expect(editorView().state.selection.main.head).toBe(3 + text.length)
    })

    it("等待期间删除原目标段落，插入落在映射后的原位置", () => {
      const handle = createRef<MarkdownEditorHandle>()
      const onChange = vi.fn()
      mount(<MarkdownEditor onChange={onChange} ref={handle} value="开头 目标 结尾" />)
      act(() => { handle.current!.findText("目标") })
      const insertion = handle.current!.captureInsertion()
      act(() => { editorView().dispatch({ changes: { from: 3, to: 6 } }) })
      act(() => { expect(insertion.insert("![图](x.png)\n")).toBe(true) })
      expect(onChange).toHaveBeenLastCalledWith("开头 ![图](x.png)\n结尾", expect.anything())
    })

    it("多张图片一次插入作为一步撤销与重做", () => {
      const handle = createRef<MarkdownEditorHandle>()
      mount(<MarkdownEditor onChange={() => {}} ref={handle} value="正文" />)
      act(() => { handle.current!.findText("正文") })
      const insertion = handle.current!.captureInsertion()
      const images = "![甲](a.png)\n\n![乙](b.png)\n"
      act(() => { expect(insertion.insert(images)).toBe(true) })
      act(() => { handle.current!.undo() })
      expect(editorView().state.doc.toString()).toBe("正文")
      act(() => { handle.current!.redo() })
      expect(editorView().state.doc.toString()).toBe(`${images}正文`)
    })

    it("撤销插入不连带撤销插入前的输入", () => {
      const handle = createRef<MarkdownEditorHandle>()
      mount(<MarkdownEditor onChange={() => {}} ref={handle} value="正文" />)
      // 模拟用户在插图前刚敲过一个字（与随后的附件插入落在同一撤销时间窗内）。
      act(() => { editorView().dispatch({ changes: { from: 2, insert: "新" }, selection: { anchor: 3 }, userEvent: "input.type" }) })
      const insertion = handle.current!.captureInsertion()
      act(() => { expect(insertion.insert("![图](x.png)\n")).toBe(true) })
      act(() => { handle.current!.undo() })
      expect(editorView().state.doc.toString()).toBe("正文新")
    })

    it("同一个书签只能落笔一次，迟到的重复回调不会重复插入", () => {
      const handle = createRef<MarkdownEditorHandle>()
      const onChange = vi.fn()
      mount(<MarkdownEditor onChange={onChange} ref={handle} value="正文" />)
      const insertion = handle.current!.captureInsertion()
      act(() => { expect(insertion.insert("![图](x.png)\n")).toBe(true) })
      expect(insertion.insert("![图](x.png)\n")).toBe(false)
      expect(onChange).toHaveBeenLastCalledWith("![图](x.png)\n正文", expect.anything())
    })

    it("支持显式插入位置（文件拖入的落点），与旧光标无关", () => {
      const handle = createRef<MarkdownEditorHandle>()
      const onChange = vi.fn()
      mount(<MarkdownEditor onChange={onChange} ref={handle} value={"第一段\n\n第二段"} />)
      act(() => { handle.current!.findText("第一段") })
      const insertion = handle.current!.captureInsertion(5)
      act(() => { expect(insertion.insert("![图](x.png)\n")).toBe(true) })
      expect(onChange).toHaveBeenLastCalledWith("第一段\n\n![图](x.png)\n第二段", expect.anything())
    })
  })

  it("separates an image from a table even with following document content", () => {
    const handle = createRef<MarkdownEditorHandle>()
    const onChange = vi.fn()
    mount(<MarkdownEditor onChange={onChange} ref={handle} value={"| A | B |\n| --- | --- |\n| 1 | 2 |\n\n后续正文"} />)
    act(() => { handle.current!.revealLine(4); handle.current!.insertText("![图](image.png)\n") })
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toContain("| 1 | 2 |\n\n![图](image.png)")
  })

  it("finds plain text without case sensitivity and keeps offsets", () => {
    expect(findPlainTextMatches("Swell note SWELL", "swell")).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ])
    expect(findPlainTextMatches("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ])
    expect(findPlainTextMatches("正文", "")).toEqual([])
  })

  it("finds and replaces through the editor handle", () => {
    const handle = createRef<MarkdownEditorHandle>()
    const onChange = vi.fn()
    mount(<MarkdownEditor onChange={onChange} ref={handle} value="第一处 TODO，第二处 todo" />)

    expect(handle.current!.findText("todo", "next", true)).toEqual({ current: 1, total: 2 })
    expect(handle.current!.replaceCurrent("todo", "完成")).toEqual({ current: 1, total: 1 })
    expect(handle.current!.replaceAll("todo", "完成")).toBe(1)
    expect(onChange).toHaveBeenLastCalledWith("第一处 完成，第二处 完成", expect.anything())
  })

  it("formats the current selection instead of discarding it", () => {
    expect(formatToolbarText("**加粗文字**", "重点").text).toBe("**重点**")
    expect(formatToolbarText("\n> ", "第一行\n第二行").text).toBe("> 第一行\n> 第二行")
    expect(formatToolbarText("\n```\n\n```\n", "const value = 1").text)
      .toBe("\n```\nconst value = 1\n```\n")
    expect(formatToolbarText("[链接](https://)", "官网")).toEqual({
      selection: { from: 5, to: 13 },
      text: "[官网](https://)",
    })
  })

  it("places the caret inside new code blocks and selects a new link URL", () => {
    expect(formatToolbarText("[链接](https://)", "")).toEqual({
      text: "[链接](https://)", selection: { from: 5, to: 13 },
    })
    expect(formatToolbarText("\n```\n\n```\n", "")).toEqual({
      text: "\n```\n\n```\n", selection: { from: 5, to: 5 },
    })
  })

  it("reports the cursor position through the latest callback", () => {
    const handle = createRef<MarkdownEditorHandle>()
    const first = vi.fn()
    mount(<MarkdownEditor onChange={() => {}} onCursorChange={first} ref={handle} value={"第一行\n第二行"} />)

    // 换成新的内联回调后仍要生效：扩展经 ref 中转，不随回调身份重建。
    const second = vi.fn()
    act(() => {
      root!.render(<MarkdownEditor onChange={() => {}} onCursorChange={second} ref={handle} value={"第一行\n第二行"} />)
    })

    act(() => { handle.current!.insertText("补充") })

    expect(second).toHaveBeenCalledWith(1, 3)
    expect(first).not.toHaveBeenCalled()
  })

  // 插入新表格后，光标此前停在整段 Markdown 之后，用户还得再点一次单元格才能改表头，
  // 比其它模板慢一拍；现在会自动点开第一个表头格。真的挂起完整 CodeMirror 视图再触发
  // 点击会牵出 jsdom 对文本测量的已知缺口（getClientRects 不完整），所以只单测「按插入
  // 位置的行首找到对应表格 wrapper」这段容易出错的定位逻辑，点击本身沿用既有的单元格编辑路径。
  it("按插入位置的行首能在多张表格里定位到刚插入的那一张", () => {
    const root = document.createElement("div")
    root.innerHTML = `
      <div class="cm-md-table-wrap" data-table-from="0"><table><thead><tr><th>旧表格</th></tr></thead></table></div>
      <div class="cm-md-table-wrap" data-table-from="42"><table><thead><tr><th>列 1</th></tr></thead></table></div>
    `
    expect(findTableWrapperAtLine(root, 42)?.querySelector("th")?.textContent).toBe("列 1")
    expect(findTableWrapperAtLine(root, 999)).toBeNull()
  })

  // 稳定 EditorView 的组件层契约：切换笔记不再经 key 重建，
  // 因此焦点、输入法状态、滚动容器与 DOM 都必须是同一份。
  describe("稳定 EditorView", () => {
    it("切换笔记复用同一个 EditorView 与 DOM 节点", () => {
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" value="第一篇正文" />,
      )
      const view = editorView()
      const dom = view.dom
      const contentDOM = view.contentDOM

      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:b" value="第二篇正文" />)

      expect(editorView().dom).toBe(dom)
      expect(editorView().contentDOM).toBe(contentDOM)
      expect(editorView().state.doc.toString()).toBe("第二篇正文")
    })

    it("切换笔记不把上一篇正文写回宿主（避免旧正文闪现后被存成新内容）", () => {
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" value="第一篇正文" />,
      )
      onChange.mockClear()
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:b" value="第二篇正文" />)
      // 外部更新（切换笔记）标记为 external，宿主据此跳过「用户输入」的副作用。
      expect(onChange).not.toHaveBeenCalled()
      expect(editorView().state.doc.toString()).toBe("第二篇正文")
    })

    it("在多篇笔记之间快速切换，每一帧都只显示目标笔记的正文", () => {
      const onChange = vi.fn()
      const notes = [["cache:a", "A 正文"], ["cache:b", "B 正文"], ["cache:c", "C 正文"]] as const
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey={notes[0][0]} value={notes[0][1]} />,
      )
      const view = editorView()
      // 每次切换后立刻读 DOM 文本与视图正文：两者都必须已是新笔记，
      // 不能出现「上一篇正文还挂在屏幕上一帧」的中间态。
      for (let round = 0; round < 3; round += 1) {
        for (const [sessionKey, content] of notes) {
          rerender(<MarkdownEditor onChange={onChange} sessionKey={sessionKey} value={content} />)
          expect(editorView()).toBe(view)
          expect(editorView().state.doc.toString()).toBe(content)
          expect(editorView().contentDOM.textContent).toBe(content)
        }
      }
      // 允许切换补发的 external 事件，但用户输入路径不应被这些切换触发。
      expect(onChange).not.toHaveBeenCalled()
    })

    it("只读与主题变化不重建 EditorView", () => {
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" readOnly={false} value="正文" />,
      )
      const view = editorView()
      const dom = view.dom

      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:a" readOnly value="正文" />)
      expect(editorView().dom).toBe(dom)
      expect(editorView().state.readOnly).toBe(true)

      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:a" readOnly={false} value="正文" />)
      expect(editorView().dom).toBe(dom)
      expect(editorView().state.readOnly).toBe(false)
    })

    it("重复挂载/卸载十次不残留编辑器 DOM", () => {
      for (let round = 0; round < 10; round += 1) {
        mount(<MarkdownEditor onChange={() => {}} sessionKey="cache:a" value="正文" />)
        expect(container!.querySelectorAll(".cm-editor")).toHaveLength(1)
        act(() => { root!.unmount() })
        expect(container!.querySelectorAll(".cm-editor")).toHaveLength(0)
        // 重新挂载下一个实例，复用同一容器。
        root = createRoot(container!)
      }
    })

    it("切换笔记的正文同步走 layout effect，绘制前即已落到目标正文", () => {
      // jsdom 里 act + rerender 会同步冲刷所有 effect，无法观测真实的 paint 时序，
      // 本用例只能验证「正文同步经 layout effect 路径、切换本身不触发用户 onChange」。
      // 真实浏览器的无闪现保证依赖 useLayoutEffect 在绘制前同步执行——这属于 React 语义，
      // 测试环境无法直接断言 paint，但可断言 layout effect 路径产生的副作用与 external 语义。
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" value="第一篇正文" />,
      )
      const view = editorView()
      onChange.mockClear()
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:b" value="第二篇正文" />)

      // 正文已同步；且切换是 external 更新，绝不调用用户 onChange 保存回调。
      expect(view.state.doc.toString()).toBe("第二篇正文")
      expect(onChange).not.toHaveBeenCalled()
    })

    it("快速 A→B→C 切换不把 A 或 B 的正文写进 C，也不触发保存", () => {
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" value="A 正文" />,
      )
      const view = editorView()
      onChange.mockClear()

      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:b" value="B 正文" />)
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:c" value="C 正文" />)

      expect(view.state.doc.toString()).toBe("C 正文")
      expect(onChange).not.toHaveBeenCalled()
    })

    it("返回原笔记时选区与撤销历史按会话恢复", () => {
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" value={"甲\n乙\n丙"} />,
      )
      // 在 A 里产生一次可撤销的编辑。
      act(() => { editorView().dispatch({ changes: { from: 0, insert: "新" } }) })
      const editedA = editorView().state.doc.toString()
      expect(editedA).toBe("新甲\n乙\n丙")

      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:b" value="另一篇" />)
      expect(editorView().state.doc.toString()).toBe("另一篇")
      expect(undoDepth(editorView().state)).toBe(0)

      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:a" value={editedA} />)
      expect(editorView().state.doc.toString()).toBe(editedA)
      // 撤销历史随会话恢复，但绝不能串到 B 上。
      expect(undoDepth(editorView().state)).toBe(1)
      act(() => { editorView().dispatch({ changes: { from: 0, insert: "" } }) })
    })
  })

  describe("异步附件不写入已切走的笔记", () => {
    it("书签属于切换前的笔记时拒绝插入", () => {
      const handle = createRef<MarkdownEditorHandle>()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={() => {}} ref={handle} sessionKey="cache:a" storageKey="note-a" value="第一篇" />,
      )
      const insertion = handle.current!.captureInsertion()

      rerender(<MarkdownEditor onChange={() => {}} ref={handle} sessionKey="cache:b" storageKey="note-b" value="第二篇" />)

      // 返回 false 让调用方走「追加到原笔记末尾」的安全降级，而不是污染当前笔记。
      expect(insertion.insert("![图](x.png)\n")).toBe(false)
      expect(editorView().state.doc.toString()).toBe("第二篇")
    })

    it("上传期间笔记被同步合并过（revision 变化）时拒绝插入", () => {
      const handle = createRef<MarkdownEditorHandle>()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={() => {}} ref={handle} revision={'"r1"'} sessionKey="cache:a" storageKey="note-a" value="第一篇" />,
      )
      const insertion = handle.current!.captureInsertion()

      // 同一篇笔记，但远端 revision 已经变了：偏移映射不再可信。
      rerender(<MarkdownEditor onChange={() => {}} ref={handle} revision={'"r2"'} sessionKey="cache:a" storageKey="note-a" value="第一篇" />)

      expect(insertion.insert("![图](x.png)\n")).toBe(false)
      expect(editorView().state.doc.toString()).toBe("第一篇")
    })

    it("revision 未变化时正常插入", () => {
      const handle = createRef<MarkdownEditorHandle>()
      mount(<MarkdownEditor onChange={() => {}} ref={handle} revision={'"r1"'} sessionKey="cache:a" storageKey="note-a" value="第一篇" />)
      const insertion = handle.current!.captureInsertion()
      expect(insertion.insert("![图](x.png)\n")).toBe(true)
    })

    it("书签仍属于当前笔记时正常插入", () => {
      const handle = createRef<MarkdownEditorHandle>()
      mount(<MarkdownEditor onChange={() => {}} ref={handle} sessionKey="cache:a" storageKey="note-a" value="第一篇" />)
      const insertion = handle.current!.captureInsertion()
      expect(insertion.insert("![图](x.png)\n")).toBe(true)
      expect(editorView().state.doc.toString()).toContain("![图](x.png)")
    })
  })

  describe("composition 期间的正文保护", () => {
    function beginComposition() {
      act(() => {
        editorView().contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))
      })
    }
    function endComposition() {
      act(() => {
        editorView().contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }))
      })
    }

    it("外部 value 回写不覆盖正在组合的中文，组合结束后旧 value 不覆盖最终正文", () => {
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" value="拼音" />,
      )
      const view = editorView()
      beginComposition()

      // 用户组合输入：CodeMirror 正文被 IME 改写（真实浏览器里这是 mutation 观察驱动的）。
      act(() => {
        view.dispatch({ changes: { from: 0, to: 2, insert: "你好" }, userEvent: "input.type.compose" })
      })

      // 保存回写此刻到达，正文是「慢一拍」的旧值：不得覆盖用户正在输入的中文。
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:a" value="拼音" />)
      expect(view.state.doc.toString()).toBe("你好")

      endComposition()
      // 组合结束后最终正文仍包含完整输入，旧 value 不得覆盖。
      expect(view.state.doc.toString()).toBe("你好")
    })

    it("composition 期间 readOnly 改变，结束后 EditorState 与 contenteditable 一致", () => {
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={() => {}} sessionKey="cache:a" readOnly={false} value="正文" />,
      )
      beginComposition()
      rerender(<MarkdownEditor onChange={() => {}} sessionKey="cache:a" readOnly value="正文" />)

      // 组合未结束，只读切换被挂起，此刻仍可编辑。
      expect(editorView().state.readOnly).toBe(false)
      expect(editorView().contentDOM.getAttribute("contenteditable")).toBe("true")

      endComposition()
      // 组合结束后只读落地，EditorState 与 DOM 不再分裂。
      expect(editorView().state.readOnly).toBe(true)
      expect(editorView().contentDOM.getAttribute("contenteditable")).toBe("false")
    })

    it("composition 期间切换笔记，旧 pending 不会覆盖新笔记", () => {
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" value="第一篇正文" />,
      )
      beginComposition()
      // 组合期间挂起一次旧笔记的外部回写，再切走。
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:a" value="外部回写旧正文" />)
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:b" value="第二篇正文" />)

      endComposition()
      // 旧 pending 不得反扑：新笔记正文保持第二篇。
      expect(editorView().state.doc.toString()).toBe("第二篇正文")
    })

    it("composition 期间多次 value/settings 更新，只应用正确的最终状态", () => {
      const onChange = vi.fn()
      const { rerender } = mountWithRerender(
        <MarkdownEditor onChange={onChange} sessionKey="cache:a" readOnly={false} value="初始正文" />,
      )
      beginComposition()
      // 多次挂起：旧正文回写、只读切换来回、最终只读落定。
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:a" readOnly value="回写一" />)
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:a" readOnly={false} value="回写二" />)
      rerender(<MarkdownEditor onChange={onChange} sessionKey="cache:a" readOnly value="回写三" />)

      endComposition()
      // 只读取最后一次挂起的值；正文不被外部回写覆盖（echo 语义）。
      expect(editorView().state.readOnly).toBe(true)
      expect(editorView().state.doc.toString()).toBe("初始正文")
    })
  })

  describe("在正文末尾补落点", () => {
    const table = "| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |"

    function stateOf(doc: string) {
      return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    }

    it("在表格正下方补一个空行，新写的内容才不会被并进表格", () => {
      expect(paragraphSeparatorAtEnd(stateOf(table))).toBe("\n\n")
      expect(paragraphSeparatorAtEnd(stateOf(`${table}\n`))).toBe("\n")
      expect(paragraphSeparatorAtEnd(stateOf(`${table}\n\n`))).toBe("")
    })

    it("正文以普通段落结尾时不改动文档", () => {
      expect(paragraphSeparatorAtEnd(stateOf("第一段\n\n第二段"))).toBe("")
      expect(paragraphSeparatorAtEnd(stateOf(`${table}\n\n表格后的段落`))).toBe("")
    })
  })
})
