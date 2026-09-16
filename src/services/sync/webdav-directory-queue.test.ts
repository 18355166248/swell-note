import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"

import { createVaultCacheId, loadVaultCache, saveVaultCache, type VaultCacheSnapshot } from "@/services/cache/vault-cache"
import { isPendingDirectoryTree, remapWebDavNoteForDirectory } from "@/services/search/folder-rename"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { syncWebDavDirectoryQueue } from "./webdav-directory-queue"
import { syncWebDavNoteQueue } from "./webdav-note-queue"

function adapter(identity: string, overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    cacheIdentity: identity,
    cacheLabel: identity,
    displayName: "测试 WebDAV",
    ensureDirectory: vi.fn(async () => undefined),
    getStoragePath: (path) => `/Swell/${path}`,
    kind: "webdav",
    listMarkdownFiles: vi.fn(async () => []),
    moveDirectory: vi.fn(async () => undefined),
    readOnly: false,
    readTextFile: vi.fn(async () => ({ content: "", revision: '"remote"' })),
    writeTextFile: vi.fn(async () => ({ revision: '"written"' })),
    ...overrides,
  }
}

function snapshot(id: string, patch: Partial<VaultCacheSnapshot> = {}): VaultCacheSnapshot {
  return {
    activeNoteId: "",
    directories: [],
    id,
    label: "测试库",
    notes: [],
    pendingDirectories: [],
    pendingDirectoryMoves: [],
    savedAt: 1,
    sourceKind: "webdav",
    ...patch,
  }
}

describe("WebDAV directory queue", () => {
  it("缓存标识或适配器身份不匹配时不发送任何远端请求", async () => {
    const source = adapter("webdav:B")
    await expect(syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: "webdav:A",
      cacheId: await createVaultCacheId("webdav:A"),
      isScopeCurrent: () => true,
      snapshot: snapshot("A", { pendingDirectories: ["待建"] }),
    })).rejects.toThrow("不属于同一笔记库")
    expect(source.ensureDirectory).not.toHaveBeenCalled()
    expect(source.moveDirectory).not.toHaveBeenCalled()

    await expect(syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: "webdav:B",
      cacheId: await createVaultCacheId("webdav:A"),
      isScopeCurrent: () => true,
      snapshot: snapshot("A", { pendingDirectories: ["同名目录"] }),
    })).rejects.toThrow("不属于同一笔记库")
    expect(source.ensureDirectory).not.toHaveBeenCalled()
  })

  it("连续 A→B→C 逐阶段落盘且完成后不会复活 MOVE", async () => {
    const identity = "webdav:chain"
    const cacheId = await createVaultCacheId(identity)
    const source = adapter(identity)
    const persisted: VaultCacheSnapshot[] = []
    const first = await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async (next) => { persisted.push(structuredClone(next)) },
      snapshot: snapshot(cacheId, {
        pendingDirectoryMoves: [
          { id: "A-B", sourceFolder: "A", targetFolder: "B" },
          { id: "B-C", sourceFolder: "B", targetFolder: "C" },
        ],
      }),
    })

    expect(source.moveDirectory).toHaveBeenNthCalledWith(1, "/Swell/A", "/Swell/B", "A-B")
    expect(source.moveDirectory).toHaveBeenNthCalledWith(2, "/Swell/B", "/Swell/C", "B-C")
    expect(persisted.map((item) => item.pendingDirectoryMoves)).toEqual([
      [expect.objectContaining({ id: "A-B", moved: true }), expect.objectContaining({ id: "B-C" })],
      [expect.objectContaining({ id: "B-C" })],
      [expect.objectContaining({ id: "B-C", moved: true })],
      [],
    ])
    expect(first.snapshot.pendingDirectoryMoves).toEqual([])

    await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: first.snapshot,
    })
    expect(source.moveDirectory).toHaveBeenCalledTimes(2)
  })

  it("MOVE 等待期间的新正文保存不会被随后结构检查点覆盖", async () => {
    const identity = "webdav:concurrent-body-save"
    const cacheId = await createVaultCacheId(identity)
    let releaseMove!: () => void
    let enteredMove!: () => void
    const entered = new Promise<void>((resolve) => { enteredMove = resolve })
    const gate = new Promise<void>((resolve) => { releaseMove = resolve })
    const source = adapter(identity, {
      moveDirectory: vi.fn(async () => { enteredMove(); await gate }),
    })
    const stale = snapshot(cacheId, {
      notes: [{
        content: "OLD",
        contentLoaded: true,
        folder: "Other",
        id: "webdav:/Swell/Other/n.md",
        preview: "OLD",
        remotePath: "/Swell/Other/n.md",
        source: "webdav",
        starred: false,
        syncStatus: "modified",
        title: "n",
        updatedAt: "待同步",
      }],
      pendingDirectoryMoves: [{ id: "move", sourceFolder: "A", targetFolder: "B" }],
    })
    await saveVaultCache(stale)
    const published: string[] = []
    const running = syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      onSnapshot: (next) => { published.push(next.notes[0].content) },
      snapshot: stale,
    })
    await entered
    await saveVaultCache({ ...stale, notes: [{ ...stale.notes[0], content: "NEW DURING MOVE" }], savedAt: 2 })
    releaseMove()
    await running

    expect(published).toEqual(["NEW DURING MOVE", "NEW DURING MOVE"])
    await expect(loadVaultCache(cacheId, { hydrate: "all" })).resolves.toMatchObject({
      notes: [expect.objectContaining({ content: "NEW DURING MOVE" })],
      pendingDirectoryMoves: [],
    })
  })

  it("父目录与其子目录连续改名按持久化顺序各执行一次", async () => {
    const identity = "webdav:nested-chain"
    const cacheId = await createVaultCacheId(identity)
    const source = adapter(identity)
    const result = await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: snapshot(cacheId, { pendingDirectoryMoves: [
        { id: "parent", sourceFolder: "A", targetFolder: "B" },
        { id: "child", sourceFolder: "B / 子", targetFolder: "B / 新子" },
      ] }),
    })
    expect(source.moveDirectory).toHaveBeenNthCalledWith(1, "/Swell/A", "/Swell/B", "parent")
    expect(source.moveDirectory).toHaveBeenNthCalledWith(2, "/Swell/B/子", "/Swell/B/新子", "child")
    expect(result.snapshot.pendingDirectoryMoves).toEqual([])
  })

  it("父子目录链带修改正文时按每个阶段的真实物理路径核对版本", async () => {
    const identity = "webdav:nested-with-note"
    const cacheId = await createVaultCacheId(identity)
    const files = new Map([["/Swell/A/sub/n.md", { content: "BASE", revision: '"v1"' }]])
    const calls: string[] = []
    const source = adapter(identity, {
      moveDirectory: vi.fn(async (from, to) => {
        calls.push(`MOVE ${from} ${to}`)
        for (const [path, document] of [...files]) {
          if (!path.startsWith(`${from}/`)) continue
          files.delete(path)
          files.set(`${to}${path.slice(from.length)}`, { ...document, revision: document.revision === '"v1"' ? '"v2"' : '"v3"' })
        }
      }),
      readTextFile: vi.fn(async (path) => {
        calls.push(`GET ${path}`)
        const document = files.get(path)
        if (!document) throw new Error(`404 ${path}`)
        return document
      }),
    })
    const result = await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: snapshot(cacheId, {
        notes: [{
          baseContent: "BASE",
          content: "LOCAL EDIT",
          contentLoaded: true,
          folder: "B / new",
          id: "webdav:/Swell/B/new/n.md",
          preview: "LOCAL EDIT",
          remotePath: "/Swell/B/new/n.md",
          revision: '"v1"',
          source: "webdav",
          starred: false,
          syncStatus: "modified",
          title: "n",
          updatedAt: "待同步",
        }],
        pendingDirectoryMoves: [
          { id: "parent", sourceFolder: "A", targetFolder: "B" },
          { id: "child", sourceFolder: "B / sub", targetFolder: "B / new" },
        ],
      }),
    })

    expect(calls).toEqual([
      "MOVE /Swell/A /Swell/B",
      "GET /Swell/B/sub/n.md",
      "MOVE /Swell/B/sub /Swell/B/new",
      "GET /Swell/B/new/n.md",
    ])
    expect(result.snapshot.pendingDirectoryMoves).toEqual([])
    expect(result.snapshot.notes[0]).toMatchObject({ revision: '"v3"', syncStatus: "modified" })
  })

  it("未同步目录含移入笔记时先 MKCOL 新目标再做文件 MOVE，不请求不存在的目录 MOVE", async () => {
    const identity = "webdav:new-folder-with-moved-note"
    const cacheId = await createVaultCacheId(identity)
    const events: string[] = []
    const source = adapter(identity, {
      ensureDirectory: vi.fn(async (path) => { events.push(`MKCOL ${path}`) }),
      moveDirectory: vi.fn(async (path, target) => { events.push(`MOVE_DIR ${path} ${target}`) }),
      moveTextFile: vi.fn(async (path, target) => {
        events.push(`MOVE_FILE ${path} ${target}`)
        return { path: target, revision: '"moved"' }
      }),
    })
    const moveRemoteDirectory = !isPendingDirectoryTree("A", ["A"])
    const note = remapWebDavNoteForDirectory({
      baseContent: "正文",
      content: "正文",
      folder: "A",
      id: "webdav:/Swell/A/n.md",
      pendingOperation: "move",
      preview: "正文",
      previousRemotePath: "/Swell/X/n.md",
      remotePath: "/Swell/A/n.md",
      revision: '"old"',
      source: "webdav",
      starred: false,
      syncStatus: "modified",
      title: "n",
      updatedAt: "待同步",
      writeContentAfterMove: false,
    }, {
      moveRemoteDirectory,
      sourceDirectory: "/Swell/A",
      sourceFolder: "A",
      targetDirectory: "/Swell/B",
      targetFolder: "B",
    })
    const directories = await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: snapshot(cacheId, { notes: [note], pendingDirectories: ["B"] }),
    })
    await syncWebDavNoteQueue({ adapter: source, notes: directories.snapshot.notes })

    expect(source.moveDirectory).not.toHaveBeenCalled()
    expect(events).toEqual(["MKCOL /Swell/B", "MKCOL /Swell/B", "MOVE_FILE /Swell/X/n.md /Swell/B/n.md"])
  })

  it("待删除墓碑随父目录 MOVE 后只删除新的物理路径", async () => {
    const identity = "webdav:delete-after-directory-move"
    const cacheId = await createVaultCacheId(identity)
    const deletedPaths: string[] = []
    const source = adapter(identity, {
      deleteTextFile: vi.fn(async (path) => { deletedPaths.push(path) }),
      readTextFile: vi.fn(async () => ({ content: "待删除正文", revision: '"after-move"' })),
    })
    const tombstone = remapWebDavNoteForDirectory({
      baseContent: "待删除正文",
      content: "待删除正文",
      folder: "旧",
      id: "webdav:/Swell/旧/delete.md",
      pendingOperation: "delete",
      preview: "待删除正文",
      remotePath: "/Swell/旧/delete.md",
      revision: '"before-move"',
      source: "webdav",
      starred: false,
      syncStatus: "modified",
      title: "delete",
      updatedAt: "待同步",
    }, {
      moveRemoteDirectory: true,
      sourceDirectory: "/Swell/旧",
      sourceFolder: "旧",
      targetDirectory: "/Swell/新",
      targetFolder: "新",
    })
    const directories = await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: snapshot(cacheId, {
        notes: [tombstone],
        pendingDirectoryMoves: [{ id: "rename", sourceFolder: "旧", targetFolder: "新" }],
      }),
    })
    await syncWebDavNoteQueue({ adapter: source, notes: directories.snapshot.notes })
    expect(deletedPaths).toEqual(["/Swell/新/delete.md"])
  })

  it("笔记先移出 A 再改 A→B 时，从 B 的新物理源继续文件 MOVE", async () => {
    const identity = "webdav:outgoing-before-parent-rename"
    const cacheId = await createVaultCacheId(identity)
    const files = new Map([["/Swell/A/n.md", { content: "BASE", revision: '"v1"' }]])
    const calls: string[] = []
    const source = adapter(identity, {
      ensureDirectory: vi.fn(async (path) => { calls.push(`MKCOL ${path}`) }),
      moveDirectory: vi.fn(async (from, to) => {
        calls.push(`MOVE_DIR ${from} ${to}`)
        const document = files.get("/Swell/A/n.md")!
        files.delete("/Swell/A/n.md")
        files.set("/Swell/B/n.md", { ...document, revision: '"v2"' })
      }),
      moveTextFile: vi.fn(async (from, to, revision) => {
        calls.push(`MOVE_FILE ${from} ${to} ${revision}`)
        const document = files.get(from)
        if (!document) throw new Error(`404 ${from}`)
        files.delete(from)
        files.set(to, { ...document, revision: '"v3"' })
        return { path: to, revision: '"v3"' }
      }),
      readTextFile: vi.fn(async (path) => {
        calls.push(`GET ${path}`)
        const document = files.get(path)
        if (!document) throw new Error(`404 ${path}`)
        return document
      }),
    })
    const outgoing = remapWebDavNoteForDirectory({
      baseContent: "BASE",
      content: "BASE",
      folder: "X",
      id: "webdav:/Swell/X/n.md",
      pendingOperation: "move",
      preview: "BASE",
      previousRemotePath: "/Swell/A/n.md",
      remotePath: "/Swell/X/n.md",
      revision: '"v1"',
      source: "webdav",
      starred: false,
      syncStatus: "modified",
      title: "n",
      updatedAt: "待同步",
      writeContentAfterMove: false,
    }, {
      moveRemoteDirectory: true,
      sourceDirectory: "/Swell/A",
      sourceFolder: "A",
      targetDirectory: "/Swell/B",
      targetFolder: "B",
    })
    const directoryResult = await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: snapshot(cacheId, {
        notes: [outgoing],
        pendingDirectoryMoves: [{ id: "parent", sourceFolder: "A", targetFolder: "B" }],
      }),
    })
    const noteResult = await syncWebDavNoteQueue({ adapter: source, notes: directoryResult.snapshot.notes })

    expect(calls).toEqual([
      "MOVE_DIR /Swell/A /Swell/B",
      "GET /Swell/B/n.md",
      "MKCOL /Swell/X",
      'MOVE_FILE /Swell/B/n.md /Swell/X/n.md "v2"',
    ])
    expect(noteResult.notes[0]).toMatchObject({ previousRemotePath: undefined, revision: '"v3"', syncStatus: "synced" })
  })

  it("远端 await 后切库只保存来源库 moved 检查点，不更新 UI 或继续下一请求", async () => {
    const identity = "webdav:scope"
    const cacheId = await createVaultCacheId(identity)
    let current = true
    const source = adapter(identity, {
      moveDirectory: vi.fn(async () => { current = false }),
    })
    const persisted: VaultCacheSnapshot[] = []
    const onSnapshot = vi.fn()
    const result = await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => current,
      onSnapshot,
      persist: async (next) => { persisted.push(structuredClone(next)) },
      snapshot: snapshot(cacheId, {
        pendingDirectoryMoves: [
          { id: "first", sourceFolder: "A", targetFolder: "B" },
          { id: "second", sourceFolder: "C", targetFolder: "D" },
        ],
      }),
    })

    expect(result.interrupted).toBe(true)
    expect(source.moveDirectory).toHaveBeenCalledTimes(1)
    expect(persisted).toHaveLength(1)
    expect(persisted[0].pendingDirectoryMoves?.[0]).toMatchObject({ id: "first", moved: true })
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it("检查点落盘或凭证清理期间切库都不会发出后继 MOVE", async () => {
    const identity = "webdav:await-boundaries"
    const cacheId = await createVaultCacheId(identity)

    let currentDuringPersist = true
    const persistAdapter = adapter(identity)
    const persistResult = await syncWebDavDirectoryQueue({
      adapter: persistAdapter,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => currentDuringPersist,
      persist: async () => { currentDuringPersist = false },
      snapshot: snapshot(cacheId, { pendingDirectoryMoves: [
        { id: "one", sourceFolder: "A", targetFolder: "B" },
        { id: "two", sourceFolder: "B", targetFolder: "C" },
      ] }),
    })
    expect(persistResult.interrupted).toBe(true)
    expect(persistAdapter.moveDirectory).toHaveBeenCalledTimes(1)

    let currentDuringCleanup = true
    const cleanupAdapter = adapter(identity, {
      completeDirectoryMove: vi.fn(async () => { currentDuringCleanup = false }),
    })
    const cleanupResult = await syncWebDavDirectoryQueue({
      adapter: cleanupAdapter,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => currentDuringCleanup,
      persist: async () => undefined,
      snapshot: snapshot(cacheId, { pendingDirectoryMoves: [
        { id: "one", sourceFolder: "A", targetFolder: "B" },
        { id: "two", sourceFolder: "B", targetFolder: "C" },
      ] }),
    })
    expect(cleanupResult.interrupted).toBe(true)
    expect(cleanupAdapter.completeDirectoryMove).toHaveBeenCalledTimes(1)
    expect(cleanupAdapter.moveDirectory).toHaveBeenCalledTimes(1)
  })

  it("MOVE 后远端正文仍等于 base 时推进版本，变化时转为冲突", async () => {
    const identity = "webdav:revision"
    const cacheId = await createVaultCacheId(identity)
    const makeSnapshot = () => snapshot(cacheId, {
      notes: [{
        baseContent: "远端基线",
        content: "本地修改",
        contentLoaded: true,
        folder: "新",
        id: "webdav:/Swell/新/a.md",
        preview: "本地修改",
        previousRemotePath: "/Swell/新/a.md",
        remotePath: "/Swell/新/a.md",
        revision: '"old"',
        source: "webdav",
        starred: false,
        syncStatus: "modified",
        title: "a",
        updatedAt: "待同步",
      }],
      pendingDirectoryMoves: [{ id: "move", sourceFolder: "旧", targetFolder: "新" }],
    })

    const unchanged = adapter(identity, {
      readTextFile: vi.fn(async () => ({ content: "远端基线", revision: '"new"' })),
    })
    const advanced = await syncWebDavDirectoryQueue({
      adapter: unchanged,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: makeSnapshot(),
    })
    expect(unchanged.readTextFile).toHaveBeenCalledWith("/Swell/新/a.md")
    expect(advanced.snapshot.notes[0]).toMatchObject({ revision: '"new"', syncStatus: "modified" })

    const stableEtag = adapter(identity, {
      readTextFile: vi.fn(async () => ({ content: "远端基线", revision: '"old"' })),
    })
    const stable = await syncWebDavDirectoryQueue({
      adapter: stableEtag,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: makeSnapshot(),
    })
    expect(stable.snapshot.notes[0]).toMatchObject({ revision: '"old"', syncStatus: "modified" })

    const changed = adapter(identity, {
      readTextFile: vi.fn(async () => ({ content: "另一台设备的修改", revision: '"other"' })),
    })
    const conflicted = await syncWebDavDirectoryQueue({
      adapter: changed,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: makeSnapshot(),
    })
    expect(conflicted.snapshot.notes[0]).toMatchObject({ revision: '"old"', syncStatus: "conflict" })
  })

  it("重启恢复 moved 阶段时只核对并出队，不重复 MOVE", async () => {
    const identity = "webdav:resume"
    const cacheId = await createVaultCacheId(identity)
    const source = adapter(identity)
    const result = await syncWebDavDirectoryQueue({
      adapter: source,
      adapterIdentity: identity,
      cacheId,
      isScopeCurrent: () => true,
      persist: async () => undefined,
      snapshot: snapshot(cacheId, {
        pendingDirectoryMoves: [{ id: "already-moved", moved: true, sourceFolder: "旧", targetFolder: "新" }],
      }),
    })
    expect(source.moveDirectory).not.toHaveBeenCalled()
    expect(result.snapshot.pendingDirectoryMoves).toEqual([])
  })
})
