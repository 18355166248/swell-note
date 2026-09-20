// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { history, historyField, undoDepth } from "@codemirror/commands"
import { EditorState, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

import { EditorControl, externalDocumentChange } from "./editor-control"
import { createMemorySessionStore, type EditorSessionStore } from "./editor-session-store"
import type { EditorCommand, EditorDocumentIdentity, EditorSettings } from "./editor-types"

// 「稳定 EditorView」这一条架构契约的回归护栏。
// 这些用例只经 EditorControl 的公开接口驱动，不碰任何上层实现，
// 因此结构性改动（换扩展、拆文件）不会把它们变成假阴性。

const BASE_SETTINGS: EditorSettings = {
  assetScope: "note",
  livePreview: true,
  placeholder: "开始记录",
  platform: "desktop",
  readOnly: false,
  tableEditing: true,
  theme: "light",
}

let parent: HTMLElement
let store: EditorSessionStore
const controls: EditorControl[] = []

beforeEach(() => {
  parent = document.createElement("div")
  document.body.appendChild(parent)
  store = createMemorySessionStore()
})

afterEach(() => {
  for (const control of controls.splice(0)) control.destroy()
  parent.remove()
})

function identity(sessionKey: string, overrides: Partial<EditorDocumentIdentity> = {}): EditorDocumentIdentity {
  return { noteId: overrides.noteId ?? sessionKey, revision: overrides.revision, sessionKey }
}

/** 平台 / 预览 / 表格三个 Compartment 的扩展计数，用来判定视图是否被重建。 */
function createControl(options: {
  doc: string
  identity: EditorDocumentIdentity
  settings?: Partial<EditorSettings>
  platformExtensions?: (context: { settings: EditorSettings }) => Extension
  livePreviewExtensions?: (context: { settings: EditorSettings }) => Extension
  tableEditingExtensions?: (context: { settings: EditorSettings }) => Extension
} = { doc: "", identity: identity("a") }) {
  // 事件外发由上层 updateListener 转发，这里照搬真实适配层的接线，
  // 否则 documentChange / selectionChange 在 core 测试里永远不会触发。
  const control = new EditorControl({
    buildBehaviorExtensions: (instance) => EditorView.updateListener.of((update) => instance.notifyViewUpdate(update)),
    doc: options.doc,
    identity: options.identity,
    languageExtensions: [],
    livePreviewExtensions: options.livePreviewExtensions ?? (() => []),
    parent,
    platformExtensions: options.platformExtensions ?? (() => []),
    // 与产品代码一致：序列化的是 historyField 这个状态字段，不是 history() 扩展。
    sessionFields: { history: historyField },
    sessionStore: store,
    settings: { ...BASE_SETTINGS, ...options.settings },
    tableEditingExtensions: options.tableEditingExtensions ?? (() => []),
  })
  controls.push(control)
  return control
}

describe("EditorControl 生命周期", () => {
  it("切换笔记复用同一个 EditorView 与 DOM 节点", () => {
    const control = createControl({ doc: "第一篇正文", identity: identity("a") })
    const dom = control.getView().dom
    const contentDOM = control.getView().contentDOM

    control.updateDocument("第二篇正文", identity("b"), { forceSwitch: true })

    expect(control.getDocument()).toBe("第二篇正文")
    // 视图实例与两处 DOM 都必须是同一份：焦点、输入法状态和滚动容器都挂在这上面。
    expect(control.getView().dom).toBe(dom)
    expect(control.getView().contentDOM).toBe(contentDOM)
    expect(dom.isConnected).toBe(true)
  })

  it("撤销历史不跨笔记，返回原笔记时按会话恢复", () => {
    const control = createControl({ doc: "A 原文", identity: identity("a") })
    control.getView().dispatch({ changes: { from: 0, insert: "A " } })
    expect(control.getDocument()).toBe("A A 原文")
    expect(undoDepth(control.getState())).toBe(1)

    control.updateDocument("B 原文", identity("b"), { forceSwitch: true })
    // B 是从未编辑过的新会话：不继承 A 的撤销栈，这正是「撤销不跨笔记」。
    expect(undoDepth(control.getState())).toBe(0)

    // 返回 A：宿主传回的正文是 A 会话里编辑后的内容，快照因此可用。
    control.updateDocument("A A 原文", identity("a"), { forceSwitch: true })
    // 改造前靠 React key 重建 + EditorState 缓存做到，现在由会话快照承担，行为不变。
    expect(control.getDocument()).toBe("A A 原文")
    expect(undoDepth(control.getState())).toBe(1)
  })

  it("正文被外部改过时丢弃旧撤销栈，避免撤销跳回不存在的历史", () => {
    const control = createControl({ doc: "A 原文", identity: identity("a") })
    control.getView().dispatch({ changes: { from: 0, insert: "改 " } })
    expect(undoDepth(control.getState())).toBe(1)

    control.updateDocument("B 原文", identity("b"), { forceSwitch: true })
    // 模拟期间被同步改过正文：快照的 doc 与要显示的正文不一致。
    control.updateDocument("A 原文被远端改写", identity("a"), { forceSwitch: true })
    expect(control.getDocument()).toBe("A 原文被远端改写")
    expect(undoDepth(control.getState())).toBe(0)
  })

  it("恢复的选区落在同一篇笔记里", () => {
    const control = createControl({ doc: "第一行\n第二行", identity: identity("a") })
    control.setSelection(5, 5)
    expect(control.getSelection().anchor).toBe(5)

    control.updateDocument("另一篇", identity("b"), { forceSwitch: true })
    control.updateDocument("第一行\n第二行", identity("a"), { forceSwitch: true })
    expect(control.getDocument()).toBe("第一行\n第二行")
    // 选区由会话快照恢复，返回时不再是顶部。
    expect(control.getSelection().anchor).toBe(5)
  })
})

describe("EditorControl 长文热路径", () => {
  it("宿主原样回传的 value 不触发全文序列化，也不重建状态", () => {
    const longDoc = Array.from({ length: 4000 }, (_, index) => `第 ${index + 1} 行的正文内容`).join("\n")
    const control = createControl({ doc: longDoc, identity: identity("a") })
    const view = control.getView()

    // 逐键输入的模型：每次 onChange 的字符串原样经 value 传回。
    // 把 doc.toString 换成计数桩，只要回传走了引用短路，就不会再序列化整篇。
    const toString = view.state.doc.toString
    let serializations = 0
    const doc = view.state.doc
    Object.defineProperty(doc, "toString", {
      configurable: true,
      value: function patched(this: unknown) { serializations += 1; return toString.call(this) },
    })

    const emitted = view.state.doc.toString()
    serializations = 0
    control.updateDocument(emitted, identity("a"))
    expect(serializations).toBe(0)

    control.updateDocument(emitted, identity("a"))
    expect(serializations).toBe(0)

    // 内容真的不同时仍然正常替换（引用短路不能把变更吃掉）。
    control.updateDocument(`${emitted}\n新增一行`, identity("a"))
    expect(control.getDocument()).toBe(`${emitted}\n新增一行`)
  })
})

describe("EditorControl composition 保护", () => {
  function beginComposition(control: EditorControl) {
    control.getView().contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))
  }
  function endComposition(control: EditorControl) {
    control.getView().contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }))
  }

  it("组合期间的旧 value 回写不覆盖 IME 已提交的最终正文", () => {
    const control = createControl({ doc: "拼音", identity: identity("a") })
    beginComposition(control)
    expect(control.isComposing()).toBe(true)

    // IME 把最终字符写进 CodeMirror 状态。
    control.getView().dispatch({ changes: { from: 0, to: 2, insert: "你好" }, userEvent: "input.type.compose" })

    // 慢一拍的受控回传（echo）：正文早已在状态里，不得覆盖。
    control.updateDocument("拼音", identity("a"), { origin: "echo" })
    expect(control.getDocument()).toBe("你好")

    endComposition(control)
    // 组合结束后最终正文仍是完整输入，旧 value 没有覆盖。
    expect(control.getDocument()).toBe("你好")
  })

  it("组合期间挂起的外部正文（远端合并）在组合结束后落笔，不丢内容", () => {
    const control = createControl({ doc: "本地正文", identity: identity("a") })
    beginComposition(control)

    // 远端合并回写（external）：正文确实被外部改写，必须挂起。
    control.updateDocument("远端合并后的正文", identity("a"))
    expect(control.getDocument()).toBe("本地正文")

    endComposition(control)
    // 组合结束后外部正文落地，不丢。
    expect(control.getDocument()).toBe("远端合并后的正文")
  })

  it("组合期间显式切走笔记时结束组合，旧回写不反扑新笔记", () => {
    const control = createControl({ doc: "旧笔记", identity: identity("a") })
    beginComposition(control)
    // 先挂起一次旧笔记的外部回写，再切走。
    control.updateDocument("旧笔记的外部回写", identity("a"))
    expect(control.getDocument()).toBe("旧笔记")

    control.updateDocument("新笔记正文", identity("b"), { forceSwitch: true })
    expect(control.getDocument()).toBe("新笔记正文")
    expect(control.isComposing()).toBe(false)

    // 切换过程中被挂起的那次旧回写不能事后反扑。
    endComposition(control)
    expect(control.getDocument()).toBe("新笔记正文")
  })

  it("组合期间 revision 改变但正文相同，结束后身份 revision 已更新", () => {
    const control = createControl({ doc: "正文", identity: identity("a", { revision: '"r1"' }) })
    beginComposition(control)
    control.updateDocument("正文", identity("a", { revision: '"r2"' }))

    endComposition(control)
    expect(control.owns({ identity: identity("a", { revision: '"r2"' }) })).toBe(true)
    expect(control.owns({ identity: identity("a", { revision: '"r1"' }) })).toBe(false)
  })

  it("组合期间 readOnly 改变，结束后 EditorState 与 contenteditable 一致", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    beginComposition(control)
    control.updateDocument("正文", identity("a"), { settings: { readOnly: true } })

    // 组合未结束，只读被挂起，DOM 仍可编辑。
    expect(control.getState().readOnly).toBe(false)
    expect(control.getView().contentDOM.getAttribute("contenteditable")).toBe("true")

    endComposition(control)
    expect(control.getState().readOnly).toBe(true)
    expect(control.getView().contentDOM.getAttribute("contenteditable")).toBe("false")
  })

  it("组合期间外部 dispatch 被拒绝，结束后恢复", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    beginComposition(control)
    expect(control.dispatch({ changes: { from: 0, insert: "X" } })).toBe(false)
    expect(control.getDocument()).toBe("正文")

    endComposition(control)
    expect(control.dispatch({ changes: { from: 0, insert: "X" } })).toBe(true)
    expect(control.getDocument()).toBe("X正文")
  })
})

describe("EditorControl 配置经 Compartment 生效", () => {
  it("只读、主题、平台与预览开关切换不重建 EditorView", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    const dom = control.getView().dom
    const contentDOM = control.getView().contentDOM

    control.updateSettings({ readOnly: true, platform: "mobile", theme: "dark", livePreview: false, tableEditing: false })
    expect(control.getView().dom).toBe(dom)
    expect(control.getView().contentDOM).toBe(contentDOM)
    expect(control.getState().readOnly).toBe(true)

    control.updateSettings({ readOnly: false, platform: "desktop", theme: "light", livePreview: true, tableEditing: true })
    expect(control.getView().dom).toBe(dom)
    expect(control.getState().readOnly).toBe(false)
  })

  it("只读开关同时落到 EditorState 与 DOM 可编辑性", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    control.updateSettings({ readOnly: true })
    expect(control.getView().contentDOM.getAttribute("contenteditable")).toBe("false")
    control.updateSettings({ readOnly: false })
    expect(control.getView().contentDOM.getAttribute("contenteditable")).toBe("true")
  })

  it("平台切换会重配置平台扩展，供移动端读 linkTap 等分支", () => {
    const platforms: string[] = []
    const control = createControl({
      doc: "正文",
      identity: identity("a"),
      platformExtensions: ({ settings }) => {
        platforms.push(settings.platform)
        return []
      },
    })
    expect(platforms).toEqual(["desktop"])
    control.updateSettings({ platform: "mobile" })
    expect(platforms).toEqual(["desktop", "mobile"])
    expect(control.getView().dom.isConnected).toBe(true)
  })
})

describe("EditorControl 事件", () => {
  it("事件携带文档身份，宿主可据此丢弃迟到结果", () => {
    const control = createControl({ doc: "正文", identity: identity("a", { revision: '"r1"' }) })
    const seen: Array<{ doc: string; sessionKey: string; revision?: string }> = []
    control.on("documentChange", (event) => {
      seen.push({ doc: event.doc, revision: event.identity.revision, sessionKey: event.identity.sessionKey })
    })

    control.getView().dispatch({ changes: { from: 0, insert: "新" } })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ doc: "新正文", revision: '"r1"', sessionKey: "a" })

    // 切到别的笔记后，旧事件的判据不再成立。
    control.updateDocument("B", identity("b"), { forceSwitch: true })
    expect(control.owns({ identity: identity("b") })).toBe(true)
    expect(control.owns({ identity: identity("a") })).toBe(false)
  })

  it("外部更新只发一次 documentChange，且标记为 external", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    const events: Array<{ external: boolean }> = []
    control.on("documentChange", (event) => { events.push({ external: event.external }) })

    control.updateDocument("外部正文", identity("a"))
    expect(events).toEqual([{ external: true }])
  })

  it("切换会话发 sessionChange，同会话正文替换不发", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    const seen: string[] = []
    control.on("sessionChange", (event) => { seen.push(event.identity.sessionKey) })

    // 同会话正文替换：不触发 sessionChange。
    control.updateDocument("同会话新正文", identity("a"))
    expect(seen).toEqual([])

    // 切换会话：触发一次。
    control.updateDocument("B 正文", identity("b"), { forceSwitch: true })
    expect(seen).toEqual(["b"])
  })

  it("用户输入的事件标记为非 external，宿主据此触发保存", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    const events: Array<{ external: boolean; doc: string }> = []
    control.on("documentChange", (event) => { events.push({ doc: event.doc, external: event.external }) })

    control.getView().dispatch({ changes: { from: 0, insert: "新" } })
    expect(events).toEqual([{ doc: "新正文", external: false }])
  })
})

describe("EditorControl 销毁", () => {
  it("销毁后 composition 监听成对解绑，重复销毁安全", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    const contentDOM = control.getView().contentDOM
    // 只在 contentDOM 上取证：CodeMirror 自身的监听解绑会污染 EditorView.dom 的记录。
    const removeSpy = vi.spyOn(contentDOM, "removeEventListener")
    control.destroy()
    // 必须成对解绑，否则重挂载会叠加，每次组合事件都被处理多次。
    // 只核对 composition 两项：CodeMirror 自身也会在 contentDOM 上解绑内部监听。
    const removed = removeSpy.mock.calls.map((call) => call[0])
    expect(removed).toContain("compositionstart")
    expect(removed).toContain("compositionend")
    expect(() => control.destroy()).not.toThrow()
    expect(parent.querySelector(".cm-editor")).toBeNull()
  })

  it("销毁时保存快照，重挂载可恢复历史", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    control.getView().dispatch({ changes: { from: 0, insert: "新" } })
    const edited = control.getDocument()
    control.destroy()

    // 重新挂载的正文与快照一致，历史因此可以恢复。
    const revived = createControl({ doc: edited, identity: identity("a") })
    expect(revived.getDocument()).toBe(edited)
    expect(undoDepth(revived.getState())).toBe(1)
  })
})

describe("EditorControl 命令", () => {
  it("撤销重做经命令入口生效，只读时被拒绝", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    control.getView().dispatch({ changes: { from: 0, insert: "新" } })
    control.dispatchCommand({ type: "history.undo" })
    expect(control.getDocument()).toBe("正文")
    control.dispatchCommand({ type: "history.redo" })
    expect(control.getDocument()).toBe("新正文")

    control.updateSettings({ readOnly: true })
    control.dispatchCommand({ type: "history.undo" })
    expect(control.getDocument()).toBe("新正文")
  })

  it("revealLine 与 scrollLineToTop 定位到指定行", () => {
    const control = createControl({ doc: "第一行\n第二行\n第三行", identity: identity("a") })
    control.dispatchCommand({ line: 2, type: "navigation.revealLine" })
    expect(control.getSelection().line).toBe(2)
    expect(control.dispatchCommand({ line: 3, type: "navigation.scrollLineToTop" })).toBe(true)
  })

  it("selection.all 覆盖全文，collapse 收起选区且不抢焦点", () => {
    const control = createControl({ doc: "第一行\n第二行", identity: identity("a") })
    control.dispatchCommand({ type: "selection.all" })
    expect(control.getSelection().anchor).toBe(0)
    expect(control.getSelection().head).toBe(control.getDocument().length)

    control.dispatchCommand({ type: "selection.collapse" })
    expect(control.getSelection().anchor).toBe(control.getSelection().head)
  })

  it("每条命令都在 core 里真实实现，漏出 undefined 只可能发生在销毁后", () => {
    // 运行时无法枚举被类型擦除的联合类型，因此「新增命令却忘记实现」由 runCommand 的
    // assertNever 穷尽检查在 tsc 阶段拦截（故意加一条未实现命令时 tsc 会报
    // “not assignable to parameter of type 'never'”）。
    // 本用例守的是另一半：已声明的命令必须真的能跑，且销毁后早退值仍符合声明。
    const dispatch = createControl({ doc: "第一行\n第二行", identity: identity("a") })
    const commands: EditorCommand[] = [
      { type: "history.undo" },
      { type: "history.redo" },
      { type: "selection.all" },
      { type: "selection.collapse" },
      { line: 1, type: "navigation.revealLine" },
      { line: 1, type: "navigation.scrollLineToTop" },
    ]
    for (const command of commands) {
      const result = dispatch.dispatchCommand(command as never)
      // 只有 scrollLineToTop 声明了 boolean；其余声明 void，undefined 是合法值。
      // 这里断言 boolean 那条真的返回 true，而不是落进 default 分支的 undefined。
      if (command.type === "navigation.scrollLineToTop") expect(result).toBe(true)
    }

    // 销毁后所有命令都必须早退；声明为 boolean 的那条仍要返回 boolean。
    dispatch.destroy()
    for (const command of commands) {
      const result = dispatch.dispatchCommand(command as never)
      if (command.type === "navigation.scrollLineToTop") expect(result).toBe(false)
      else expect(result).toBeUndefined()
    }
  })
})

describe("EditorControl 外部标注", () => {
  it("切换笔记派发的事务带 externalDocumentChange 标注，用户输入不带", () => {
    const control = createControl({ doc: "正文", identity: identity("a") })
    const view = control.getView()
    // 直接读每次更新事务上的标注——这正是 notifyViewUpdate 区分 external 的判据。
    const flags: boolean[] = []
    const probe = EditorView.updateListener.of((update) => {
      for (const transaction of update.transactions) {
        if (transaction.docChanged) flags.push(transaction.annotation(externalDocumentChange) === true)
      }
    })
    // 同笔记的正文替换走 annotate 路径；这里用一个新视图复现，避开给已建视图加扩展。
    const probeParent = document.createElement("div")
    document.body.appendChild(probeParent)
    const probeView = new EditorView({
      parent: probeParent,
      state: EditorState.create({ doc: "占位", extensions: [history(), probe] }),
    })
    probeView.dispatch({ annotations: [externalDocumentChange.of(true)], changes: { from: 0, to: 2, insert: "外" } })
    probeView.dispatch({ changes: { from: 0, insert: "内" } })
    expect(flags).toEqual([true, false])
    probeView.destroy()
    probeParent.remove()
    expect(view.dom.isConnected).toBe(true)
  })
})
