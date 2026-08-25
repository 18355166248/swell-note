// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { DecorationSet, EditorView } from "@codemirror/view"
import { describe, expect, it } from "vitest"

import { markdownLivePreview, TaskCheckboxWidget } from "./live-preview"

const doc = [
  "# 标题",
  "",
  "**加粗**正文",
  "",
  "- [ ] 待办",
  "- [x] 完成",
  "",
  "> 引用",
].join("\n")

function createView(selection?: { anchor: number }) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), markdownLivePreview],
      selection,
    }),
  })
}

async function settleDecorations(view: EditorView): Promise<DecorationSet> {
  // 语法解析由 CM 后台异步推进，短暂等待后插件已完成首屏装饰。
  await new Promise((resolve) => setTimeout(resolve, 20))
  const decorations = view.plugin(markdownLivePreview)?.decorations
  view.destroy()
  expect(decorations).toBeDefined()
  return decorations!
}

type DecorationSpec = { class?: string; widget?: unknown }

function collect(decorations: DecorationSet) {
  const classes: string[] = []
  const hidden: Array<{ from: number; to: number }> = []
  const checkboxes: Array<{ checked: boolean; from: number }> = []
  const cursor = decorations.iter()
  while (cursor.value) {
    const spec = (cursor.value.spec ?? {}) as DecorationSpec
    if (spec.class) classes.push(...spec.class.split(" "))
    if (!spec.class && !spec.widget && cursor.from < cursor.to) hidden.push({ from: cursor.from, to: cursor.to })
    if (spec.widget instanceof TaskCheckboxWidget) checkboxes.push({ checked: spec.widget.checked, from: spec.widget.from })
    cursor.next()
  }
  return { checkboxes, classes, hidden }
}

describe("markdown live preview", () => {
  it("styles headings, quotes and hides inline marks away from the cursor", async () => {
    const view = createView({ anchor: 0 })
    const { checkboxes, classes, hidden } = collect(await settleDecorations(view))

    expect(classes).toContain("cm-md-h1")
    expect(classes).toContain("cm-md-strong")
    expect(classes).toContain("cm-md-quote")
    expect(hidden).toContainEqual({ from: doc.indexOf("**"), to: doc.indexOf("**") + 2 })
    expect(hidden).not.toContainEqual({ from: 0, to: 1 })
    expect(checkboxes).toEqual([
      { checked: false, from: doc.indexOf("[ ]") },
      { checked: true, from: doc.indexOf("[x]") },
    ])
  })

  it("reveals raw syntax on the cursor line", async () => {
    const boldLine = doc.indexOf("**加粗**")
    const view = createView({ anchor: boldLine + 3 })
    const { hidden } = collect(await settleDecorations(view))

    expect(hidden).not.toContainEqual({ from: boldLine, to: boldLine + 2 })
  })
})
