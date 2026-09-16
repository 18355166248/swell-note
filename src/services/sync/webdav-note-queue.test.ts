import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"

import { syncWebDavNoteQueue } from "./webdav-note-queue"
import { VaultConflictError, type VaultAdapter } from "@/services/vault/vault-adapter"
import { loadVaultCache, saveVaultCache, saveVaultNoteQueueCheckpoint } from "@/services/cache/vault-cache"
import type { Note } from "@/types/note"

function note(id: string, patch: Partial<Note> = {}): Note {
  return {
    content: `正文 ${id}`,
    contentLoaded: true,
    id,
    preview: id,
    readOnly: false,
    remotePath: `/Swell/${id}.md`,
    revision: '"v1"',
    source: "webdav",
    starred: false,
    syncStatus: "modified",
    title: id,
    updatedAt: "待同步",
    ...patch,
  }
}

function adapter(patch: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    cacheIdentity: "webdav:test",
    cacheLabel: "测试库",
    displayName: "坚果云",
    kind: "webdav",
    listMarkdownFiles: vi.fn(),
    readOnly: false,
    readTextFile: vi.fn(),
    writeTextFile: vi.fn().mockResolvedValue({ revision: '"v2"' }),
    ...patch,
  }
}

describe("syncWebDavNoteQueue", () => {
  it("单篇网络失败不会阻断后续笔记，失败项仍留在重试队列", async () => {
    const writeTextFile = vi.fn()
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce({ revision: '"v2"' })
    const result = await syncWebDavNoteQueue({ adapter: adapter({ writeTextFile }), notes: [note("a"), note("b")] })

    expect(result.notes).toEqual([
      expect.objectContaining({ id: "a", syncError: "网络中断", syncStatus: "modified" }),
      expect.objectContaining({ id: "b", revision: '"v2"', syncStatus: "synced" }),
    ])
    expect(writeTextFile).toHaveBeenCalledTimes(2)
  })

  it("重试只处理仍失败的项目，已经成功的笔记不会重复写入", async () => {
    const firstWrite = vi.fn()
      .mockRejectedValueOnce(new Error("临时失败"))
      .mockResolvedValueOnce({ revision: '"v2"' })
    const first = await syncWebDavNoteQueue({ adapter: adapter({ writeTextFile: firstWrite }), notes: [note("a"), note("b")] })
    const retryWrite = vi.fn().mockResolvedValue({ revision: '"v3"' })
    const retried = await syncWebDavNoteQueue({ adapter: adapter({ writeTextFile: retryWrite }), notes: first.notes })

    expect(retryWrite).toHaveBeenCalledOnce()
    expect(retryWrite).toHaveBeenCalledWith("/Swell/a.md", "正文 a", '"v1"')
    expect(retried.notes.every((item) => item.syncStatus === "synced")).toBe(true)
  })

  it("取消发生后保留尚未处理项目，只提交已经完成的状态", async () => {
    let cancelled = false
    const writeTextFile = vi.fn().mockResolvedValue({ revision: '"v2"' })
    const result = await syncWebDavNoteQueue({
      adapter: adapter({ writeTextFile }),
      isCancelled: () => cancelled,
      notes: [note("a"), note("b")],
      onEvent: (event) => { if (event.type === "synced") cancelled = true },
    })

    expect(result.cancelled).toBe(true)
    expect(writeTextFile).toHaveBeenCalledOnce()
    expect(result.notes[0].syncStatus).toBe("synced")
    expect(result.notes[1].syncStatus).toBe("modified")
  })

  it("远端版本冲突不覆盖本地正文，并转为显式冲突状态", async () => {
    const result = await syncWebDavNoteQueue({
      adapter: adapter({ writeTextFile: vi.fn().mockRejectedValue(new VaultConflictError("/Swell/a.md")) }),
      notes: [note("a")],
    })

    expect(result.notes[0]).toMatchObject({ content: "正文 a", syncStatus: "conflict" })
    expect(result.notes[0].syncError).toBeUndefined()
  })

  it("认证失效会安全停止，但保留失效前已经成功的本地状态", async () => {
    class AuthenticationError extends Error {}
    const error = new AuthenticationError("密码失效")
    const writeTextFile = vi.fn()
      .mockResolvedValueOnce({ revision: '"v2"' })
      .mockRejectedValueOnce(error)
    const result = await syncWebDavNoteQueue({
      adapter: adapter({ writeTextFile }),
      isFatalError: (candidate) => candidate instanceof AuthenticationError,
      notes: [note("a"), note("b"), note("c")],
    })

    expect(result.fatalError).toBe(error)
    expect(result.notes[0].syncStatus).toBe("synced")
    expect(result.notes[1].syncStatus).toBe("modified")
    expect(result.notes[2].syncStatus).toBe("modified")
    expect(writeTextFile).toHaveBeenCalledTimes(2)
  })

  it("移动后继续编辑时先建目录、移动文件，再使用新版本写入正文", async () => {
    const ensureDirectory = vi.fn()
    const moveTextFile = vi.fn().mockResolvedValue({ path: "/Swell/new/a.md", revision: '"moved"' })
    const writeTextFile = vi.fn().mockResolvedValue({ revision: '"written"' })
    const result = await syncWebDavNoteQueue({
      adapter: adapter({ ensureDirectory, moveTextFile, writeTextFile }),
      notes: [note("a", {
        pendingOperation: "move",
        previousRemotePath: "/Swell/old/a.md",
        remotePath: "/Swell/new/a.md",
      })],
    })

    expect(ensureDirectory).toHaveBeenCalledWith("/Swell/new")
    expect(moveTextFile).toHaveBeenCalledWith("/Swell/old/a.md", "/Swell/new/a.md", '"v1"')
    expect(writeTextFile).toHaveBeenCalledWith("/Swell/new/a.md", "正文 a", '"moved"')
    expect(result.notes[0]).toMatchObject({ revision: '"written"', syncStatus: "synced" })
  })

  it("移动成功但正文写入中断时保存新路径检查点，重试不会再次 MOVE", async () => {
    const firstMove = vi.fn().mockResolvedValue({ path: "/Swell/new/a.md", revision: '"moved"' })
    const first = await syncWebDavNoteQueue({
      adapter: adapter({
        ensureDirectory: vi.fn(),
        moveTextFile: firstMove,
        writeTextFile: vi.fn().mockRejectedValue(new Error("PUT 中断")),
      }),
      notes: [note("a", {
        pendingOperation: "move",
        previousRemotePath: "/Swell/old/a.md",
        remotePath: "/Swell/new/a.md",
      })],
    })

    expect(first.notes[0]).toMatchObject({
      pendingOperation: undefined,
      previousRemotePath: undefined,
      remotePath: "/Swell/new/a.md",
      revision: '"moved"',
      syncError: "PUT 中断",
      syncStatus: "modified",
    })
    const retryMove = vi.fn()
    const retryWrite = vi.fn().mockResolvedValue({ revision: '"written"' })
    const retried = await syncWebDavNoteQueue({
      adapter: adapter({ moveTextFile: retryMove, writeTextFile: retryWrite }),
      notes: first.notes,
    })

    expect(retryMove).not.toHaveBeenCalled()
    expect(retryWrite).toHaveBeenCalledWith("/Swell/new/a.md", "正文 a", '"moved"')
    expect(retried.notes[0]).toMatchObject({ revision: '"written"', syncStatus: "synced" })
  })

  it("删除成功后才清理本地条目和关联附件", async () => {
    const deleteTextFile = vi.fn()
    const onDeleteCommitted = vi.fn()
    const result = await syncWebDavNoteQueue({
      adapter: adapter({ deleteTextFile }),
      notes: [note("a", { pendingOperation: "delete" })],
      onDeleteCommitted,
    })

    expect(deleteTextFile).toHaveBeenCalledWith("/Swell/a.md", '"v1"')
    expect(onDeleteCommitted).toHaveBeenCalledOnce()
    expect(result.notes).toEqual([])
  })

  it("远端删除已成功时，本机附件清理失败也不会重新排队删除", async () => {
    const deleteTextFile = vi.fn()
    const result = await syncWebDavNoteQueue({
      adapter: adapter({ deleteTextFile }),
      notes: [note("a", { pendingOperation: "delete" })],
      onDeleteCommitted: vi.fn().mockRejectedValue(new Error("IndexedDB 暂不可用")),
    })

    expect(deleteTextFile).toHaveBeenCalledOnce()
    expect(result.notes).toEqual([])
    expect(result.errorMessage).toBeNull()
  })

  it("MKCOL 返回时 scope 失效，不再发送文件 MOVE 或 PUT", async () => {
    let cancelled = false
    const moveTextFile = vi.fn()
    const writeTextFile = vi.fn()
    const result = await syncWebDavNoteQueue({
      adapter: adapter({
        ensureDirectory: vi.fn(async () => { cancelled = true }),
        moveTextFile,
        writeTextFile,
      }),
      isCancelled: () => cancelled,
      notes: [note("a", {
        pendingOperation: "move",
        previousRemotePath: "/Swell/old/a.md",
        remotePath: "/Swell/new/a.md",
      })],
    })

    expect(result.cancelled).toBe(true)
    expect(moveTextFile).not.toHaveBeenCalled()
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it("文件 MOVE 返回后 scope 失效，先保存来源库 moved 检查点且不继续 PUT", async () => {
    let cancelled = false
    const writeTextFile = vi.fn()
    const onCheckpoint = vi.fn(async ({ note: checkpointNote }) => {
      cancelled = true
      return [checkpointNote]
    })
    const result = await syncWebDavNoteQueue({
      adapter: adapter({
        ensureDirectory: vi.fn(),
        moveTextFile: vi.fn().mockResolvedValue({ revision: '"moved"' }),
        writeTextFile,
      }),
      isCancelled: () => cancelled,
      notes: [note("a", {
        pendingOperation: "move",
        previousRemotePath: "/Swell/old/a.md",
        remotePath: "/Swell/new/a.md",
      })],
      onCheckpoint,
    })

    expect(onCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      note: expect.objectContaining({ pendingOperation: undefined, previousRemotePath: undefined, revision: '"moved"' }),
      type: "moved",
    }))
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(result.cancelled).toBe(true)
    expect(result.notes[0]).toMatchObject({ pendingOperation: undefined, revision: '"moved"' })
  })

  it("真实缓存检查点保留失败 a，成功 b 后重开仍只定向重试 a", async () => {
    const cacheId = `mixed-two-${crypto.randomUUID()}`
    const notes = [note("a"), note("b")]
    await saveVaultCache({ activeNoteId: "a", id: cacheId, label: "混合结果", notes, savedAt: 1, sourceKind: "webdav" })
    const writeTextFile = vi.fn(async (path: string) => {
      if (path.endsWith("/a.md")) throw new Error("temporary a failure")
      return { revision: '"v2"' }
    })
    const result = await syncWebDavNoteQueue({
      adapter: adapter({ writeTextFile }),
      notes,
      onCheckpoint: async (checkpoint) => (await saveVaultNoteQueueCheckpoint(cacheId, checkpoint)).notes,
    })
    const reopened = await loadVaultCache(cacheId, { hydrate: "all" })
    expect(result.notes).toEqual([
      expect.objectContaining({ id: "a", syncError: "temporary a failure", syncStatus: "modified" }),
      expect.objectContaining({ id: "b", syncStatus: "synced" }),
    ])
    expect(reopened?.notes.filter((item) => item.syncError)).toHaveLength(1)

    const retryWrite = vi.fn().mockResolvedValue({ revision: '"v3"' })
    await syncWebDavNoteQueue({
      adapter: adapter({ writeTextFile: retryWrite }),
      noteIds: new Set(["a"]),
      notes: reopened!.notes,
      onCheckpoint: async (checkpoint) => (await saveVaultNoteQueueCheckpoint(cacheId, checkpoint)).notes,
    })
    expect(retryWrite).toHaveBeenCalledOnce()
    expect(retryWrite).toHaveBeenCalledWith("/Swell/a.md", "正文 a", '"v1"')
  })

  it("真实缓存检查点在失败 a 后连续成功 b、c 仍保留唯一失败", async () => {
    const cacheId = `mixed-three-${crypto.randomUUID()}`
    const notes = [note("a"), note("b"), note("c")]
    await saveVaultCache({ activeNoteId: "a", id: cacheId, label: "三项混合", notes, savedAt: 1, sourceKind: "webdav" })
    const result = await syncWebDavNoteQueue({
      adapter: adapter({
        writeTextFile: vi.fn(async (path: string) => {
          if (path.endsWith("/a.md")) throw new Error("temporary a failure")
          return { revision: '"v2"' }
        }),
      }),
      notes,
      onCheckpoint: async (checkpoint) => (await saveVaultNoteQueueCheckpoint(cacheId, checkpoint)).notes,
    })
    const reopened = await loadVaultCache(cacheId, { hydrate: "all" })
    expect(result.notes.find((item) => item.id === "a")).toMatchObject({ syncError: "temporary a failure", syncStatus: "modified" })
    expect(result.notes.filter((item) => item.syncStatus === "synced").map((item) => item.id)).toEqual(["b", "c"])
    expect(reopened?.notes.filter((item) => item.syncError).map((item) => item.id)).toEqual(["a"])
  })

  it("真实缓存检查点在冲突 a 后成功 b 仍保留 a 的 conflict", async () => {
    const cacheId = `mixed-conflict-${crypto.randomUUID()}`
    const notes = [note("a"), note("b")]
    await saveVaultCache({ activeNoteId: "a", id: cacheId, label: "冲突混合", notes, savedAt: 1, sourceKind: "webdav" })
    const result = await syncWebDavNoteQueue({
      adapter: adapter({
        writeTextFile: vi.fn(async (path: string) => {
          if (path.endsWith("/a.md")) throw new VaultConflictError(path)
          return { revision: '"v2"' }
        }),
      }),
      notes,
      onCheckpoint: async (checkpoint) => (await saveVaultNoteQueueCheckpoint(cacheId, checkpoint)).notes,
    })
    const reopened = await loadVaultCache(cacheId, { hydrate: "all" })
    expect(result.notes.find((item) => item.id === "a")).toMatchObject({ syncError: undefined, syncStatus: "conflict" })
    expect(reopened?.notes.find((item) => item.id === "a")).toMatchObject({ syncError: undefined, syncStatus: "conflict" })
    expect(reopened?.notes.find((item) => item.id === "b")).toMatchObject({ syncStatus: "synced" })
  })
})
