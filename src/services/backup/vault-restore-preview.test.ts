import { describe, expect, it } from "vitest"

import { createVaultBackup, parseVaultBackup } from "./vault-backup"
import { inspectVaultRestore } from "./vault-restore-preview"

describe("inspectVaultRestore", () => {
  it("marks known note collisions using the destination storage path", () => {
    const backup = parseVaultBackup(createVaultBackup({
      attachments: [{ data: new Uint8Array([1]), path: "assets/a.png" }],
      label: "archive",
      notes: [{ content: "A", path: "docs/a.md" }, { content: "B", path: "docs/b.md" }],
    }))
    const preview = inspectVaultRestore({
      backup,
      cacheId: "current",
      existingPaths: ["/Vault/docs/a.md"],
      fileName: "archive.zip",
      resolveStoragePath: (path) => `/Vault/${path}`,
      sourceKind: "webdav",
    })
    expect(preview.existingNotePaths).toEqual(["docs/a.md"])
    expect(preview.backup.attachments).toHaveLength(1)
  })
})
