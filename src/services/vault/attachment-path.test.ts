import { describe, expect, it } from "vitest"

import {
  buildAttachmentHref,
  buildAttachmentMarkdown,
  buildAttachmentFileName,
  buildAttachmentVaultPath,
  isImageAttachment,
} from "./attachment-path"
import { resolveVaultAssetPath } from "./vault-path"

const now = new Date(2026, 7, 24, 15, 4, 5)

describe("buildAttachmentFileName", () => {
  it("保留中文并清理空格与非法字符", () => {
    expect(buildAttachmentFileName({ fileName: "屏幕 快照 (2).PNG", mimeType: "image/png", now }))
      .toBe("屏幕-快照-2-20260824150405.png")
  })

  it("缺少扩展名时回退到 MIME 类型", () => {
    expect(buildAttachmentFileName({ fileName: "clipboard", mimeType: "image/jpeg", now }))
      .toBe("clipboard-20260824150405.jpg")
    expect(buildAttachmentFileName({ fileName: "", mimeType: "image/png", now }))
      .toBe("image-20260824150405.png")
    expect(buildAttachmentFileName({ fileName: "", mimeType: "", now }))
      .toBe("attachment-20260824150405.bin")
  })

  it("同一秒内重名时追加序号", () => {
    expect(buildAttachmentFileName({ duplicateIndex: 1, fileName: "a.png", now }))
      .toBe("a-20260824150405-2.png")
  })
})

describe("buildAttachmentHref", () => {
  it("按笔记所在层级生成相对路径", () => {
    const path = buildAttachmentVaultPath("封面-20260824150405.png")
    expect(buildAttachmentHref("笔记.md", path)).toBe("attachments/封面-20260824150405.png")
    expect(buildAttachmentHref("日记/2026/八月.md", path))
      .toBe("../../attachments/封面-20260824150405.png")
    expect(buildAttachmentHref("attachments/说明.md", path))
      .toBe("封面-20260824150405.png")
  })
})

describe("附件路径与预览解析保持一致", () => {
  it("生成的相对路径能被预览层还原为 Vault 内路径", () => {
    const attachmentPath = buildAttachmentVaultPath(
      buildAttachmentFileName({ fileName: "会议 记录.png", mimeType: "image/png", now }),
    )
    const notePath = "日记/2026/八月.md"
    const href = buildAttachmentHref(notePath, attachmentPath)
    expect(resolveVaultAssetPath(notePath, href)).toBe(attachmentPath)
  })
})

describe("buildAttachmentMarkdown", () => {
  it("图片使用嵌入语法，其他附件使用链接语法", () => {
    expect(buildAttachmentMarkdown("图.png", "attachments/图.png", true))
      .toBe("![图.png](attachments/图.png)")
    expect(buildAttachmentMarkdown("报告[草稿].pdf", "attachments/a.pdf", false))
      .toBe("[报告草稿.pdf](attachments/a.pdf)")
  })
})

describe("isImageAttachment", () => {
  it("同时识别 MIME 类型与扩展名", () => {
    expect(isImageAttachment("image/webp", "clipboard")).toBe(true)
    expect(isImageAttachment(undefined, "photo.JPEG")).toBe(true)
    expect(isImageAttachment("application/pdf", "report.pdf")).toBe(false)
  })
})
