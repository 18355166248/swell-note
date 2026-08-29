import { describe, expect, it } from "vitest"

import { markdownExportFilename } from "./markdown-export"

describe("markdownExportFilename", () => {
  it("keeps Markdown suffix and removes platform-invalid characters", () => {
    expect(markdownExportFilename("需求:第一版?.md")).toBe("需求-第一版-.md")
    expect(markdownExportFilename("普通笔记")).toBe("普通笔记.md")
    expect(markdownExportFilename(" ... ")).toBe("未命名笔记.md")
  })
})
