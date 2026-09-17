import { describe, expect, it } from "vitest"

import { resolveEditorReadOnly } from "./workspace"

describe("background save editability", () => {
  it("WebDAV 显式同步期间仍保护快照，本地待保存状态不锁正文", () => {
    expect(resolveEditorReadOnly(false, "local", "unified", "saving")).toBe(false)
    expect(resolveEditorReadOnly(false, "webdav", "unified", "pending")).toBe(false)
    expect(resolveEditorReadOnly(false, "webdav", "unified", "saving")).toBe(true)
  })
})
