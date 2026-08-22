import { describe, expect, it } from "vitest"

import { extractMarkdownTasks, setMarkdownTaskChecked } from "./markdown-tasks"
import type { Note } from "@/types/note"

const note = (content: string, contentLoaded = true): Note => ({
  content,
  contentLoaded,
  id: "note-1",
  preview: "",
  starred: false,
  title: "项目计划",
  updatedAt: "刚刚",
})

describe("extractMarkdownTasks", () => {
  it("聚合 Markdown 未完成与已完成任务", () => {
    expect(extractMarkdownTasks([note("- [ ] 完成路由\n* [x] 完成缓存\n普通列表")])).toEqual([
      expect.objectContaining({ checked: false, line: 1, text: "完成路由" }),
      expect.objectContaining({ checked: true, line: 2, text: "完成缓存" }),
    ])
  })

  it("不从尚未读取正文的笔记中生成任务", () => {
    expect(extractMarkdownTasks([note("- [ ] 不应展示", false)])).toEqual([])
  })

  it("按来源行切换任务状态且保留其余 Markdown", () => {
    const content = "# 计划\n- [ ] 完成路由\n正文"
    expect(setMarkdownTaskChecked(content, 2, true)).toBe("# 计划\n- [x] 完成路由\n正文")
    expect(() => setMarkdownTaskChecked(content, 3, true)).toThrow("来源已经变化")
  })
})
