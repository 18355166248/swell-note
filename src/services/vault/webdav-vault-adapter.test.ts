import { describe, expect, it } from "vitest"

import { createWebDavVaultAdapter } from "@/services/vault/webdav-vault-adapter"

describe("WebDAV vault paths", () => {
  const adapter = createWebDavVaultAdapter({
    provider: "jianguoyun",
    remotePath: "/Swell/",
    serverUrl: "https://dav.jianguoyun.com/dav/",
    username: "test@example.com",
  }, "app-password")

  it("在展示路径和坚果云存储路径之间转换", () => {
    expect(adapter.getDisplayPath?.("/Swell/XIMA-AI/记录.md")).toBe("XIMA-AI/记录.md")
    expect(adapter.getStoragePath?.("XIMA-AI/新笔记.md")).toBe("/Swell/XIMA-AI/新笔记.md")
    expect(adapter.getStoragePath?.("根目录.md")).toBe("/Swell/根目录.md")
  })
})
