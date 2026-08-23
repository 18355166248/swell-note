import { describe, expect, it } from "vitest"

import {
  canReuseCachedContent,
  isWebDavWorkingCopy,
  remoteChangedFromBase,
  shouldReadVaultDocument,
} from "@/services/sync/webdav-working-copy"
import type { Note } from "@/types/note"

function createNote(patch: Partial<Note> = {}): Note {
  return {
    content: "本地正文",
    contentLoaded: true,
    folder: "根目录",
    id: "webdav:/note.md",
    preview: "本地正文",
    readOnly: false,
    remotePath: "/note.md",
    revision: '"v1"',
    source: "webdav",
    starred: false,
    syncStatus: "modified",
    title: "note",
    updatedAt: "刚刚",
    ...patch,
  }
}

describe("WebDAV working copy", () => {
  it("远端版本未变化时保留待同步状态", () => {
    const note = createNote()
    expect(isWebDavWorkingCopy(note)).toBe(true)
    expect(remoteChangedFromBase(note, '"v1"')).toBe(false)
  })

  it("其他设备更新远端后识别为冲突", () => {
    expect(remoteChangedFromBase(createNote(), '"v2"')).toBe(true)
  })

  it("缺少任一侧 ETag 时拒绝推断版本一致", () => {
    expect(remoteChangedFromBase(createNote({ revision: undefined }), '"v2"')).toBe(true)
    expect(remoteChangedFromBase(createNote(), undefined)).toBe(true)
  })

  it("仅复用版本一致且正文完整的本地缓存", () => {
    expect(canReuseCachedContent(createNote(), '"v1"')).toBe(true)
    expect(canReuseCachedContent(createNote({ contentLoaded: false }), '"v1"')).toBe(false)
    expect(canReuseCachedContent(createNote(), '"v2"')).toBe(false)
  })

  it("重连时优先读取当前尚未缓存正文的笔记", () => {
    expect(shouldReadVaultDocument({
      filePath: "/note.md",
      preferredPath: "/note.md",
      preserveContext: true,
      previousNote: createNote({ contentLoaded: false, syncStatus: undefined }),
      remoteRevision: '"v1"',
    })).toBe(true)
  })

  it("重连时不覆盖尚未同步的本地工作副本", () => {
    expect(shouldReadVaultDocument({
      filePath: "/note.md",
      preferredPath: "/note.md",
      preserveContext: true,
      previousNote: createNote({ contentLoaded: false }),
      remoteRevision: '"v2"',
    })).toBe(false)
  })
})
