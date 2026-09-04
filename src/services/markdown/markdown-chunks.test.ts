import { describe, expect, it } from "vitest"

import { splitMarkdownIntoChunks } from "./markdown-chunks"

// 切分必须无损：拼回来要和原文逐字符一致，行号也要对得上。
function assertLossless(source: string) {
  const chunks = splitMarkdownIntoChunks(source, { minChars: 40, threshold: 0 })
  expect(chunks.map((chunk) => chunk.text).join("\n")).toBe(source)
  const lines = source.split("\n")
  for (const chunk of chunks) {
    expect(chunk.text.split("\n")[0]).toBe(lines[chunk.startLine - 1])
  }
  return chunks
}

describe("splitMarkdownIntoChunks", () => {
  it("短笔记整篇渲染，不做切分", () => {
    const source = "# 标题\n\n正文一段。\n"
    expect(splitMarkdownIntoChunks(source)).toEqual([{ startLine: 1, text: source }])
  })

  it("长笔记按空行切成多段，并给出各段起始行号", () => {
    const source = Array.from({ length: 12 }, (_, index) => `## 小节 ${index + 1}\n\n第 ${index + 1} 段正文，写得长一点用来凑够切分阈值。\n`).join("\n")
    const chunks = assertLossless(source)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].startLine).toBe(1)
  })

  it("不在围栏代码块内部切开", () => {
    const code = Array.from({ length: 20 }, (_, index) => `const value${index} = ${index}`).join("\n\n")
    const source = `段落一，用来把长度顶过阈值，多写几个字。\n\n\`\`\`ts\n${code}\n\`\`\`\n\n段落二。\n`
    const chunks = assertLossless(source)
    const fenced = chunks.filter((chunk) => chunk.text.includes("```"))
    // 围栏的起止必须落在同一段里。
    expect(fenced).toHaveLength(1)
    expect(fenced[0].text.match(/```/g)).toHaveLength(2)
  })

  it("不切开松散列表，避免拆成两个列表", () => {
    const items = Array.from({ length: 20 }, (_, index) => `- 第 ${index + 1} 项，写长一点凑够阈值。`).join("\n\n")
    const chunks = assertLossless(`${items}\n`)
    expect(chunks).toHaveLength(1)
  })

  it("不切开缩进续行", () => {
    const blocks = Array.from({ length: 12 }, (_, index) => `- 第 ${index + 1} 项，写长一点凑够阈值。\n\n    这一行是上面那项的续行正文。`).join("\n\n")
    const chunks = assertLossless(`${blocks}\n`)
    for (const chunk of chunks) {
      expect(chunk.text.startsWith(" ")).toBe(false)
    }
  })

  it("出现引用式链接定义时整篇渲染", () => {
    const body = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 段正文，写得长一点用来凑够切分阈值。\n`).join("\n")
    const source = `${body}\n[参考]: https://example.com\n`
    expect(splitMarkdownIntoChunks(source, { minChars: 40, threshold: 0 })).toHaveLength(1)
  })

  it("出现脚注定义时整篇渲染", () => {
    const body = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 段正文，写得长一点用来凑够切分阈值。\n`).join("\n")
    const source = `${body}\n[^1]: 脚注说明\n`
    expect(splitMarkdownIntoChunks(source, { minChars: 40, threshold: 0 })).toHaveLength(1)
  })

  it("表格整块留在同一段里", () => {
    const rows = Array.from({ length: 20 }, (_, index) => `| 行 ${index} | 值 ${index} |`).join("\n")
    const source = `前置段落，写长一点用来凑够阈值，再多几个字。\n\n| 列 A | 列 B |\n| --- | --- |\n${rows}\n\n收尾段落。\n`
    const chunks = assertLossless(source)
    const withTable = chunks.filter((chunk) => chunk.text.includes("| --- |"))
    expect(withTable).toHaveLength(1)
    expect(withTable[0].text).toContain("| 行 19 | 值 19 |")
  })
})
