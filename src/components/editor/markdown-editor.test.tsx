// @vitest-environment jsdom
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

import type { MarkdownEditorHandle } from "./markdown-editor"
import MarkdownEditor, { findPlainTextMatches, findTableWrapperAtLine, formatToolbarText, paragraphSeparatorAtEnd, shouldPasteAsPlainText } from "./markdown-editor"

// React 19 在测试里要求显式打开 act 环境标记。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom 的 Range 缺少布局 API；焦点回到 CodeMirror 时会读取它来刷新选区层。
if (!Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] })
}

let container: HTMLElement | null = null
let root: Root | null = null

function mount(element: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(element) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

describe("MarkdownEditor", () => {
  function editorView() {
    const view = EditorView.findFromDOM(container!.querySelector<HTMLElement>(".cm-editor")!)
    if (!view) throw new Error("编辑器未挂载")
    return view
  }

  function pasteEvent(data: { files?: File[]; html?: string; itemFiles?: File[]; text?: string }) {
    const event = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", { value: {
      files: data.files ?? [],
      getData: (type: string) => type === "text/plain" ? data.text ?? "" : type === "text/html" ? data.html ?? "" : "",
      items: (data.itemFiles ?? []).map((file) => ({ getAsFile: () => file, kind: "file" })),
    } })
    return event
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
