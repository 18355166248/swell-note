import { describe, expect, it } from "vitest"

import { buildNotePreview, buildNoteSearchSnippet } from "@/services/markdown/note-preview"

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

describe("buildNotePreview 去除 Markdown 标记", () => {
  it("摘要里不再出现强调、代码与链接的标记", () => {
    const preview = buildNotePreview([
      "# 一级标题",
      "",
      "这一段有 **加粗**、*斜体*、~~删除线~~ 和 `行内代码`。",
      "",
      "还有 [外链](https://example.com)、[[双链]]、[[目标|别名]] 与 ![图](a.png)。",
    ].join("\n"))

    expect(preview).toContain("一级标题")
    expect(preview).toContain("加粗")
    expect(preview).toContain("行内代码")
    expect(preview).toContain("外链")
    expect(preview).toContain("双链")
    expect(preview).toContain("别名")
    for (const marker of ["**", "~~", "`", "](", "[[", "!["]) {
      expect(preview).not.toContain(marker)
    }
  })

  it("列表、引用与表格分隔行只留正文", () => {
    const preview = buildNotePreview([
      "> 引用一句",
      "",
      "- [ ] 待办事项",
      "- 普通列表项",
      "",
      "| 列 A | 列 B |",
      "| --- | --- |",
      "| 甲 | 乙 |",
    ].join("\n"))

    expect(preview).toContain("引用一句")
    expect(preview).toContain("待办事项")
    expect(preview).toContain("普通列表项")
    expect(preview).not.toContain("- [ ]")
    expect(preview).not.toContain("---")
    expect(preview.startsWith(">")).toBe(false)
  })
})

describe("buildNoteSearchSnippet", () => {
  it("摘取命中词附近的正文，并在截断处加省略号", () => {
    const filler = "内容填充。".repeat(30)
    const content = `${filler}这里藏着关键词要点四，前后还有更多内容。${filler}`

    const snippet = buildNoteSearchSnippet(content, "要点四")

    expect(snippet).not.toBeNull()
    expect(snippet).toContain("要点四")
    expect(snippet?.startsWith("…")).toBe(true)
    expect(snippet?.endsWith("…")).toBe(true)
  })

  it("命中在开头或结尾时不加多余的省略号", () => {
    expect(buildNoteSearchSnippet("要点四开头的正文", "要点四")?.startsWith("…")).toBe(false)
    expect(buildNoteSearchSnippet("正文结尾是要点四", "要点四")?.endsWith("…")).toBe(false)
  })

  it("query 为空或没有命中时返回 null", () => {
    expect(buildNoteSearchSnippet("随便什么正文", "")).toBeNull()
    expect(buildNoteSearchSnippet("随便什么正文", "找不到")).toBeNull()
  })

  it("片段不包含 Markdown 标记", () => {
    const snippet = buildNoteSearchSnippet("这是 **加粗的要点四** 内容", "要点四")
    expect(snippet).toContain("要点四")
    expect(snippet).not.toContain("**")
  })

  it("Canvas 笔记不生成片段", () => {
    expect(buildNoteSearchSnippet('{"nodes":[{"text":"要点四"}]}', "要点四", "canvas")).toBeNull()
  })
})
