import { describe, expect, it, vi } from "vitest"
import type { Note } from "@/types/note"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { adoptRemoteConflictDocument, findRemoteConflictCandidates } from "./remote-conflict-recovery"

const oldPath = "/Swell/XIMA广告1/免费模式场景新增下载专区.md"
const path = "/Swell/XIMA广告/免费模式场景新增下载专区.md"
const file = { path, name: "免费模式场景新增下载专区.md" }
const source: Note = {
  id: `webdav:${oldPath}`, remotePath: oldPath, source: "webdav", title: "免费模式场景新增下载专区",
  content: "本地修改", baseContent: "旧正文", preview: "本地预览", updatedAt: "刚刚", starred: false,
  folder: "XIMA广告1", contentLoaded: true, revision: "old", syncStatus: "conflict", syncError: "HTTP 409",
}
const document = { content: "# 最新云端正文", revision: "new-etag" }

describe("missing remote conflict recovery", () => {
  it("保留多个同名候选供确认，过滤原路径、相似标题并去重", async () => {
    const listMarkdownFiles = vi.fn().mockResolvedValue([
      file, { ...file, path: oldPath }, file,
      { ...file, path: "/Swell/其他/免费模式场景新增下载专区.md" },
      { ...file, path: "/Swell/其他/免费模式场景新增下载专区-副本.md" },
    ])
    expect(await findRemoteConflictCandidates({ listMarkdownFiles } as unknown as VaultAdapter, oldPath))
      .toEqual([file, { ...file, path: "/Swell/其他/免费模式场景新增下载专区.md" }])
  })

  it("旧路径冲突与正常路径缓存同时存在时，采用云端后只保留一篇并更新正文和版本", () => {
    const target = { ...source, id: `webdav:${path}`, remotePath: path, syncStatus: "synced" as const, pinned: true }
    const notes = adoptRemoteConflictDocument([source, target], source.id, file, document, "XIMA广告/免费模式场景新增下载专区.md")
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      id: target.id, folder: "XIMA广告", remotePath: path, content: document.content,
      baseContent: document.content, revision: "new-etag", syncStatus: "synced", pinned: true,
    })
    expect(notes[0].syncError).toBeUndefined()
    expect(source.content).toBe("本地修改")
  })

  it.each(["modified", "conflict"] as const)("目标也有 %s 工作副本时拒绝覆盖", (syncStatus) => {
    const target = { ...source, id: `webdav:${path}`, remotePath: path, syncStatus }
    expect(() => adoptRemoteConflictDocument([source, target], source.id, file, document)).toThrow("目标笔记也有未同步修改")
  })

  it("原路径仍存在时也能采用云端，清掉旧操作标记", () => {
    const notes = adoptRemoteConflictDocument([{ ...source, previousRemotePath: path, pendingOperation: "move" }], source.id, file, document)
    expect(notes[0]).toMatchObject({ content: document.content, syncStatus: "synced" })
    expect(notes[0].previousRemotePath).toBeUndefined()
    expect(notes[0].pendingOperation).toBeUndefined()
  })

  it("存在多条目标路径记录时，不能只检查第一条并删除后面的工作副本", () => {
    const target = { ...source, id: `webdav:${path}`, remotePath: path, syncStatus: "synced" as const }
    const duplicate = { ...target, id: "legacy-id", syncStatus: "modified" as const, content: "目标的独有修改" }
    expect(() => adoptRemoteConflictDocument([source, target, duplicate], source.id, file, document))
      .toThrow("目标笔记也有未同步修改")
  })
})
