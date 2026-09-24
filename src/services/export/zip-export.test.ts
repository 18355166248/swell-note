// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { exportNoteBundle, exportZipArchive } from "./markdown-export"
const native = vi.hoisted(() => ({ enabled: true, save: vi.fn(), writeFile: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: native.save }))
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: native.writeFile }))
beforeEach(() => { native.enabled = true; native.save.mockReset(); native.writeFile.mockReset() })
describe("native ZIP export", () => {
  it("preserves complete/incomplete backup filenames and only succeeds after writing all bytes", async () => {
    const bytes = new Uint8Array([80, 75, 1, 2])
    native.save.mockResolvedValue("/export/backup.incomplete.swell.zip")
    native.writeFile.mockResolvedValue(undefined)
    expect(await exportZipArchive(bytes, "backup.incomplete.swell.zip")).toBe(true)
    expect(native.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "backup.incomplete.swell.zip" }))
    expect(native.writeFile).toHaveBeenCalledWith("/export/backup.incomplete.swell.zip", bytes)
  })
  it("does not report cancellation as success or write a file", async () => {
    native.save.mockResolvedValue(null)
    expect(await exportZipArchive(new Uint8Array(), "backup.swell.zip")).toBe(false)
    expect(native.writeFile).not.toHaveBeenCalled()
  })
  it("propagates native write failures and preserves existing single-note export naming", async () => {
    native.save.mockResolvedValue("/export/note.zip")
    native.writeFile.mockRejectedValue(new Error("文件提供者拒绝写入"))
    await expect(exportNoteBundle(new Uint8Array(), "note.md")).rejects.toThrow("拒绝写入")
    expect(native.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "note.zip" }))
  })
})
