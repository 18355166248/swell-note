// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { history, historyKeymap, undo } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"

import { applyLinkTarget, detectFormatState, focusExistingLinkUrl, linkTargetAt, linkTargetInText, markdownInputEnhancements, removeLinkTarget, sanitizeLinkUrl, toggleBlockFormat, toggleInlineMark } from "./markdown-input"

function createView(doc: string, anchor: number, head = anchor) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage }), history(), markdownInputEnhancements(), keymap.of(historyKeymap)],
  })
  return new EditorView({ state, parent: document.body })
}

function press(view: EditorView, key: string, opts: KeyboardEventInit = {}) {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...opts }))
}

// basicSetup 自带 Alt+↑/↓ 移动、Shift+Alt+↑/↓ 复制整行（未在工具栏出现），但它们只逐行搬文本，
// 有序列表项挪位或被复制后编号仍留在原处。这里在同一按键上补一遍编号修正。
describe("moving/copying ordered list items keeps numbering sequential", () => {
  it("moving the first item down renumbers both items", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 3)
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 第二项\n2. 第一项\n3. 第三项")
    view.destroy()
  })

  it("moving an item up renumbers correctly", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 12) // 光标落在第 2 行
    press(view, "ArrowUp", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 第二项\n2. 第一项\n3. 第三项")
    view.destroy()
  })

  it("copying an item down renumbers the duplicate and everything after it", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 3)
    press(view, "ArrowDown", { altKey: true, shiftKey: true })
    expect(view.state.doc.toString()).toBe("1. 第一项\n2. 第一项\n3. 第二项\n4. 第三项")
    view.destroy()
  })

  it("preserves a custom start number instead of forcing 1", () => {
    const view = createView("5. 第一项\n6. 第二项\n7. 第三项", 3)
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.doc.toString()).toBe("5. 第二项\n6. 第一项\n7. 第三项")
    view.destroy()
  })

  it("renumbers a nested sublist independently of its outer list", () => {
    const doc = "1. 外层一\n   1. 内层一\n   2. 内层二\n   3. 内层三\n2. 外层二"
    const view = createView(doc, doc.indexOf("内层一"))
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 外层一\n   1. 内层二\n   2. 内层一\n   3. 内层三\n2. 外层二")
    view.destroy()
  })

  it("leaves bullet lists and plain paragraphs untouched", () => {
    const bullets = createView("- 要点一\n- 要点二\n- 要点三", 5)
    press(bullets, "ArrowDown", { altKey: true })
    expect(bullets.state.doc.toString()).toBe("- 要点二\n- 要点一\n- 要点三")
    bullets.destroy()

    const plain = createView("第一行\n第二行\n第三行", 2)
    press(plain, "ArrowDown", { altKey: true })
    expect(plain.state.doc.toString()).toBe("第二行\n第一行\n第三行")
    plain.destroy()
  })

  it("does nothing past a document boundary", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 3)
    press(view, "ArrowUp", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 第一项\n2. 第二项\n3. 第三项")
    view.destroy()
  })

  it("undoes the move and the renumbering together in one step", () => {
    const view = createView("1. 第一项\n2. 第二项\n3. 第三项", 3)
    press(view, "ArrowDown", { altKey: true })
    expect(view.state.doc.toString()).toBe("1. 第二项\n2. 第一项\n3. 第三项")
    press(view, "z", { ctrlKey: true })
    expect(view.state.doc.toString()).toBe("1. 第一项\n2. 第二项\n3. 第三项")
    view.destroy()
  })
})

// Cmd+B/Cmd+I 与工具栏的加粗/斜体/删除线/行内代码按钮共用这一路径：选区已经在对应标记
// 里面时应当「再点一次就取消」，而不是在外面再套一层，否则连续按会越叠越多层。
describe("toggleInlineMark", () => {
  it("wraps plain selected text when there is no existing mark", () => {
    const view = createView("这是 加粗 文字", 3, 5)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 **加粗** 文字")
    view.destroy()
  })

  it("unwraps when the selection is exactly the inner text", () => {
    const view = createView("这是 **加粗** 文字", 5, 7)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    expect(view.state.selection.main.from).toBe(3)
    expect(view.state.selection.main.to).toBe(5)
    view.destroy()
  })

  it("unwraps with an empty cursor placed inside the bold run", () => {
    const view = createView("这是 **加粗** 文字", 6)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    view.destroy()
  })

  it("unwraps even when the selection swallows the markers themselves", () => {
    const view = createView("这是 **加粗** 文字", 3, 9)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    view.destroy()
  })

  it("does not treat italic as bold", () => {
    const view = createView("这是 *斜体* 文字", 6)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 *斜体**加粗文字*** 文字")
    view.destroy()
  })

  it("toggles the outer bold when the cursor sits in a nested italic run", () => {
    const view = createView("**外层*内层*外层**", 5)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("外层*内层*外层")
    view.destroy()
  })

  it("toggles strikethrough and inline code through the same path", () => {
    const strike = createView("这是 ~~删除~~ 文字", 6)
    toggleInlineMark(strike, "strike", "删除线文字")
    expect(strike.state.doc.toString()).toBe("这是 删除 文字")
    strike.destroy()

    const code = createView("这是 `代码` 文字", 6)
    toggleInlineMark(code, "code", "行内代码")
    expect(code.state.doc.toString()).toBe("这是 代码 文字")
    code.destroy()
  })

  it("inserts the placeholder template when there is no selection and no enclosing mark", () => {
    const view = createView("这是文字", 2)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是**加粗文字**文字")
    view.destroy()
  })

  it("participates in undo/redo like a normal edit", () => {
    const view = createView("这是 **加粗** 文字", 6)
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    press(view, "z", { ctrlKey: true })
    expect(view.state.doc.toString()).toBe("这是 **加粗** 文字")
    press(view, "y", { ctrlKey: true })
    expect(view.state.doc.toString()).toBe("这是 加粗 文字")
    view.destroy()
  })

  // 三击选中一整行时，浏览器给出的选区会带上行首的列表编号和结尾的换行符；
  // 之前照单包裹会把 "**" 插进编号内部，把 "2. 第二项" 拆成 "**2. 第二项\n**"。
  it("keeps the ordered list marker outside the wrap when the selection spans a whole line", () => {
    const doc = "1. 第一项\n2. 第二项\n3. 第三项"
    const view = createView(doc, doc.indexOf("2. 第二项"), doc.indexOf("3. 第三项"))
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("1. 第一项\n2. **第二项**\n3. 第三项")
    view.destroy()
  })

  it("keeps the bullet marker outside the wrap the same way", () => {
    const doc = "- 要点一\n- 要点二\n- 要点三"
    const view = createView(doc, doc.indexOf("- 要点二"), doc.indexOf("- 要点三"))
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("- 要点一\n- **要点二**\n- 要点三")
    view.destroy()
  })

  it("drops just the trailing newline for a plain-paragraph whole-line selection", () => {
    const doc = "第一行\n第二行\n第三行"
    const view = createView(doc, doc.indexOf("第二行"), doc.indexOf("第三行"))
    toggleInlineMark(view, "strong", "加粗文字")
    expect(view.state.doc.toString()).toBe("第一行\n**第二行**\n第三行")
    view.destroy()
  })
})

// Cmd+K 在光标（无选区）落在已有链接文字里时，此前会在原文字中间插一段新链接，
// 拼出嵌套错乱的 Markdown；现在改成直接选中已有链接的 URL 方便就地改地址。
describe("focusExistingLinkUrl", () => {
  it("selects the URL when the empty cursor sits inside an existing link's label", () => {
    const doc = "这是 [已有链接](https://example.com) 结尾"
    const view = createView(doc, doc.indexOf("有链接"))
    expect(focusExistingLinkUrl(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)
    const selection = view.state.selection.main
    expect(view.state.sliceDoc(selection.from, selection.to)).toBe("https://example.com")
    view.destroy()
  })

  it("leaves a real selection alone so the caller falls back to wrapping", () => {
    const doc = "这是 [已有链接](https://example.com) 结尾"
    const from = doc.indexOf("有链接")
    const view = createView(doc, from, from + 2)
    expect(focusExistingLinkUrl(view)).toBe(false)
    view.destroy()
  })

  it("does nothing outside any link", () => {
    const view = createView("这是普通文字，没有链接", 3)
    expect(focusExistingLinkUrl(view)).toBe(false)
    view.destroy()
  })

  it("does nothing for a bracket-only link with no URL child", () => {
    const doc = "这是 [笔记双链] 结尾"
    const view = createView(doc, doc.indexOf("笔记"))
    expect(focusExistingLinkUrl(view)).toBe(false)
    view.destroy()
  })
})

// 移动端链接面板的读写路径：先按光标/点按位置取出链接结构，保存或移除时校验原文未变，
// 选区（含光标）随变更映射保留，手机上从面板返回不丢位置。
describe("linkTargetAt / applyLinkTarget / removeLinkTarget", () => {
  it("extracts label and url from the link under the cursor", () => {
    const doc = "这是 [已有链接](https://example.com) 结尾"
    const view = createView(doc, doc.indexOf("有链接"))
    const target = linkTargetAt(view.state, view.state.selection.main.head, view.state.selection.main.head)
    expect(target).toEqual({
      from: doc.indexOf("[已有链接]"),
      label: "已有链接",
      source: "[已有链接](https://example.com)",
      to: doc.indexOf(") 结尾") + 1,
      url: "https://example.com",
    })
    view.destroy()
  })

  it("returns null for wiki links, images and plain text", () => {
    const doc = "[[双链]] ![图](a.png) 普通"
    const view = createView(doc, 0)
    expect(linkTargetAt(view.state, 2, 2)).toBeNull()
    expect(linkTargetAt(view.state, doc.indexOf("图"), doc.indexOf("图"))).toBeNull()
    expect(linkTargetAt(view.state, doc.indexOf("普通"), doc.indexOf("普通"))).toBeNull()
    view.destroy()
  })

  it("creates a link from the current selection and keeps the selection mapped", () => {
    const doc = "选我 其余"
    const view = createView(doc, 0, 2)
    expect(applyLinkTarget(view, null, "选我", " https://example.com/a b ")).toBe(true)
    expect(view.state.doc.toString()).toBe("[选我](https://example.com/a%20b) 其余")
    const selection = view.state.selection.main
    // 原选区映射后罩住整段新链接源码（渲染态下可见部分就是链接文字）。
    expect(view.state.sliceDoc(selection.from, selection.to)).toBe("[选我](https://example.com/a%20b)")
    view.destroy()
  })

  it("rewrites an existing link in place", () => {
    const doc = "这是 [旧文字](https://old.example.com) 结尾"
    const view = createView(doc, doc.indexOf("旧文字"))
    const target = linkTargetAt(view.state, view.state.selection.main.head, view.state.selection.main.head)!
    expect(applyLinkTarget(view, target, "新文字", "https://new.example.com")).toBe(true)
    expect(view.state.doc.toString()).toBe("这是 [新文字](https://new.example.com) 结尾")
    view.destroy()
  })

  it("refuses to overwrite when the source changed while the panel was open", () => {
    const doc = "这是 [旧文字](https://old.example.com) 结尾"
    const view = createView(doc, doc.indexOf("旧文字"))
    const target = linkTargetAt(view.state, view.state.selection.main.head, view.state.selection.main.head)!
    view.dispatch({ changes: { from: doc.length, insert: "新内容" } })
    expect(applyLinkTarget(view, { ...target, source: "被改过的原文" }, "新文字", "https://new.example.com")).toBe(false)
    expect(removeLinkTarget(view, { ...target, source: "被改过的原文" })).toBe(false)
    view.destroy()
  })

  it("removes the link and keeps the label text", () => {
    const doc = "这是 [已有链接](https://example.com) 结尾"
    const view = createView(doc, doc.indexOf("有链接"))
    const target = linkTargetAt(view.state, view.state.selection.main.head, view.state.selection.main.head)!
    expect(removeLinkTarget(view, target)).toBe(true)
    expect(view.state.doc.toString()).toBe("这是 已有链接 结尾")
    view.destroy()
  })

  it("rejects invalid labels and urls", () => {
    const view = createView("普通文字", 2)
    expect(applyLinkTarget(view, null, "带]括号", "https://example.com")).toBe(false)
    expect(applyLinkTarget(view, null, "文字", "  ")).toBe(false)
    expect(applyLinkTarget(view, null, "文字", "https://example.com/<x>")).toBe(false)
    expect(view.state.doc.toString()).toBe("普通文字")
    view.destroy()
  })

  it("sanitizes spaces and parentheses in urls", () => {
    expect(sanitizeLinkUrl(" https://example.com/a (b) ")).toBe("https://example.com/a%20%28b%29")
  })
})

// 尖括号写法（[文字](<地址>)，允许地址带空格）与 title 段（[文字](地址 "提示")）是合法 Markdown，
// 面板不暴露这两个细节，但编辑保存必须原样补回，否则编辑一次链接就丢掉写法或提示。
describe("bracketed urls and titles survive a panel edit", () => {
  it("unwraps the angle brackets when reading and restores them when saving", () => {
    const doc = "这是 [文字](<https://example.com/a b>) 结尾"
    const view = createView(doc, doc.indexOf("文字"))
    const target = linkTargetAt(view.state, view.state.selection.main.head, view.state.selection.main.head)!
    expect(target.url).toBe("https://example.com/a b")
    expect(target.bracketed).toBe(true)
    expect(applyLinkTarget(view, target, "新文字", "https://example.com/c d")).toBe(true)
    expect(view.state.doc.toString()).toBe("这是 [新文字](<https://example.com/c d>) 结尾")
    view.destroy()
  })

  it("keeps the title when only the label and url are edited", () => {
    const doc = "这是 [文字](https://example.com \"提示\") 结尾"
    const view = createView(doc, doc.indexOf("文字"))
    const target = linkTargetAt(view.state, view.state.selection.main.head, view.state.selection.main.head)!
    expect(target.title).toBe("\"提示\"")
    expect(target.url).toBe("https://example.com")
    expect(applyLinkTarget(view, target, "新文字", "https://new.example.com")).toBe(true)
    expect(view.state.doc.toString()).toBe("这是 [新文字](https://new.example.com \"提示\") 结尾")
    view.destroy()
  })

  it("keeps both on a bracketed url with a title", () => {
    const doc = "[文字](<https://example.com/a b> \"提 示\")"
    const view = createView(doc, 2)
    const target = linkTargetAt(view.state, 2, 2)!
    expect(target).toMatchObject({ bracketed: true, title: "\"提 示\"", url: "https://example.com/a b" })
    expect(applyLinkTarget(view, target, "改名", "https://example.com/x")).toBe(true)
    expect(view.state.doc.toString()).toBe("[改名](<https://example.com/x> \"提 示\")")
    view.destroy()
  })

  it("removeLinkTarget drops the brackets and title along with the link", () => {
    const doc = "这是 [文字](<https://example.com> \"提示\") 结尾"
    const view = createView(doc, doc.indexOf("文字"))
    const target = linkTargetAt(view.state, view.state.selection.main.head, view.state.selection.main.head)!
    expect(removeLinkTarget(view, target)).toBe(true)
    expect(view.state.doc.toString()).toBe("这是 文字 结尾")
    view.destroy()
  })
})

// 单元格 textarea 是纯文本、没有语法树，链接结构用正则从文本里取；与 linkTargetAt 同构，
// 覆盖选区/光标的第一个链接就是目标，覆盖不到就新建。
describe("linkTargetInText", () => {
  it("finds the link covering the selection in plain text", () => {
    const text = "前缀 [文字](https://example.com) 后缀 [二](https://two.example.com)"
    const from = text.indexOf("文字")
    expect(linkTargetInText(text, from, from + 2)).toEqual({
      from: text.indexOf("[文字]"),
      label: "文字",
      source: "[文字](https://example.com)",
      to: text.indexOf(") 后缀") + 1,
      url: "https://example.com",
    })
  })

  it("parses bracketed urls and titles the same way as the syntax-tree path", () => {
    const text = "[文字](<https://example.com/a b> \"提 示\")"
    expect(linkTargetInText(text, 2, 2)).toMatchObject({
      bracketed: true,
      label: "文字",
      source: text,
      title: "\"提 示\"",
      url: "https://example.com/a b",
    })
  })

  it("returns null when the cursor is outside any link", () => {
    const text = "前缀 [文字](https://example.com) 后缀"
    expect(linkTargetInText(text, 0, 1)).toBeNull()
    expect(linkTargetInText(text, text.length, text.length)).toBeNull()
  })

  // 与正文同一份解析器：URL 里的平衡括号合法，图片与行内代码不是可编辑的链接。
  it("recognizes urls with balanced parens, and ignores images and inline code", () => {
    const parens = "[文档](https://example.com/a_(b))"
    expect(linkTargetInText(parens, 2, 2)).toMatchObject({
      label: "文档",
      source: parens,
      url: "https://example.com/a_(b)",
    })
    const image = "![图片](https://example.com/a.png)"
    expect(linkTargetInText(image, 3, 3)).toBeNull()
    const code = "`[示例](https://example.com)`"
    expect(linkTargetInText(code, 4, 4)).toBeNull()
  })
})

// 回车续写由官方命令 insertNewlineContinueMarkup 提供，markdownInputEnhancements 把它绑在
// Prec.high 的 Enter 上。这里锁定引用块场景：曾怀疑「引用块回车不接 >」，实测是自动化里
// End 键没落到行尾、光标停在空行导致的误判，命令本身工作正常。留几条用例防将来回归。
describe("Enter continues blockquote / list markup", () => {
  it("continues the quote marker when Enter is pressed at the end of a quote line", () => {
    const view = createView("> 引用一", 5)
    press(view, "Enter")
    expect(view.state.doc.toString()).toBe("> 引用一\n> ")
    view.destroy()
  })

  it("keeps both halves quoted when Enter splits a quote line in the middle", () => {
    const view = createView("> 引用一", 3) // 光标落在「> 引」之后
    press(view, "Enter")
    expect(view.state.doc.toString()).toBe("> 引\n> 用一")
    view.destroy()
  })

  it("continues the quote marker from the last line of a multi-line quote", () => {
    const doc = "> 第一行\n> 第二行"
    const view = createView(doc, doc.length)
    press(view, "Enter")
    expect(view.state.doc.toString()).toBe("> 第一行\n> 第二行\n> ")
    view.destroy()
  })

  it("continues a bullet list marker for comparison", () => {
    const view = createView("- 要点一", 5)
    press(view, "Enter")
    expect(view.state.doc.toString()).toBe("- 要点一\n- ")
    view.destroy()
  })
})

describe("toolbar block formatting", () => {
  it("formats the whole current line, keeps the cursor, and toggles back", () => {
    const view = createView("记录今天的想法", 4)
    toggleBlockFormat(view, "\n## ")
    expect(view.state.doc.toString()).toBe("## 记录今天的想法")
    expect(view.state.selection.main.head).toBe(7)
    toggleBlockFormat(view, "\n## ")
    expect(view.state.doc.toString()).toBe("记录今天的想法")
    expect(view.state.selection.main.head).toBe(4)
    view.destroy()
  })

  it("changes heading level without stacking markers", () => {
    const view = createView("### 标题", 5)
    toggleBlockFormat(view, "\n# ")
    expect(view.state.doc.toString()).toBe("# 标题")
    view.destroy()
  })

  it("excludes the next line at a selection boundary and undoes in one step", () => {
    const original = "第一行\n第二行\n第三行"
    const view = createView(original, 0, 8)
    toggleBlockFormat(view, "\n- ")
    expect(view.state.doc.toString()).toBe("- 第一行\n- 第二行\n第三行")
    undo(view)
    expect(view.state.doc.toString()).toBe(original)
    view.destroy()
  })

  it("keeps blank lines, indentation, and completed tasks in a mixed selection", () => {
    const doc = "  - [x] 完成\n\n  - 待办"
    const view = createView(doc, doc.length, 0)
    toggleBlockFormat(view, "\n- [ ] ")
    expect(view.state.doc.toString()).toBe("  - [x] 完成\n\n  - [ ] 待办")
    expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head)
    view.destroy()
  })

  it("leaves fenced code and table contents intact", () => {
    for (const doc of ["```js\nconst a = 1\n```", "| A | B |\n| --- | --- |\n| 1 | 2 | "]) {
      const view = createView(doc, 0, doc.length)
      toggleBlockFormat(view, "\n## ")
      expect(view.state.doc.toString()).toBe(doc)
      view.destroy()
    }
  })
})

describe("detectFormatState（工具栏高亮）", () => {
  it("光标落在加粗里时 strong 激活，且不误报斜体", () => {
    const view = createView("**加粗** 普通", 3)
    const state = detectFormatState(view.state)
    expect(state.strong).toBe(true)
    expect(state.emphasis).toBe(false)
    expect(state.strike).toBe(false)
    view.destroy()
  })

  it("选区覆盖完整标记（含标记本身）也算激活", () => {
    const view = createView("**加粗** 普通", 0, 6)
    expect(detectFormatState(view.state).strong).toBe(true)
    view.destroy()
  })

  it("混合格式选区（只有一部分加粗）视为未激活", () => {
    const doc = "**加粗** 普通"
    const view = createView(doc, 0, doc.length)
    expect(detectFormatState(view.state).strong).toBe(false)
    view.destroy()
  })

  it("斜体与删除线分别识别", () => {
    const emphasis = createView("*斜体*", 2)
    expect(detectFormatState(emphasis.state).emphasis).toBe(true)
    emphasis.destroy()
    const strike = createView("~~删除~~", 3)
    expect(detectFormatState(strike.state).strike).toBe(true)
    strike.destroy()
  })

  it("光标所在行的 ATX 标题级别会被报告", () => {
    const view = createView("## 标题", 4)
    expect(detectFormatState(view.state).heading).toBe(2)
    view.destroy()
    const plain = createView("普通段落", 2)
    expect(detectFormatState(plain.state).heading).toBe(0)
    plain.destroy()
  })

  it("跨行选区要求每一行都是同级标题，否则不报标题", () => {
    const same = "## 一\n\n## 二"
    const sameView = createView(same, 0, same.length)
    expect(detectFormatState(sameView.state).heading).toBe(2)
    sameView.destroy()
    const mixed = "# 一\n\n## 二"
    const mixedView = createView(mixed, 0, mixed.length)
    expect(detectFormatState(mixedView.state).heading).toBe(0)
    mixedView.destroy()
  })

  it("代码块里的 # 行不算标题", () => {
    const doc = "```\n# 注释\n```"
    const view = createView(doc, 6)
    expect(detectFormatState(view.state).heading).toBe(0)
    view.destroy()
  })
})
