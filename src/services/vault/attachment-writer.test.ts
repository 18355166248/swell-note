import { describe, expect, it, vi } from "vitest"

import { MAX_ATTACHMENT_BYTES } from "./attachment-path"
import {
  canWriteVaultAttachments,
  writeVaultAttachments,
  type AttachmentSource,
} from "./attachment-writer"
import type { VaultAdapter, VaultCreateResult } from "./vault-adapter"

function createSource(overrides: Partial<AttachmentSource> = {}): AttachmentSource {
  return {
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    name: "图片.png",
    size: 3,
    type: "image/png",
    ...overrides,
  }
}

function createAdapter(
  createBinaryFile: (path: string) => Promise<VaultCreateResult>,
  overrides: Partial<VaultAdapter> = {},
): VaultAdapter {
  return {
    cacheIdentity: "test",
    cacheLabel: "测试",
    displayName: "测试",
    kind: "tauri",
    readOnly: false,
    createBinaryFile: (path) => createBinaryFile(path),
    listMarkdownFiles: async () => [],
    readTextFile: async () => ({ content: "" }),
    ...overrides,
  }
}

describe("canWriteVaultAttachments", () => {
  it("只有可写且实现二进制写入的笔记库才允许上传", () => {
    expect(canWriteVaultAttachments(null)).toBe(false)
    expect(canWriteVaultAttachments(createAdapter(async (path) => ({ path })))).toBe(true)
    expect(canWriteVaultAttachments(createAdapter(async (path) => ({ path }), { readOnly: true })))
      .toBe(false)
  })
})

describe("writeVaultAttachments", () => {
  it("写入附件并按笔记层级插入相对路径", async () => {
    const written: string[] = []
    const adapter = createAdapter(async (path) => {
      written.push(path)
      return { path }
    })

    const result = await writeVaultAttachments(adapter, "日记/八月.md", [createSource()])

    expect(result.errors).toEqual([])
    expect(written).toHaveLength(1)
    expect(written[0]).toMatch(/^attachments\/图片-\d{14}\.png$/)
    expect(result.markdown).toBe(`![图片.png](../${written[0]})\n`)
  })

  it("重名时换序号重试", async () => {
    const createBinaryFile = vi.fn(async (path: string) => {
      if (!/-2\.png$/.test(path)) throw new Error(`文件已存在：${path}`)
      return { path }
    })

    const result = await writeVaultAttachments(createAdapter(createBinaryFile), "笔记.md", [
      createSource(),
    ])

    expect(createBinaryFile).toHaveBeenCalledTimes(2)
    expect(result.errors).toEqual([])
    expect(result.markdown).toMatch(/-2\.png\)$/m)
  })

  it("跳过超过体积上限的文件并保留其余附件", async () => {
    const adapter = createAdapter(async (path) => ({ path }))

    const result = await writeVaultAttachments(adapter, "笔记.md", [
      createSource({ name: "大视频.mp4", size: MAX_ATTACHMENT_BYTES + 1, type: "video/mp4" }),
      createSource({ name: "报告.pdf", type: "application/pdf" }),
    ])

    expect(result.errors).toEqual(["大视频.mp4 超过 20MB，未插入"])
    // 非图片附件使用普通链接语法，避免预览把 PDF 当作图片加载。
    expect(result.markdown).toMatch(/^\[报告\.pdf]\(attachments\/报告-\d{14}\.pdf\)\n$/)
  })

  it("写入失败时只报告该文件", async () => {
    const adapter = createAdapter(async (path) => {
      if (path.includes("坏图")) throw new Error("磁盘已满")
      return { path }
    })

    const result = await writeVaultAttachments(adapter, "笔记.md", [
      createSource({ name: "坏图.png" }),
      createSource({ name: "好图.png" }),
    ])

    expect(result.errors).toEqual(["磁盘已满"])
    expect(result.markdown).toMatch(/^!\[好图\.png]\(attachments\/好图-\d{14}\.png\)\n$/)
  })

  it("按 WebDAV 存储前缀写入，插入路径仍是 Vault 内相对路径", async () => {
    const written: string[] = []
    const adapter = createAdapter(
      async (path) => {
        written.push(path)
        return { path }
      },
      {
        kind: "webdav",
        getDisplayPath: (path) => path.replace(/^\/SwellNote\//, ""),
        getStoragePath: (displayPath) => `/SwellNote/${displayPath}`,
      },
    )

    const result = await writeVaultAttachments(adapter, "/SwellNote/日记/八月.md", [createSource()])

    expect(written[0]).toMatch(/^\/SwellNote\/attachments\/图片-\d{14}\.png$/)
    expect(result.markdown).toMatch(/^!\[图片\.png]\(\.\.\/attachments\/图片-\d{14}\.png\)\n$/)
  })
})
