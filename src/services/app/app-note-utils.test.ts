import { describe, expect, it, vi } from "vitest"

import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { readVaultDocuments } from "./app-note-utils"

describe("readVaultDocuments", () => {
  it("scope 在一批正文读取后失效时不再发下一批请求", async () => {
    let current = true
    const readTextFile = vi.fn(async (path: string) => {
      if (readTextFile.mock.calls.length === 4) current = false
      return { content: path }
    })
    const adapter: VaultAdapter = {
      cacheIdentity: "webdav:scope",
      cacheLabel: "scope",
      displayName: "scope",
      kind: "webdav",
      listMarkdownFiles: async () => [],
      readOnly: false,
      readTextFile,
    }
    const documents = await readVaultDocuments(
      adapter,
      ["/1.md", "/2.md", "/3.md", "/4.md", "/5.md"],
      () => !current,
    )

    expect(readTextFile).toHaveBeenCalledTimes(4)
    expect(documents.size).toBe(0)
  })
})
