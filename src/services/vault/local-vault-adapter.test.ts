import { describe, expect, it } from "vitest"

import { createBrowserVaultAdapter } from "@/services/vault/local-vault-adapter"

function toBytes(data: BufferSource) {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

class FakeFileHandle {
  readonly kind = "file" as const
  private content: Uint8Array
  private modified = 1

  constructor(readonly name: string, content: string) {
    this.content = new TextEncoder().encode(content)
  }

  async getFile() {
    const content = this.content
    return {
      arrayBuffer: async () => toBytes(content).slice().buffer,
      lastModified: this.modified,
      name: this.name,
      size: content.byteLength,
      text: async () => new TextDecoder().decode(content),
      type: this.name.endsWith(".png") ? "image/png" : "text/markdown",
    } as File
  }

  async createWritable() {
    let nextContent = this.content
    return {
      write: async (content: BufferSource | string) => {
        nextContent = typeof content === "string"
          ? new TextEncoder().encode(content)
          : toBytes(content)
      },
      close: async () => {
        this.content = nextContent
        this.modified += 1
      },
    }
  }

  mutateOutsideApp(content: string) {
    this.content = new TextEncoder().encode(content)
    this.modified += 1
  }
}

class FakeDirectoryHandle {
  readonly kind = "directory" as const
  readonly entries = new Map<string, FakeFileHandle | FakeDirectoryHandle>()

  constructor(readonly name: string) {}

  async *values() {
    yield* this.entries.values()
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const entry = this.entries.get(name)
    if (entry instanceof FakeDirectoryHandle) return entry
    if (entry || !options?.create) throw new Error(`找不到目录：${name}`)
    const directory = new FakeDirectoryHandle(name)
    this.entries.set(name, directory)
    return directory
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const entry = this.entries.get(name)
    if (entry instanceof FakeFileHandle) return entry
    if (!options?.create) throw new Error(`找不到文件：${name}`)
    const file = new FakeFileHandle(name, "")
    this.entries.set(name, file)
    return file
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`找不到文件：${name}`)
    if (entry instanceof FakeDirectoryHandle && entry.entries.size > 0 && !options?.recursive) {
      throw new Error(`文件夹非空：${name}`)
    }
    this.entries.delete(name)
  }
}

function createVault() {
  const root = new FakeDirectoryHandle("Vault")
  const docs = new FakeDirectoryHandle("docs")
  const ignored = new FakeDirectoryHandle(".obsidian")
  const note = new FakeFileHandle("note.md", "# 初始内容")
  docs.entries.set(note.name, note)
  ignored.entries.set("cache.md", new FakeFileHandle("cache.md", "ignore"))
  root.entries.set(docs.name, docs)
  root.entries.set(ignored.name, ignored)
  return { adapter: createBrowserVaultAdapter(root), docs, note, root }
}

describe("browser vault adapter", () => {
  it("递归读取 Markdown 并忽略 Obsidian 内部目录", async () => {
    const { adapter } = createVault()
    await expect(adapter.listMarkdownFiles()).resolves.toEqual([
      expect.objectContaining({ name: "note.md", path: "docs/note.md" }),
    ])
  })

  it("列出并创建空文件夹，同时隐藏附件目录", async () => {
    const { adapter, root } = createVault()
    root.entries.set("attachments", new FakeDirectoryHandle("attachments"))
    await adapter.createDirectory?.("工作/空目录")

    await expect(adapter.listDirectories?.()).resolves.toEqual(expect.arrayContaining(["docs", "工作", "工作/空目录"]))
    await expect(adapter.createDirectory?.("工作/空目录")).rejects.toThrow("文件夹已存在")
  })

  it("重命名目录时复制全部内容并在成功后删除源目录", async () => {
    const { adapter, root } = createVault()
    await adapter.listMarkdownFiles()
    await adapter.moveDirectory?.("docs", "归档/文档")

    await expect(adapter.listDirectories?.()).resolves.toEqual(["归档", "归档/文档"])
    await expect(adapter.readTextFile("归档/文档/note.md")).resolves.toMatchObject({ content: "# 初始内容" })
    expect(root.entries.has("docs")).toBe(false)
  })

  it("递归删除本地目录并清理其文件句柄", async () => {
    const { adapter } = createVault()
    await adapter.listMarkdownFiles()
    await adapter.deleteDirectory?.("docs")

    await expect(adapter.listDirectories?.()).resolves.toEqual([])
    await expect(adapter.readTextFile("docs/note.md")).rejects.toThrow("找不到本地文件")
  })

  it("版本一致时写回源文件并更新 revision", async () => {
    const { adapter } = createVault()
    await adapter.listMarkdownFiles()
    const document = await adapter.readTextFile("docs/note.md")
    const result = await adapter.writeTextFile?.(
      "docs/note.md",
      "# 已保存内容",
      document.revision,
    )

    expect(result?.revision).not.toBe(document.revision)
    await expect(adapter.readTextFile("docs/note.md")).resolves.toMatchObject({
      content: "# 已保存内容",
    })
  })

  it("在指定目录创建真实 Markdown 文件并立即可读", async () => {
    const { adapter } = createVault()
    await adapter.listMarkdownFiles()
    const result = await adapter.createTextFile?.("docs/新笔记.md", "# 新笔记\n")

    expect(result?.path).toBe("docs/新笔记.md")
    await expect(adapter.readTextFile("docs/新笔记.md")).resolves.toMatchObject({
      content: "# 新笔记\n",
    })
    await expect(adapter.createTextFile?.("docs/新笔记.md", "覆盖内容")).rejects.toThrow("文件已存在")
  })

  it("移动和删除 Markdown 文件时同步更新适配器路径", async () => {
    const { adapter } = createVault()
    await adapter.listMarkdownFiles()
    const moved = await adapter.moveTextFile?.("docs/note.md", "note.md")

    expect(moved?.path).toBe("note.md")
    await expect(adapter.readTextFile("note.md")).resolves.toMatchObject({ content: "# 初始内容" })
    await expect(adapter.readTextFile("docs/note.md")).rejects.toThrow("找不到本地文件")
    await adapter.deleteTextFile?.("note.md")
    await expect(adapter.listMarkdownFiles()).resolves.toEqual([])
  })

  it("按相对路径读取 Vault 二进制附件", async () => {
    const { adapter, docs } = createVault()
    docs.entries.set("cover.png", new FakeFileHandle("cover.png", "image-bytes"))

    await expect(adapter.readBinaryFile?.("docs/cover.png")).resolves.toMatchObject({
      mimeType: "image/png",
    })
    const asset = await adapter.readBinaryFile?.("docs/cover.png")
    expect(new TextDecoder().decode(asset?.data)).toBe("image-bytes")
  })

  it("上传附件时按需创建目录并拒绝覆盖同名文件", async () => {
    const { adapter, root } = createVault()
    const path = "attachments/封面-20260824150405.png"
    const data = new Uint8Array([137, 80, 78, 71])

    const result = await adapter.createBinaryFile?.(path, data, "image/png")

    expect(result?.path).toBe(path)
    expect(root.entries.get("attachments")).toBeInstanceOf(FakeDirectoryHandle)
    const asset = await adapter.readBinaryFile?.(path)
    expect(asset && Array.from(asset.data)).toEqual([137, 80, 78, 71])
    await expect(adapter.createBinaryFile?.(path, data)).rejects.toThrow("文件已存在")
  })

  it("检测外部修改后保留冲突副本且不覆盖源文件", async () => {
    const { adapter, docs, note } = createVault()
    await adapter.listMarkdownFiles()
    const document = await adapter.readTextFile("docs/note.md")
    note.mutateOutsideApp("# 外部修改")

    await expect(adapter.writeTextFile?.(
      "docs/note.md",
      "# 应用内草稿",
      document.revision,
    )).rejects.toMatchObject({ name: "VaultConflictError" })

    await expect(adapter.readTextFile("docs/note.md")).resolves.toMatchObject({
      content: "# 外部修改",
    })
    const conflictFile = [...docs.entries.values()].find(
      (entry) => entry instanceof FakeFileHandle && entry.name.includes(".conflict-"),
    ) as FakeFileHandle | undefined
    expect(conflictFile).toBeDefined()
    await expect(conflictFile?.getFile().then((file) => file.text())).resolves.toBe("# 应用内草稿")
  })
})
