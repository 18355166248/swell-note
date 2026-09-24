import { describe, expect, it, vi } from "vitest"
import { batchWebDavPath, changeBatchTags, organizeNotes, type BatchOrganizeState } from "./batch-organize"
import type { Note } from "@/types/note"
import type { VaultAdapter } from "./vault-adapter"

function note(id: string, patch: Partial<Note> = {}): Note {
  return { id, title: id, content: "# 正文", contentLoaded: true, starred: false, preview: "正文", updatedAt: "刚刚", remotePath: `${id}.md`, ...patch }
}
function setup(notes: Note[], webdav = false) {
  let state: BatchOrganizeState = { notes, trash: [], activeNoteId: notes[0]?.id ?? "" }
  const files = new Map(notes.map((n) => [n.remotePath!, { content: n.content, revision: "1" }]))
  const adapter: VaultAdapter = {
    kind: "browser", readOnly: false, displayName: "test", cacheIdentity: "test", cacheLabel: "test",
    listMarkdownFiles: async () => [],
    readTextFile: vi.fn(async (path) => { if (!files.has(path)) throw new Error("missing"); return files.get(path)! }),
    writeTextFile: vi.fn(async (path, content, expected) => {
      if (files.get(path)?.revision !== expected) throw new Error("conflict")
      files.set(path, { content, revision: "2" }); return { revision: "2" }
    }),
    moveTextFile: vi.fn(async (path, target, expected) => {
      if (files.has(target)) throw new Error("collision")
      if (files.get(path)?.revision !== expected) throw new Error("conflict")
      files.set(target, files.get(path)!); files.delete(path); return { path: target, revision: "1" }
    }),
  }
  const input = { ids: notes.map((n) => n.id), initial: state, adapter, webdav,
    resolvePath: (path: string) => path, blocked: (_note: Note) => false, isCurrent: () => true,
    loadDocument: async (_note: Note): Promise<{ content: string; baseContent?: string } | undefined> => undefined,
    beforeWrite: vi.fn(async () => {}), commit: vi.fn(async (next: BatchOrganizeState) => { state = next }),
  }
  return { input, files, get state() { return state } }
}
describe("batch organize", () => {
  it("adds/removes selected tags without dropping unknown metadata or body", () => {
    const content = '---\nauthor: Alice\ntags: ["旧标签", "保留"]\n---\n正文'
    const added = changeBatchTags(content, { kind: "add-tags", tags: ["新标签", "保留"] })
    expect(added).toContain('tags: ["旧标签", "保留", "新标签"]')
    expect(added).toContain("author: Alice")
    expect(changeBatchTags(added, { kind: "remove-tags", tags: ["旧标签"] })).toContain('tags: ["保留", "新标签"]')
    expect(added.endsWith("正文")).toBe(true)
  })
  it("continues safe items and skips dirty files without overwriting them", async () => {
    const test = setup([note("a"), note("b"), note("c")])
    test.files.set("b.md", { content: "外部编辑", revision: "2" })
    const report = await organizeNotes({ ...test.input, action: { kind: "add-tags", tags: ["工作"] } })
    expect(report.succeededIds).toEqual(["a", "c"])
    expect(report.issues).toHaveLength(1)
    expect(test.files.get("b.md")!.content).toBe("外部编辑")
    expect(test.state.notes[2].tags).toEqual(["工作"])
  })
  it("moves files, fixes incoming and outgoing links, and skips collisions", async () => {
    const test = setup([note("a", { content: "![图](attachments/x.png)" }), note("b", { content: "[A](a.md)" }), note("existing", { remotePath: "目标/b.md" })])
    const report = await organizeNotes({ ...test.input, ids: ["a", "b"], action: { kind: "move", folder: "目标" } })
    expect(report.succeededIds).toEqual(["a"])
    expect(test.files.get("目标/a.md")!.content).toBe("![图](../attachments/x.png)")
    expect(decodeURI(test.files.get("b.md")!.content)).toBe("[A](目标/a.md)")
    expect(test.files.has("a.md")).toBe(false)
    expect(test.state.activeNoteId).toBe("browser:目标/a.md")
    expect(report.issues.join()).toContain("同名")
  })
  it("moves all selected files to distinct recoverable trash entries", async () => {
    const test = setup([note("a"), note("b")])
    const report = await organizeNotes({ ...test.input, action: { kind: "delete" } })
    expect(report.succeededIds).toEqual(["a", "b"])
    expect(test.state.notes).toEqual([])
    expect(test.state.trash).toHaveLength(2)
    expect(test.state.trash.every((entry) => test.files.has(entry.trashedPath!))).toBe(true)
  })
  it("queues offline moves with original path and never writes remote files", async () => {
    const test = setup([note("a", { source: "webdav", syncStatus: "synced" })], true)
    const report = await organizeNotes({ ...test.input, action: { kind: "move", folder: "目标" } })
    expect(report.succeededIds).toEqual(["a"])
    expect(test.state.notes[0]).toMatchObject({ pendingOperation: "move", previousRemotePath: "a.md", remotePath: "目标/a.md", syncStatus: "modified" })
    expect(test.input.adapter.moveTextFile).not.toHaveBeenCalled()
    expect(test.input.adapter.writeTextFile).not.toHaveBeenCalled()
  })
  it("loads cached webdav bodies and preserves move intent when changing tags", async () => {
    const test = setup([note("a", { contentLoaded: false, readOnly: true, pendingOperation: "move", previousRemotePath: "old.md" })], true)
    await organizeNotes({ ...test.input, loadDocument: async () => ({ content: "缓存正文", baseContent: "云端基线" }), action: { kind: "add-tags", tags: ["工作"] } })
    expect(test.state.notes[0]).toMatchObject({ tags: ["工作"], baseContent: "云端基线", pendingOperation: "move", writeContentAfterMove: true, previousRemotePath: "old.md" })
    expect(test.state.notes[0].content).toContain("缓存正文")
  })
  it("keeps recoverable new cloud notes and tombstones existing cloud notes", async () => {
    const test = setup([note("a", { pendingOperation: "create" }), note("b", { pendingOperation: "move", previousRemotePath: "old.md" })], true)
    await organizeNotes({ ...test.input, action: { kind: "delete" } })
    expect(test.state.notes).toHaveLength(1)
    expect(test.state.notes[0]).toMatchObject({ pendingOperation: "delete", operationBeforeDelete: "move", previousRemotePath: "old.md" })
    expect(test.state.trash).toHaveLength(2)
    expect(test.state.trash.find((entry) => entry.notes[0].id === "a")!.notes[0].content).toBe("# 正文")
  })
  it("stops after a persistence failure and never reports uncommitted work as successful", async () => {
    const test = setup([note("a"), note("b")], true)
    const commit = vi.fn(async () => { throw new Error("磁盘已满") })
    const report = await organizeNotes({ ...test.input, commit, action: { kind: "add-tags", tags: ["工作"] } })
    expect(report.succeededIds).toEqual([])
    expect(commit).toHaveBeenCalledTimes(1)
    expect(report.issues.join()).toContain("磁盘已满")
  })
  it("stops on library switch and refuses conflict, missing-body and readonly notes", async () => {
    const test = setup([note("a", { syncStatus: "conflict" }), note("b", { contentLoaded: false }), note("c", { readOnly: true })], true)
    const report = await organizeNotes({ ...test.input, action: { kind: "delete" } })
    expect(report.succeededIds).toEqual([])
    expect(report.issues).toHaveLength(3)
    const switched = await organizeNotes({ ...test.input, isCurrent: () => false, action: { kind: "delete" } })
    expect(switched.issues.join()).toContain("已切换")
    expect(test.input.commit).not.toHaveBeenCalled()
  })
})

it("离线移动从当前缓存推导根目录，不依赖其他库的连接配置", () => {
  expect(batchWebDavPath([note("a", { remotePath: "/另一个库/项目/a.md", folder: "项目" })], "归档/a.md")).toBe("/另一个库/归档/a.md")
  expect(() => batchWebDavPath([note("a", { remotePath: "/A/a.md" }), note("b", { remotePath: "/B/b.md" })], "x.md")).toThrow("根目录")
})
