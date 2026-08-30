import { describe, expect, it } from "vitest"

import { VaultConflictError, type VaultAdapter } from "@/services/vault/vault-adapter"
import type { Note } from "@/types/note"
import { mergeMarkdownVersions } from "./three-way-merge"
import { syncWebDavNoteQueue } from "./webdav-note-queue"

function deviceNote(content: string): Note {
  return {
    baseContent: "# 周报\n\n进度：旧\n\n风险：旧",
    content,
    contentLoaded: true,
    id: "webdav:/Swell/week.md",
    preview: "周报",
    readOnly: false,
    remotePath: "/Swell/week.md",
    revision: '"v1"',
    source: "webdav",
    starred: false,
    syncStatus: "modified",
    title: "周报",
    updatedAt: "待同步",
  }
}

describe("多设备同步专项", () => {
  it("第二台设备命中 ETag 冲突后可三方合并并安全续传", async () => {
    let remote = { content: "# 周报\n\n进度：旧\n\n风险：旧", revision: '"v1"' }
    const adapter: VaultAdapter = {
      cacheIdentity: "webdav:multi-device",
      cacheLabel: "测试库",
      displayName: "坚果云",
      kind: "webdav",
      listMarkdownFiles: async () => [],
      readOnly: false,
      readTextFile: async () => remote,
      writeTextFile: async (_path, content, expectedRevision) => {
        if (expectedRevision !== remote.revision) throw new VaultConflictError("/Swell/week.md")
        const nextVersion = Number(remote.revision.match(/\d+/)?.[0] ?? 1) + 1
        remote = { content, revision: `"v${nextVersion}"` }
        return { revision: remote.revision }
      },
    }
    const deviceA = deviceNote("# 周报\n\n进度：设备 A 已完成\n\n风险：旧")
    const deviceB = deviceNote("# 周报\n\n进度：旧\n\n风险：设备 B 已解除")

    const first = await syncWebDavNoteQueue({ adapter, notes: [deviceA] })
    expect(first.notes[0]).toMatchObject({ revision: '"v2"', syncStatus: "synced" })
    const conflicted = await syncWebDavNoteQueue({ adapter, notes: [deviceB] })
    expect(conflicted.notes[0]).toMatchObject({ content: deviceB.content, syncStatus: "conflict" })

    const latestRemote = await adapter.readTextFile("/Swell/week.md")
    const merged = mergeMarkdownVersions(deviceB.baseContent, deviceB.content, latestRemote.content)
    expect(merged.conflictCount).toBe(0)
    const resolved: Note = {
      ...conflicted.notes[0],
      baseContent: latestRemote.content,
      content: merged.content,
      revision: latestRemote.revision,
      syncStatus: "modified",
    }
    const retried = await syncWebDavNoteQueue({ adapter, notes: [resolved] })

    expect(retried.notes[0]).toMatchObject({ revision: '"v3"', syncStatus: "synced" })
    expect(remote.content).toContain("设备 A 已完成")
    expect(remote.content).toContain("设备 B 已解除")
  })

  it("同一段并发修改不会自动上传带歧义的合并稿", () => {
    const merged = mergeMarkdownVersions("旧方案", "设备 A 方案", "设备 B 方案")
    expect(merged.conflictCount).toBe(1)
    expect(merged.content).toContain("<<<<<<< 本机")
    expect(merged.content).toContain("设备 A 方案")
    expect(merged.content).toContain("设备 B 方案")
  })
})
