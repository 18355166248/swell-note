import { describe, expect, it, vi } from "vitest"

import { collectBackupInventory } from "./backup-inventory"
import { createVaultBackup, parseVaultBackup } from "./vault-backup"

const sourceNote = { id: "n1", path: "docs/a.md", storagePath: "docs/a.md" }
const toBackupPath = (path: string) => path

describe("collectBackupInventory", () => {
  it("reports an uncached note when the source cannot be read", async () => {
    const inventory = await collectBackupInventory({
      cachedAttachments: [],
      notes: [sourceNote],
      toBackupPath,
    })
    expect(inventory.notes).toEqual([])
    expect(inventory.issues).toMatchObject([{ kind: "note", path: "docs/a.md" }])
  })

  it("never substitutes a remote version for an uncached local edit", async () => {
    const loadNote = vi.fn().mockResolvedValue("旧正文")
    const inventory = await collectBackupInventory({
      cachedAttachments: [],
      loadNote,
      notes: [{ ...sourceNote, requiresLocalContent: true }],
      toBackupPath,
    })
    expect(loadNote).not.toHaveBeenCalled()
    expect(inventory.issues[0].reason).toContain("未同步正文")
  })

  it("reports a referenced attachment that cannot be read, once per path", async () => {
    const loadAttachment = vi.fn().mockRejectedValue(new Error("远端不可读"))
    const inventory = await collectBackupInventory({
      cachedAttachments: [],
      loadAttachment,
      notes: [{ ...sourceNote, content: "![一](../assets/a.png)\n![二](../assets/a.png)" }],
      toBackupPath,
    })
    expect(loadAttachment).toHaveBeenCalledTimes(1)
    expect(inventory.issues).toEqual([{ kind: "attachment", path: "assets/a.png", reason: "远端不可读" }])
  })

  it("collects a complete fallback snapshot including referenced assets", async () => {
    const inventory = await collectBackupInventory({
      cachedAttachments: [],
      loadAttachment: async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }),
      loadNote: async () => "# 正文\n![图](../assets/a.png)",
      notes: [sourceNote],
      toBackupPath,
    })
    expect(inventory.issues).toEqual([])
    expect(inventory.notes).toEqual([{ content: "# 正文\n![图](../assets/a.png)", path: "docs/a.md" }])
    expect(inventory.attachments).toMatchObject([{ path: "assets/a.png", mimeType: "image/png" }])
    expect([...inventory.attachments[0].data]).toEqual([1, 2, 3])
    const restored = parseVaultBackup(createVaultBackup({
      attachments: inventory.attachments,
      label: "vault",
      notes: inventory.notes,
    }))
    expect(restored.notes).toEqual(inventory.notes)
    expect([...restored.attachments[0].data]).toEqual([1, 2, 3])
  })

  it("reports notes without a Vault path and ignores external assets", async () => {
    const inventory = await collectBackupInventory({
      cachedAttachments: [],
      notes: [
        { ...sourceNote, path: "未同步笔记", storagePath: "", content: "# 草稿" },
        { ...sourceNote, content: "![远端](https://example.com/a.png)\n![CDN](//example.com/b.png)" },
      ],
      toBackupPath,
    })
    expect(inventory.issues).toEqual([{ kind: "note", path: "未同步笔记", reason: "缺少 Vault 路径" }])
    expect(inventory.notes).toHaveLength(1)
  })
})
