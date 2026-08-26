import { describe, expect, it } from "vitest"

import { extractAttachmentSources, inspectCachedAttachments } from "./attachment-maintenance"
import type { VaultAttachmentCacheEntry } from "@/services/cache/vault-cache"

const entry = (path: string, status: VaultAttachmentCacheEntry["status"] = "synced"): VaultAttachmentCacheEntry => ({
  cacheId: "vault",
  createdAt: 1,
  data: new ArrayBuffer(4),
  key: `vault\0${path}`,
  noteId: "webdav:/Swell/目录/笔记.md",
  path,
  status,
})

describe("attachment maintenance", () => {
  it("识别标准 Markdown 与 Obsidian 附件引用", () => {
    expect(extractAttachmentSources("![图](../attachments/a.png)\n![[../attachments/b.pdf|资料]]\n![[图|300]](../attachments/c.png)"))
      .toEqual(["../attachments/c.png", "../attachments/a.png", "../attachments/b.pdf"])
  })

  it("只把已上传且未被正文引用的缓存标记为孤儿", () => {
    const report = inspectCachedAttachments([{
      content: "![图](../attachments/a.png)",
      contentLoaded: true,
      folder: "目录",
      id: "webdav:/Swell/目录/笔记.md",
      preview: "",
      remotePath: "/Swell/目录/笔记.md",
      source: "webdav",
      starred: false,
      title: "笔记",
      updatedAt: "2026-01-01",
    }], [
      entry("/Swell/attachments/a.png"),
      entry("/Swell/attachments/orphan.png"),
      entry("/Swell/attachments/pending.png", "pending"),
    ])

    expect(report.referenced.map((item) => item.path)).toEqual([
      "/Swell/attachments/a.png",
      "/Swell/attachments/pending.png",
    ])
    expect(report.orphaned.map((item) => item.path)).toEqual(["/Swell/attachments/orphan.png"])
    expect(report.bytes).toBe(12)
    expect(report.scanComplete).toBe(true)
  })

  it("正文尚未全部读取时不把附件误判为孤儿", () => {
    const report = inspectCachedAttachments([{
      content: "",
      contentLoaded: false,
      id: "webdav:/Swell/未读取.md",
      preview: "",
      starred: false,
      title: "未读取",
      updatedAt: "2026-01-01",
    }], [entry("/Swell/attachments/unknown.png")])

    expect(report.scanComplete).toBe(false)
    expect(report.orphaned).toEqual([])
  })
})
