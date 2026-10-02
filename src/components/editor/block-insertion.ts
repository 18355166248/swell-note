import { isolateHistory } from "@codemirror/commands"
import { EditorView } from "@codemirror/view"

export const INSERTABLE_BLOCKS = [
  { id: "math", label: "公式", keywords: "math equation 公式", syntax: "\n$$\nx^2 + y^2 = z^2\n$$\n" },
  { id: "mermaid", label: "Mermaid 图表", keywords: "mermaid diagram 图表 流程图", syntax: "\n```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```\n" },
  { id: "callout", label: "提示块", keywords: "callout note 提示块", syntax: "\n> [!note] 提示\n> 在这里写提示内容\n" },
  { id: "footnote", label: "脚注", keywords: "footnote 脚注", syntax: "\n[^note]\n" },
  { id: "meeting", label: "会议模板", keywords: "meeting template 会议模板", syntax: "\n## 会议记录\n" },
  { id: "daily", label: "日记模板", keywords: "daily diary template 日记模板", syntax: "\n## 日记\n" },
] as const
export type InsertableBlockId = typeof INSERTABLE_BLOCKS[number]["id"]

export function localDateLabel(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function buildBlockInsertion(id: InsertableBlockId, selected = "", document = "", now = new Date()) {
  let content: string, focus: string
  if (id === "math") { focus = selected || "x^2 + y^2 = z^2"; content = `$$\n${focus}\n$$` }
  else if (id === "mermaid") { focus = selected || "flowchart TD\n  A[开始] --> B[结束]"; content = `\`\`\`mermaid\n${focus}\n\`\`\`` }
  else if (id === "callout") { const body = selected || "在这里写提示内容"; focus = body.split("\n").find((line) => line.trim()) || "提示"; content = `> [!note] 提示\n${body.split("\n").map((line) => `> ${line}`).join("\n")}` }
  else if (id === "meeting") { focus = "会议主题"; content = `## ${focus}\n\n日期：${localDateLabel(now)}\n\n### 讨论内容\n\n${selected}\n\n### 决策\n\n- \n\n### 后续行动\n\n- [ ] ` }
  else if (id === "daily") { focus = "今天的记录"; content = `## ${localDateLabel(now)} 日记\n\n### ${focus}\n\n${selected}\n\n### 今日待办\n\n- [ ] ` }
  else {
    // 引用和定义都参与查重，避免给已有脚注添加第二份同名定义。
    let number = 1
    while (document.includes(`[^note-${number}]`)) number++
    const marker = `[^note-${number}]`
    return { content: marker, focus: "脚注内容", definition: `${marker}: 脚注内容` }
  }
  return { content, focus, definition: undefined }
}

function focusInsertedBlock(view: EditorView, from: number, id: InsertableBlockId) {
  if (!["math", "mermaid", "callout"].includes(id)) return
  const document = view.state.doc, selection = view.state.selection
  // Widget 渲染后才有编辑入口；期间切笔记、继续输入或主动换焦点就不再接管。
  const observer = new MutationObserver(open)
  function open() {
    if (!view.dom.isConnected || view.state.readOnly || view.state.doc !== document || !view.state.selection.eq(selection) || !view.hasFocus) { observer.disconnect(); return }
    const widget = view.contentDOM.querySelector<HTMLElement>(`[data-block-from="${from}"]`)
    const button = widget?.querySelector<HTMLButtonElement>(id === "callout" ? '.cm-md-compat-edit' : '.cm-md-rich-edit')
    if (button) { observer.disconnect(); button.click() }
  }
  observer.observe(view.contentDOM, { childList: true, subtree: true })
  requestAnimationFrame(open)
  // 源码模式没有 Widget，限定观察寿命，避免观察器跟着后续编辑一直存活。
  window.setTimeout(() => observer.disconnect(), 1000)
}

export function insertBlock(view: EditorView, id: InsertableBlockId, range?: { from: number; to: number }) {
  if (view.state.readOnly || view.composing) return false
  const selection = view.state.selection.main
  const from = range?.from ?? selection.from, to = range?.to ?? selection.to
  const text = view.state.doc.toString()
  const plan = buildBlockInsertion(id, range ? "" : view.state.sliceDoc(from, to), text)
  if (plan.definition) {
    const marker = plan.content, definition = `\n\n${plan.definition}\n`
    const referenceFrom = range ? from : to
    const removeTo = range ? to : referenceFrom
    const bodyFrom = text.length - (removeTo - referenceFrom) + marker.length + definition.indexOf(plan.focus)
    const changes = removeTo === text.length
      ? [{ from: referenceFrom, to: removeTo, insert: marker + definition }]
      : [{ from: referenceFrom, to: removeTo, insert: marker }, { from: text.length, insert: definition }]
    view.dispatch({ changes, selection: { anchor: bodyFrom, head: bodyFrom + plan.focus.length }, annotations: isolateHistory.of("full"), userEvent: "input.block", scrollIntoView: true })
  } else {
    const prefix = from ? "\n\n" : "", suffix = "\n\n"
    const content = prefix + plan.content + suffix
    const focusFrom = from + prefix.length + plan.content.indexOf(plan.focus)
    view.dispatch({ changes: { from, to, insert: content }, selection: { anchor: focusFrom, head: focusFrom + plan.focus.length }, annotations: isolateHistory.of("full"), userEvent: "input.block", scrollIntoView: true })
    view.focus()
    focusInsertedBlock(view, from + prefix.length, id)
  }
  view.focus()
  return true
}

export function insertNoteTemplate(view: EditorView, body: string) {
  if (view.state.readOnly || view.composing || !body.trim()) return false
  const selection = view.state.selection.main
  const text = body.split("{{date}}").join(localDateLabel())
  const cursor = text.indexOf("{{cursor}}")
  const content = text.split("{{cursor}}").join("")
  const prefix = selection.from ? "\n\n" : ""
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert: prefix + content + "\n\n" }, selection: { anchor: selection.from + prefix.length + (cursor >= 0 ? cursor : content.length) }, annotations: isolateHistory.of("full"), userEvent: "input.template", scrollIntoView: true })
  view.focus()
  return true
}
