import { describe, expect, it, vi } from "vitest"

import { syncWebDavNoteQueue } from "./webdav-note-queue"
import { VaultConflictError, type VaultAdapter } from "@/services/vault/vault-adapter"
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
})
