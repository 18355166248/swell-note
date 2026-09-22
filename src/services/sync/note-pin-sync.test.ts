import "fake-indexeddb/auto"
import { describe, expect, it, vi } from "vitest"
import { loadVaultCache, saveVaultCache } from "@/services/cache/vault-cache"
import { parseNotePinsDocument } from "@/services/preferences/note-pins-document"
import type { VaultAdapter, VaultFolderOrderStore } from "@/services/vault/vault-adapter"
import { WebDavRevisionConflictError } from "@/services/webdav-client"
import type { Note } from "@/types/note"
import { hasPendingNotePin, notePinQueueKey, syncNotePins } from "./note-pin-sync"

function note(name: string, patch: Partial<Note> = {}): Note {
  return { id: name, title: name, content: "正文", preview: "", updatedAt: "昨天", modifiedAt: 123,
    starred: false, source: "webdav", remotePath: `/vault/${name}.md`, syncStatus: "synced", ...patch }
}

function remote(initial: string[] | null = null) {
  let body = initial === null ? null : JSON.stringify({ schemaVersion: 1, pins: initial, extra: "保留扩展" })
  let version = 1
  const write = (next: string) => { body = next; version += 1; return { etag: `"${version}"`, etagWeak: false } }
  const store: VaultFolderOrderStore = {
    ensureMetadataDirectory: vi.fn(async () => undefined),
    verifyRoot: vi.fn(async () => true),
    readDocument: vi.fn(async () => body === null ? null : ({ bytes: new TextEncoder().encode(body), etag: `"${version}"`, etagWeak: false })),
    createDocument: vi.fn(async (next) => {
      if (body !== null) throw new WebDavRevisionConflictError("pins")
      return write(next)
    }),
    updateDocument: vi.fn(async (next, etag) => {
      if (etag !== `"${version}"`) throw new WebDavRevisionConflictError("pins")
      return write(next)
    }),
  }
  const adapter = { kind: "webdav", notePinStore: store, getDisplayPath: (path: string) => path.replace(/^\/vault\//, "") } as VaultAdapter
  return { adapter, store, set: write, pins: () => body ? JSON.parse(body).pins : null, body: () => body }
}

describe("跨端置顶同步", () => {
  it("A 置顶上传、B 拉取并取消、A 拉回；正文与修改时间不变", async () => {
    const server = remote()
    const a = await syncNotePins({ adapter: server.adapter, notes: [note("a", { pinned: true, pinPending: true })], allowUpload: true })
    expect(server.pins()).toEqual(["a.md"])
    let b = await syncNotePins({ adapter: server.adapter, notes: [note("a")], allowUpload: true })
    expect(b[0].pinned).toBe(true)
    b = await syncNotePins({ adapter: server.adapter, notes: [{ ...b[0], pinned: false, pinPending: true }], allowUpload: true })
    expect(server.pins()).toEqual([])
    const result = await syncNotePins({ adapter: server.adapter, notes: a, allowUpload: true })
    expect(result[0]).toMatchObject({ pinned: false, pinPending: false, content: "正文", modifiedAt: 123, syncStatus: "synced" })
    expect(hasPendingNotePin(b[0])).toBe(false)
  })

  it("离线操作经缓存恢复；合并其他设备的不同笔记，不覆盖未扫描成员", async () => {
    const server = remote(["other.md", "unseen.md"])
    const original = note("a", { pinned: true, pinPending: true })
    await saveVaultCache({ id: "pin-test", activeNoteId: "a", label: "测试", notes: [original], savedAt: 1, sourceKind: "webdav" })
    const cached = await loadVaultCache("pin-test")
    const result = await syncNotePins({ adapter: server.adapter, notes: cached!.notes, allowUpload: true })
    expect(server.pins()).toEqual(["a.md", "other.md", "unseen.md"])
    expect(JSON.parse(server.body()!).extra).toBe("保留扩展")
    expect(hasPendingNotePin(result[0])).toBe(false)
  })

  it("412 后重读合并，不丢另一端刚写入的条目", async () => {
    const server = remote([])
    vi.mocked(server.store.updateDocument).mockImplementationOnce(async () => {
      server.set(JSON.stringify({ schemaVersion: 1, pins: ["b.md"] }))
      throw new WebDavRevisionConflictError("pins")
    })
    await syncNotePins({ adapter: server.adapter, notes: [note("a", { pinned: true, pinPending: true })], allowUpload: true })
    expect(server.pins()).toEqual(["a.md", "b.md"])
    expect(server.store.updateDocument).toHaveBeenCalledTimes(2)
  })

  it("上传失败保留意图，下次同步可重试，失败不改变自动重试队列签名", async () => {
    const server = remote([])
    const notes = [note("a", { pinned: true, pinPending: true })]
    const key = notePinQueueKey(notes)
    vi.mocked(server.store.updateDocument).mockRejectedValueOnce(new Error("离线"))
    await expect(syncNotePins({ adapter: server.adapter, notes, allowUpload: true })).rejects.toThrow("离线")
    expect(notePinQueueKey(notes)).toBe(key)
    expect(hasPendingNotePin(notes[0])).toBe(true)
    await syncNotePins({ adapter: server.adapter, notes, allowUpload: true })
    expect(server.pins()).toEqual(["a.md"])
  })

  it("上传已生效但响应丢失时，下次按相同内容确认，不重复 PUT", async () => {
    const server = remote([])
    const notes = [note("a", { pinned: true, pinPending: true })]
    vi.mocked(server.store.updateDocument).mockImplementationOnce(async (body) => {
      server.set(body)
      throw new Error("响应丢失")
    })
    await expect(syncNotePins({ adapter: server.adapter, notes, allowUpload: true })).rejects.toThrow()
    const result = await syncNotePins({ adapter: server.adapter, notes, allowUpload: true })
    expect(server.store.updateDocument).toHaveBeenCalledTimes(1)
    expect(result[0].pinPending).toBe(false)
  })

  it("结构阻断时只拉取干净条目，待同步置顶不丢失也不上传", async () => {
    const server = remote(["b.md"])
    const result = await syncNotePins({ adapter: server.adapter, notes: [note("a", { pinned: true, pinPending: true }), note("b")], allowUpload: false })
    expect(result[0].pinPending).toBe(true)
    expect(result[1].pinned).toBe(true)
    expect(server.store.updateDocument).not.toHaveBeenCalled()
  })

  it("重命名后迁移路径，重复提交可恢复；本机未修改时尊重远端取消置顶", async () => {
    const server = remote(["old.md"])
    const moved = note("new", { pinned: true, pinSynced: { remotePath: "/vault/old.md", pinned: true } })
    await syncNotePins({ adapter: server.adapter, notes: [moved], allowUpload: true })
    expect(server.pins()).toEqual(["new.md"])
    const result = await syncNotePins({ adapter: server.adapter, notes: [moved], allowUpload: true })
    expect(result[0].pinned).toBe(true)
    server.set(JSON.stringify({ schemaVersion: 1, pins: [] }))
    expect((await syncNotePins({ adapter: server.adapter, notes: [moved], allowUpload: true }))[0].pinned).toBe(false)
  })

  it("旧本机置顶仅在远端配置缺失时迁移；已有配置时采用云端", async () => {
    const notes = [note("a", { pinned: true })]
    const empty = remote()
    await syncNotePins({ adapter: empty.adapter, notes, allowUpload: true })
    expect(empty.pins()).toEqual(["a.md"])
    const existing = remote([])
    const result = await syncNotePins({ adapter: existing.adapter, notes, allowUpload: true })
    expect(result[0].pinned).toBe(false)
    expect(existing.store.updateDocument).not.toHaveBeenCalled()
  })

  it.each([false, true])("重命名源路径被新笔记复用时保留两篇置顶，不依赖遍历顺序（反转=%s）", async (reverse) => {
    const server = remote(["a.md"])
    const notes = [
      note("a", { pinned: true, pinPending: true }),
      note("b", { pinned: true, pinSynced: { remotePath: "/vault/a.md", pinned: true } }),
    ]
    const result = await syncNotePins({ adapter: server.adapter, notes: reverse ? notes.reverse() : notes, allowUpload: true })
    expect(server.pins()).toEqual(["a.md", "b.md"])
    expect(result.every((note) => note.pinned && !note.pinPending)).toBe(true)
  })

  it("连续迁移 A→B、B→C 时两篇置顶都保留", async () => {
    const server = remote(["a.md", "b.md"])
    await syncNotePins({ adapter: server.adapter, notes: [
      note("b", { pinned: true, pinSynced: { remotePath: "/vault/a.md", pinned: true } }),
      note("c", { pinned: true, pinSynced: { remotePath: "/vault/b.md", pinned: true } }),
    ], allowUpload: true })
    expect(server.pins()).toEqual(["b.md", "c.md"])
  })

  it("只读拉取或取消不会创建元数据目录，本地库不上传", async () => {
    const server = remote()
    const notes = [note("a", { pinned: true, pinPending: true })]
    await syncNotePins({ adapter: server.adapter, notes, allowUpload: false })
    await syncNotePins({ adapter: server.adapter, notes, allowUpload: true, isCancelled: () => true })
    await syncNotePins({ adapter: { ...server.adapter, kind: "browser" }, notes, allowUpload: true })
    expect(server.store.createDocument).not.toHaveBeenCalled()
    expect(server.store.ensureMetadataDirectory).not.toHaveBeenCalled()
  })

  it("弱 ETag、根目录丢失都保留修改，不强写远端", async () => {
    const server = remote([])
    vi.mocked(server.store.readDocument).mockResolvedValue({ bytes: new TextEncoder().encode('{"schemaVersion":1,"pins":[]}'), etag: 'W/"1"', etagWeak: true })
    await expect(syncNotePins({ adapter: server.adapter, notes: [note("a", { pinned: true, pinPending: true })], allowUpload: true })).rejects.toThrow("ETag")
    expect(server.store.updateDocument).not.toHaveBeenCalled()
    vi.mocked(server.store.readDocument).mockResolvedValue(null)
    vi.mocked(server.store.verifyRoot).mockResolvedValue(false)
    await expect(syncNotePins({ adapter: server.adapter, notes: [note("a")], allowUpload: true })).rejects.toThrow("笔记库")
  })

  it.each([
    '{', '{"schemaVersion":2,"pins":[]}', '{"schemaVersion":1,"pins":["../a.md"]}',
    '{"schemaVersion":1,"pins":["/absolute.md"]}', '{"schemaVersion":1,"pins":["C:\\\\a.md"]}',
  ])("非法或新版配置不覆盖：%s", async (body) => {
    const server = remote([])
    server.set(body)
    await expect(syncNotePins({ adapter: server.adapter, notes: [note("a", { pinned: true, pinPending: true })], allowUpload: true })).rejects.toThrow()
    expect(server.store.updateDocument).not.toHaveBeenCalled()
  })

  it("配置按字节限制，合法中文路径稳定去重", () => {
    expect(parseNotePinsDocument(new TextEncoder().encode('{"schemaVersion":1,"pins":["项目/笔记.md","项目/笔记.md"]}')).pins).toEqual(["项目/笔记.md"])
    expect(() => parseNotePinsDocument(new Uint8Array(256 * 1024 + 1))).toThrow("大小")
  })
})
