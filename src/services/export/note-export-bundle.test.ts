import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it, vi } from "vitest"

import { collectNoteExportReferences, createNoteExportBundle } from "./note-export-bundle"

describe("note export bundle", () => {
  it("只打包正文引用的 Vault 附件，保留目录和外链", async () => {
    const content = [
      "![封面](../attachments/a%20b.png)",
      "[资料](../attachments/report.pdf)",
      "[重复](../attachments/report.pdf)",
      "[另一篇](./other.md)",
      "[目录](./folder)",
      "[网站](https://example.com/docs)",
    ].join("\n")
    const readAsset = vi.fn(async (path: string) => ({ data: new TextEncoder().encode(path) }))
    const result = await createNoteExportBundle({ content, notePath: "docs/note.md", readAsset })
    const archive = unzipSync(result.archive)

    expect(Object.keys(archive).sort()).toEqual([
      "docs/note.md", "attachments/a b.png", "attachments/report.pdf", "导出清单.txt",
    ].sort())
    expect(strFromU8(archive["docs/note.md"])).toBe(content)
    expect(strFromU8(archive["attachments/a b.png"])).toBe("attachments/a b.png")
    expect(readAsset.mock.calls.map(([path]) => path)).toEqual(["attachments/a b.png", "attachments/report.pdf"])
    expect(result.attachmentCount).toBe(2)
    expect(result.externalLinks).toEqual(["https://example.com/docs"])
    expect(result.missingAttachments).toEqual([])
    expect(strFromU8(archive[result.reportPath])).toContain("https://example.com/docs")
  })

  it("越界和缺失附件写入清单，不读取库外路径", async () => {
    const readAsset = vi.fn(async () => null)
    const result = await createNoteExportBundle({
      content: "![越界](../../secret.png)\n![缺失](../attachments/lost.png)\n[邮件](mailto:a@example.com)",
      notePath: "docs/note.md",
      readAsset,
    })
    const archive = unzipSync(result.archive)
    expect(readAsset).toHaveBeenCalledExactlyOnceWith("attachments/lost.png")
    expect(result.missingAttachments).toHaveLength(2)
    expect(result.externalLinks).toEqual(["mailto:a@example.com"])
    expect(strFromU8(archive[result.reportPath])).toContain("路径无效或越过笔记库")
    expect(strFromU8(archive[result.reportPath])).toContain("未找到附件")
  })

  it("Obsidian 嵌入和清单重名附件均可打包", async () => {
    const result = await createNoteExportBundle({
      content: "![[导出清单.txt]]\n![[attachments/photo.png|照片]]",
      notePath: "note.md",
      readAsset: async (path) => ({ data: new TextEncoder().encode(path) }),
    })
    const archive = unzipSync(result.archive)
    expect(result.reportPath).toBe("导出清单-2.txt")
    expect(strFromU8(archive["导出清单.txt"])).toBe("导出清单.txt")
    expect(archive["attachments/photo.png"]).toBeDefined()
  })

  it("识别括号文件名、裸外链，并忽略代码示例", () => {
    expect(collectNoteExportReferences([
      "[图](../attachments/a(1).png)",
      "[空格文件](<../attachments/a b.pdf>)",
      "网址 https://example.com/help。",
      "```md",
      "![示例](../attachments/not-real.png)",
      "```",
      "`![行内示例](../attachments/inline.png)`",
    ].join("\n"))).toEqual({
      attachmentSources: ["../attachments/a(1).png", "../attachments/a b.pdf"],
      externalLinks: ["https://example.com/help"],
    })
  })

  it("把 Vault 根目录式附件链接改成包内可打开的相对路径", async () => {
    const result = await createNoteExportBundle({
      content: "![图](/attachments/封面.png)\n![[/attachments/语音.mp3|试听]]",
      notePath: "docs/note.md",
      readAsset: async () => ({ data: new Uint8Array([1]) }),
    })
    const archive = unzipSync(result.archive)
    expect(strFromU8(archive["docs/note.md"])).toBe("![图](../attachments/%E5%B0%81%E9%9D%A2.png)\n![[../attachments/%E8%AF%AD%E9%9F%B3.mp3|试听]]")
    expect(archive["attachments/封面.png"]).toBeDefined()
    expect(archive["attachments/语音.mp3"]).toBeDefined()
  })
})
