import { describe, expect, it } from "vitest"

import { resolveVaultAssetPath } from "./vault-path"

describe("resolveVaultAssetPath", () => {
  it("解析同目录与父目录附件", () => {
    expect(resolveVaultAssetPath("docs/note.md", "image.png")).toBe("docs/image.png")
    expect(resolveVaultAssetPath("docs/note.md", "../assets/封面.png")).toBe("assets/封面.png")
  })

  it("保留 WebDAV 绝对路径格式", () => {
    expect(resolveVaultAssetPath("/SwellNote/docs/note.md", "../assets/a%20b.png"))
      .toBe("/SwellNote/assets/a b.png")
  })

  it("拒绝外部地址、损坏编码和越界路径", () => {
    expect(resolveVaultAssetPath("docs/note.md", "https://example.com/a.png")).toBeNull()
    expect(resolveVaultAssetPath("docs/note.md", "%E0%A4%A")).toBeNull()
    expect(resolveVaultAssetPath("note.md", "../secret.png")).toBeNull()
  })
})
