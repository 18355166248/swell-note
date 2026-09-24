import { describe, expect, it } from "vitest"

import { extractFrontmatter } from "@/services/search/note-index"
import { parseEditableTags, renameNoteTag, setNoteTags } from "./note-tags"

describe("note tags", () => {
  it("adds tags to an ordinary Markdown note", () => {
    const content = setNoteTags("# 正文\n", ["工作", "待办"])
    expect(content).toBe('---\ntags: ["工作", "待办"]\n---\n\n# 正文\n')
    expect(extractFrontmatter(content).tags).toEqual(["工作", "待办"])
  })

  it("replaces block tags while preserving unrelated frontmatter and CRLF", () => {
    const original = "---\r\ntitle: 示例\r\ntags:\r\n  - 旧标签\r\nauthor: 张三\r\n---\r\n\r\n正文"
    const updated = setNoteTags(original, ["新标签"])
    expect(updated).toBe('---\r\ntitle: 示例\r\ntags: ["新标签"]\r\nauthor: 张三\r\n---\r\n\r\n正文')
    expect(extractFrontmatter(updated).tags).toEqual(["新标签"])
  })

  it("does not leave orphaned list entries after comments or blank lines", () => {
    const source = "---\ntags:\n  - old\n\n  - older\nauthor: A\n---\n正文"
    expect(setNoteTags(source, ["new"])).toBe('---\ntags: ["new"]\nauthor: A\n---\n正文')
  })

  it("removes only the tag field, and drops empty frontmatter", () => {
    expect(setNoteTags("---\ntags: [old]\nauthor: A\n---\n正文", []))
      .toBe("---\nauthor: A\n---\n正文")
    expect(setNoteTags("---\ntags: [old]\n---\n\n正文", [])).toBe("正文")
  })

  it("leaves the source untouched when tags do not change", () => {
    const source = "---\ntags:\n  - 工作\n---\n正文"
    expect(setNoteTags(source, ["工作"])).toBe(source)
  })

  it("parses unique labels and rejects characters unsafe for the frontmatter format", () => {
    expect(parseEditableTags("#工作, 待办，工作")).toEqual(["工作", "待办"])
    expect(() => parseEditableTags('ok, bad"tag')).toThrow("不支持")
  })

  it("renames one tag across a Markdown document without duplicating an existing target", () => {
    const source = "---\ntitle: 示例\ntags: [旧标签, 新标签]\nauthor: 张三\n---\n正文"
    expect(renameNoteTag(source, "旧标签", "新标签"))
      .toBe('---\ntitle: 示例\ntags: ["新标签"]\nauthor: 张三\n---\n正文')
    expect(renameNoteTag(source, "不存在", "新标签")).toBe(source)
  })
})
