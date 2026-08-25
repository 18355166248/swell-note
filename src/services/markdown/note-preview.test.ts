import { describe, expect, it } from "vitest"

import { buildNotePreview } from "@/services/markdown/note-preview"

describe("buildNotePreview", () => {
  it("剥离 YAML frontmatter，不把元数据当正文", () => {
    const content = "---\ntitle: 项目说明\ntags: [文档, 入口]\n---\n\n# Swell Note\n\n本地优先的跨端笔记。"

    expect(buildNotePreview(content)).toBe("Swell Note 本地优先的跨端笔记。")
  })

  it("折叠换行与多余空白", () => {
    expect(buildNotePreview("# 标题\n\n\n第一段\n第二段")).toBe("标题 第一段 第二段")
  })

  it("截断到 90 个字符", () => {
    expect(buildNotePreview("正".repeat(200))).toHaveLength(90)
  })

  it("Excalidraw 文档使用画布文本而不是原始 Markdown", () => {
    const content = [
      "---", "excalidraw-plugin: parsed", "---", "",
      "# Excalidraw Data", "", "## Text Elements",
      "需求评审 ^t1", "", "技术方案 ^t2", "",
      "## Drawing", "```json", "{\"type\":\"excalidraw\",\"elements\":[]}", "```", "%%",
    ].join("\n")

    expect(buildNotePreview(content)).toBe("需求评审 · 技术方案")
  })

  it("没有文本元素的画布回退到类型说明", () => {
    const content = "---\nexcalidraw-plugin: parsed\n---\n\n# Excalidraw Data\n\n## Drawing\n"

    expect(buildNotePreview(content)).toBe("Excalidraw 画布")
  })

  it("Canvas 文件汇总节点文本与引用文件名，而不是原始 JSON", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "n1", text: "## 同步链路\n\n本地工作副本", type: "text" },
        { id: "n2", file: "Excalidraw/流程草图.excalidraw.md", type: "file" },
      ],
    })

    expect(buildNotePreview(content, "canvas")).toBe("同步链路 本地工作副本 · 流程草图.excalidraw.md")
  })

  it("损坏的 Canvas JSON 回退到类型说明", () => {
    expect(buildNotePreview("{ 不是 JSON", "canvas")).toBe("Canvas 画布")
  })

  it("Canvas 内容是合法 JSON 但不是对象时不抛异常", () => {
    expect(buildNotePreview("null", "canvas")).toBe("Canvas 画布")
    expect(buildNotePreview("123", "canvas")).toBe("Canvas 画布")
    expect(buildNotePreview('{"nodes":null}', "canvas")).toBe("Canvas 画布")
  })

  it("超长正文只扫描开头，不因大量分隔线退化", () => {
    // 每次按键都会重算摘要。截断前该文档约 19ms/次（isExcalidrawMarkdown 全文回溯），
    // 截断后约 0.1ms/次；阈值取 5ms 既能捕捉 O(n²) 回归，也不会在慢机器上误报。
    const heavy = "---\ntitle: t\n---\n\n正文开头。\n\n" + "段落。\n\n---\n\n".repeat(4000)
    const started = performance.now()
    const preview = buildNotePreview(heavy)

    expect(preview.startsWith("正文开头。")).toBe(true)
    expect(performance.now() - started).toBeLessThan(5)
  })

  it("空白正文返回空摘要", () => {
    expect(buildNotePreview("---\ntitle: 仅有元数据\n---\n")).toBe("")
  })
})
