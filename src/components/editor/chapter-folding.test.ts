import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { expect, it } from "vitest"
import { chapterRange, markdownHeadings } from "./chapter-folding"
it("章节包含子标题但不吞后续同级标题，代码中的伪标题不参与折叠", () => {
  const doc = "# 第一章\n正文\n## 子节\n```\n# 伪标题\n```\n# 第二章\n末尾"
  const state = EditorState.create({ doc, extensions: [markdown()] })
  expect(markdownHeadings(state).map((heading) => heading.level)).toEqual([1, 2, 1])
  expect(chapterRange(state, 0)).toEqual({ from: 5, to: doc.indexOf("# 第二章") - 1 })
  expect(chapterRange(state, doc.indexOf("# 第二章"))).toEqual({ from: doc.indexOf("# 第二章") + 5, to: doc.length })
})
