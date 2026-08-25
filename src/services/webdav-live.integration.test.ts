import { describe, expect, it } from "vitest"

import type { WebDavConfig } from "@/lib/webdav-config"
import {
  createMarkdownFile,
  deleteMarkdownFile,
  ensureWebDavDirectory,
  readMarkdownDocument,
  WebDavRevisionConflictError,
  writeMarkdownFile,
} from "@/services/webdav-client"

const confirmed = process.env.SWELL_WEBDAV_E2E_CONFIRM === "write-dedicated-test-file"
const username = process.env.SWELL_WEBDAV_E2E_USERNAME ?? ""
const password = process.env.SWELL_WEBDAV_E2E_PASSWORD ?? ""
const vaultRoot = (process.env.SWELL_WEBDAV_E2E_VAULT_ROOT ?? "/Swell/").replace(/\/+$/, "/")
const testRoot = `${vaultRoot}__swell_note_e2e__/`
const enabled = confirmed && Boolean(username && password)

describe.skipIf(!enabled)("live WebDAV concurrency", () => {
  it("rejects a stale second-device write and leaves the latest remote body intact", async () => {
    const config: WebDavConfig = {
      provider: "jianguoyun",
      remotePath: vaultRoot,
      serverUrl: process.env.SWELL_WEBDAV_E2E_URL ?? "https://dav.jianguoyun.com/dav/",
      username,
    }
    const filePath = `${testRoot}swell-note-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}.md`
    await ensureWebDavDirectory(config, password, testRoot)
    const created = await createMarkdownFile(config, password, filePath, "# initial\n")
    expect(created.revision).toBeTruthy()

    let cleanupRevision = created.revision!
    try {
      const deviceA = await readMarkdownDocument(config, password, filePath)
      const deviceB = await readMarkdownDocument(config, password, filePath)
      const updated = await writeMarkdownFile(config, password, filePath, "# device A\n", deviceA.revision!)
      cleanupRevision = updated.revision ?? cleanupRevision

      await expect(writeMarkdownFile(config, password, filePath, "# stale device B\n", deviceB.revision!))
        .rejects.toBeInstanceOf(WebDavRevisionConflictError)

      const latest = await readMarkdownDocument(config, password, filePath)
      cleanupRevision = latest.revision ?? cleanupRevision
      expect(latest.content).toBe("# device A\n")
    } finally {
      await deleteMarkdownFile(config, password, filePath, cleanupRevision)
    }
  }, 30_000)
})
