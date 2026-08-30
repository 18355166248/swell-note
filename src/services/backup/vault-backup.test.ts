import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"

import { backupFilename, createVaultBackup, parseVaultBackup } from "./vault-backup"

describe("vault backup", () => {
  it("round trips nested notes and binary attachments", () => {
    const data = createVaultBackup({
      attachments: [{ data: new Uint8Array([1, 2, 3]), mimeType: "image/png", path: "assets/a.png" }],
      label: "测试 Vault",
      notes: [{ content: "# 标题", path: "docs/a.md" }],
    })
    const parsed = parseVaultBackup(data)

    expect(parsed.manifest).toMatchObject({ attachmentCount: 1, noteCount: 1, version: 1 })
    expect(parsed.notes).toEqual([{ content: "# 标题", path: "docs/a.md" }])
    expect(parsed.attachments[0]).toMatchObject({ path: "assets/a.png", mimeType: "image/png" })
    expect([...parsed.attachments[0].data]).toEqual([1, 2, 3])
  })

  it("rejects traversal paths", () => {
    const archive = zipSync({
      "swell-note-backup.json": strToU8(JSON.stringify({ format: "swell-note-vault", version: 1 })),
      "vault/../secret.md": strToU8("secret"),
    })
    expect(() => parseVaultBackup(archive)).toThrow("非法路径")
  })

  it("creates a filesystem-safe filename", () => {
    expect(backupFilename("坚果云 / Swell", new Date("2026-08-30T00:00:00Z")))
      .toBe("坚果云-Swell-2026-08-30.swell.zip")
  })
})
