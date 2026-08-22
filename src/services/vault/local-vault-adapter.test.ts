import { describe, expect, it } from "vitest"

import { createBrowserVaultAdapter } from "@/services/vault/local-vault-adapter"

class FakeFileHandle {
  readonly kind = "file" as const
  private content: string
  private modified = 1

  constructor(readonly name: string, content: string) {
    this.content = content
  }

  async getFile() {
    const content = this.content
    return {
      arrayBuffer: async () => new TextEncoder().encode(content).buffer,
      lastModified: this.modified,
      name: this.name,
      size: new TextEncoder().encode(content).length,
      text: async () => content,
      type: this.name.endsWith(".png") ? "image/png" : "text/markdown",
    } as File
  }

  async createWritable() {
    let nextContent = this.content
    return {
      write: async (content: string) => {
        nextContent = content
      },
      close: async () => {
        this.content = nextContent
        this.modified += 1
      },
    }
  }

  mutateOutsideApp(content: string) {
    this.content = content
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

  async getDirectoryHandle(name: string) {
    const entry = this.entries.get(name)
    if (!(entry instanceof FakeDirectoryHandle)) throw new Error(`找不到目录：${name}`)
    return entry
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const entry = this.entries.get(name)
    if (entry instanceof FakeFileHandle) return entry
    if (!options?.create) throw new Error(`找不到文件：${name}`)
    const file = new FakeFileHandle(name, "")
    this.entries.set(name, file)
    return file
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
  return { adapter: createBrowserVaultAdapter(root), docs, note }
}

describe("browser vault adapter", () => {
  it("递归读取 Markdown 并忽略 Obsidian 内部目录", async () => {
    const { adapter } = createVault()
    await expect(adapter.listMarkdownFiles()).resolves.toEqual([
      expect.objectContaining({ name: "note.md", path: "docs/note.md" }),
    ])
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

  it("按相对路径读取 Vault 二进制附件", async () => {
    const { adapter, docs } = createVault()
    docs.entries.set("cover.png", new FakeFileHandle("cover.png", "image-bytes"))

    await expect(adapter.readBinaryFile?.("docs/cover.png")).resolves.toMatchObject({
      mimeType: "image/png",
    })
    const asset = await adapter.readBinaryFile?.("docs/cover.png")
    expect(new TextDecoder().decode(asset?.data)).toBe("image-bytes")
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
