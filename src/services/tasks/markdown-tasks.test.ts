import { describe, expect, it } from "vitest"

import { extractMarkdownTasks, resolveQuickTaskTarget, setMarkdownTaskChecked } from "./markdown-tasks"
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

describe("resolveQuickTaskTarget", () => {
  const candidate = (patch: Partial<Note>): Note => ({ ...note("正文"), id: "n", ...patch })
  const excalidraw = "---\nexcalidraw-plugin: parsed\n---\n\n# Excalidraw Data\n\n## Drawing\n"

  it("优先写入当前打开的可编辑 Markdown 笔记", () => {
    const active = candidate({ id: "active", title: "当前" })
    const other = candidate({ id: "other", title: "其他" })

    expect(resolveQuickTaskTarget(active, [other, active])?.id).toBe("active")
  })

  it("当前笔记是 Excalidraw 画布时改写入其他 Markdown 笔记", () => {
    const drawing = candidate({ content: excalidraw, id: "drawing" })
    const markdown = candidate({ id: "markdown" })

    expect(resolveQuickTaskTarget(drawing, [drawing, markdown])?.id).toBe("markdown")
  })

  it("跳过 Canvas、只读、待删除与正文未加载的笔记", () => {
    const notes = [
      candidate({ format: "canvas", id: "canvas" }),
      candidate({ id: "readonly", readOnly: true }),
      candidate({ id: "deleting", pendingOperation: "delete" }),
      candidate({ contentLoaded: false, id: "unloaded" }),
      candidate({ id: "usable" }),
    ]

    expect(resolveQuickTaskTarget(null, notes)?.id).toBe("usable")
  })

  it("没有可写入的笔记时返回 null", () => {
    expect(resolveQuickTaskTarget(null, [candidate({ content: excalidraw })])).toBeNull()
  })
})
