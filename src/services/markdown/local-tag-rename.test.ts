import { describe, expect, it, vi } from "vitest"

import type { Note } from "@/types/note"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { renameTagInLocalVault } from "./local-tag-rename"

const oldContent = "---\ntags: [旧标签]\n---\n\n# 正文"
const note = (id: string, contentLoaded = false): Note => ({
  content: contentLoaded ? oldContent : "",
  contentLoaded,
  id,
  preview: "正文",
  remotePath: `${id}.md`,
  source: "local",
  starred: false,
  tags: ["旧标签"],
  title: id,
  updatedAt: "刚刚",
})

describe("renameTagInLocalVault", () => {
  it("writes against the freshly read revision and reports skipped notes", async () => {
    const writeTextFile = vi.fn(async () => ({ revision: "new-revision" }))
    const adapter = {
      kind: "browser", readOnly: false, writeTextFile,
      readTextFile: vi.fn(async (path: string) => ({
        content: path === "stale.md" ? `${oldContent}\n磁盘新增` : oldContent,
        revision: "disk-revision",
      })),
    } as unknown as VaultAdapter
    const onRenamed = vi.fn()
    const report = await renameTagInLocalVault({
      adapter,
      hasPendingSave: (id) => id === "pending",
      notes: [note("one"), note("stale", true), note("pending")],
      onRenamed,
      source: "旧标签",
      target: "新标签",
    })
    expect(report.renamed).toBe(1)
    expect(report.issues).toHaveLength(2)
    expect(writeTextFile).toHaveBeenCalledWith("one.md", expect.stringContaining('tags: ["新标签"]'), "disk-revision")
    expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), expect.any(String), "new-revision")
  })

  it("does not update the note index when the conditional write conflicts", async () => {
    const adapter = {
      kind: "browser", readOnly: false,
      readTextFile: vi.fn(async () => ({ content: oldContent, revision: "before" })),
      writeTextFile: vi.fn(async () => { throw new Error("文件版本已变化") }),
    } as unknown as VaultAdapter
    const onRenamed = vi.fn()
    const report = await renameTagInLocalVault({
      adapter, hasPendingSave: () => false, notes: [note("one")], onRenamed,
      source: "旧标签", target: "新标签",
    })
    expect(report).toEqual({ renamed: 0, issues: ["one：文件版本已变化"] })
    expect(onRenamed).not.toHaveBeenCalled()
  })
})
