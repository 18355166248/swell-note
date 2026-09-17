import { describe, expect, it } from "vitest"

import { splitMarkdownFrontmatter } from "./milkdown-editor"

describe("splitMarkdownFrontmatter", () => {
  it("keeps a complete YAML header byte-for-byte", () => {
    const source = "---\ntitle: 测试\ntags: [milkdown]\n---\n# 正文\n"
    expect(splitMarkdownFrontmatter(source)).toEqual({
      body: "# 正文\n",
      frontmatter: "---\ntitle: 测试\ntags: [milkdown]\n---\n",
    })
  })

  it("does not treat an unclosed fence as frontmatter", () => {
    const source = "---\ntitle: 未闭合\n# 正文"
    expect(splitMarkdownFrontmatter(source)).toEqual({ body: source, frontmatter: "" })
  })

  it("leaves normal Markdown untouched", () => {
    expect(splitMarkdownFrontmatter("# 正文")).toEqual({ body: "# 正文", frontmatter: "" })
  })
})
