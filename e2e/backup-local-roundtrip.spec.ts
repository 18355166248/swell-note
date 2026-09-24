import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"

import { parseVaultBackup } from "../src/services/backup/vault-backup"

const sourceFiles: Record<string, string | number[]> = {
  "项目/第一篇.md": "# 第一篇\n\n![示意图](../attachments/chart.png)\n",
  "项目/子目录/第二篇.md": "---\ntags: [计划]\n---\n\n# 第二篇\n中文正文。\n",
  "attachments/chart.png": [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3],
}

async function installMockVaultPicker(page: Page, files: Record<string, string | number[]> = sourceFiles) {
  await page.addInitScript((files) => {
    class MockFileHandle {
      kind = "file" as const
      modifiedAt = Date.now()
      bytes: Uint8Array
      constructor(public name: string, value: string | number[]) {
        this.bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)
      }
      async getFile() {
        return new File([this.bytes.slice().buffer], this.name, { lastModified: this.modifiedAt })
      }
      async createWritable() {
        return {
          write: async (value: string | BufferSource) => {
            this.bytes = typeof value === "string" ? new TextEncoder().encode(value)
              : value instanceof ArrayBuffer ? new Uint8Array(value.slice(0))
                : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
            this.modifiedAt = Date.now()
          },
          close: async () => undefined,
        }
      }
    }
    class MockDirectoryHandle {
      kind = "directory" as const
      entries = new Map<string, MockDirectoryHandle | MockFileHandle>()
      constructor(public name: string) {}
      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        let entry = this.entries.get(name)
        if (!entry && options?.create) {
          entry = new MockDirectoryHandle(name)
          this.entries.set(name, entry)
        }
        if (!(entry instanceof MockDirectoryHandle)) throw new DOMException("Directory missing", "NotFoundError")
        return entry
      }
      async getFileHandle(name: string, options?: { create?: boolean }) {
        let entry = this.entries.get(name)
        if (!entry && options?.create) {
          entry = new MockFileHandle(name, [])
          this.entries.set(name, entry)
        }
        if (!(entry instanceof MockFileHandle)) throw new DOMException("File missing", "NotFoundError")
        return entry
      }
      async removeEntry(name: string) { this.entries.delete(name) }
      async *values() { yield* this.entries.values() }
    }
    const source = new MockDirectoryHandle("来源测试库")
    const target = new MockDirectoryHandle("空白目标库")
    for (const [relative, value] of Object.entries(files)) {
      const segments = relative.split("/")
      let directory = source
      for (const segment of segments.slice(0, -1)) {
        let child = directory.entries.get(segment)
        if (!child) {
          child = new MockDirectoryHandle(segment)
          directory.entries.set(segment, child)
        }
        directory = child as MockDirectoryHandle
      }
      directory.entries.set(segments.at(-1)!, new MockFileHandle(segments.at(-1)!, value))
    }
    let selected = source
    // 模拟浏览器目录句柄，保留同一页面内的文件状态以核对真实 UI 写入结果。
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => selected })
    Object.assign(window, {
      __backupMock: {
        choose: (name: "source" | "target") => { selected = name === "source" ? source : target },
        snapshot: (name: "source" | "target") => {
          const root = name === "source" ? source : target
          const result: Record<string, number[]> = {}
          const visit = (directory: MockDirectoryHandle, prefix: string) => {
            for (const [entryName, entry] of directory.entries) {
              const relative = prefix ? `${prefix}/${entryName}` : entryName
              if (entry instanceof MockDirectoryHandle) visit(entry, relative)
              else result[relative] = Array.from(entry.bytes)
            }
          }
          visit(root, "")
          return result
        },
      },
    })
  }, files)
}

function sha256(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex")
}

test("本地库从应用导出 ZIP 并恢复到空库后逐文件一致", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome")
  await installMockVaultPicker(page)
  await page.goto("/#/notes")
  await page.getByRole("button", { name: "打开本地库" }).click()
  await expect(page.getByText("第一篇", { exact: true }).first()).toBeVisible()

  await page.goto("/#/settings/storage")
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: /备份 ZIP/ }).click()
  const download = await downloadPromise
  const archivePath = await download.path()
  expect(archivePath).toBeTruthy()
  const archive = new Uint8Array(await readFile(archivePath!))
  const backup = parseVaultBackup(archive)
  expect(backup.integrityWarnings).toEqual([])
  expect(backup.notes).toHaveLength(2)
  expect(backup.attachments).toHaveLength(1)

  await page.evaluate(() => (window as unknown as { __backupMock: { choose: (name: string) => void } }).__backupMock.choose("target"))
  await page.goto("/#/notes")
  await page.getByRole("button", { name: "更多笔记库操作" }).click()
  await page.getByRole("menuitem", { name: "打开本地笔记库" }).click()
  await page.goto("/#/settings/storage")
  await page.locator('input[type="file"][accept*=".swell.zip"]').setInputFiles({
    buffer: Buffer.from(archive), mimeType: "application/zip", name: "roundtrip.swell.zip",
  })
  const dialog = page.getByRole("dialog", { name: "预览整库恢复" })
  await expect(dialog).toContainText("2 篇笔记")
  await dialog.getByRole("button", { name: "确认恢复" }).click()
  await expect(dialog).not.toBeVisible()

  const restored = await page.evaluate(() => (window as unknown as { __backupMock: { snapshot: (name: string) => Record<string, number[]> } }).__backupMock.snapshot("target"))
  expect(Object.keys(restored).sort()).toEqual(Object.keys(sourceFiles).sort())
  for (const [relative, value] of Object.entries(sourceFiles)) {
    const original = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)
    expect(sha256(new Uint8Array(restored[relative])), relative).toBe(sha256(original))
  }
})

test("引用附件缺失时阻止完整备份，并允许明确标记的不完整备份", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome")
  await installMockVaultPicker(page, {
    ...sourceFiles,
    "项目/第一篇.md": "# 第一篇\n\n![缺失图](../attachments/missing.png)\n",
  })
  await page.goto("/#/notes")
  await page.getByRole("button", { name: "打开本地库" }).click()
  await expect(page.getByText("第一篇", { exact: true }).first()).toBeVisible()
  await page.goto("/#/settings/storage")
  let downloads = 0
  page.on("download", () => { downloads += 1 })
  await page.getByRole("button", { name: /备份 ZIP/ }).click()
  await expect(page.getByText("备份未下载：1 项内容无法纳入，请查看下方清单")).toBeVisible()
  await expect(page.getByRole("alert", { name: "备份缺失清单" })).toContainText("attachments/missing.png")
  expect(downloads).toBe(0)

  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出可读取内容（不完整）" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain(".incomplete.swell.zip")
  const archive = new Uint8Array(await readFile((await download.path())!))
  const backup = parseVaultBackup(archive)
  expect(backup.notes).toHaveLength(2)
  expect(backup.attachments).toHaveLength(0)
  expect(backup.manifest.missingAttachments).toEqual(["attachments/missing.png"])
  expect(backup.integrityWarnings).toContain("来源库有 1 个引用附件未纳入此备份")

  await page.locator('input[type="file"][accept*=".swell.zip"]').setInputFiles({
    buffer: Buffer.from(archive), mimeType: "application/zip", name: "partial.incomplete.swell.zip",
  })
  const dialog = page.getByRole("dialog", { name: "预览整库恢复" })
  await expect(dialog).toContainText("缺失附件 · attachments/missing.png")
  await expect(dialog.getByRole("button", { name: "确认恢复" })).toBeDisabled()
})
