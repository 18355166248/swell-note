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
    expect(parsed.integrityWarnings).toEqual([])
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

  it("reports a legacy archive whose manifest counts do not match its files", () => {
    const archive = zipSync({
      "swell-note-backup.json": strToU8(JSON.stringify({ format: "swell-note-vault", version: 1, noteCount: 2, attachmentCount: 0 })),
      "vault/only.md": strToU8("content"),
    })
    expect(parseVaultBackup(archive).integrityWarnings).toEqual(["清单声明 2 篇笔记，实际包含 1 篇"])
  })

  it("rejects an invalid manifest shape and warns when counts are missing", () => {
    const invalid = zipSync({ "swell-note-backup.json": strToU8("null") })
    expect(() => parseVaultBackup(invalid)).toThrow("manifest 结构无效")

    const missingCounts = zipSync({
      "swell-note-backup.json": strToU8(JSON.stringify({ format: "swell-note-vault", version: 1 })),
      "vault/a.md": strToU8("content"),
    })
    expect(parseVaultBackup(missingCounts).integrityWarnings).toEqual([
      "清单缺少有效的笔记数量",
      "清单缺少有效的附件数量",
    ])
  })

  it("creates a filesystem-safe filename", () => {
    expect(backupFilename("坚果云 / Swell", new Date("2026-08-30T00:00:00Z")))
      .toBe("坚果云-Swell-2026-08-30.swell.zip")
  })

  it("rejects duplicate archive paths instead of silently dropping a file", () => {
    expect(() => createVaultBackup({
      attachments: [{ data: new Uint8Array([1]), path: "docs/a.md" }],
      label: "vault",
      notes: [{ content: "original", path: "docs/a.md" }],
    })).toThrow("重复")
  })

  it("does not create an archive with more files than the importer accepts", () => {
    const notes = Array.from({ length: 10_000 }, (_, index) => ({ content: "", path: `n${index}.md` }))
    expect(() => createVaultBackup({ attachments: [], label: "vault", notes })).toThrow("最多恢复 10000 个文件")
  })
})
