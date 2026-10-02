import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

test("手动快照、保留设置、导出导入历史均不改当前正文", async ({ page }) => {
  const original = "当前正文"
  await seedCapabilityNote(page, original)
  const workspace = page.locator(".note-editor:visible")
  await workspace.getByRole("button", { name: "更多操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "本地版本历史" }).click()
  const dialog = page.getByRole("dialog", { name: "本地版本历史" })
  await dialog.getByLabel("历史保留数量").selectOption("100")
  await dialog.getByLabel("自动快照间隔").selectOption("1")
  await dialog.getByRole("button", { name: "保存当前快照" }).click()
  await expect(dialog.getByRole("status")).toContainText("快照已保存")
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "导出历史", exact: true }).click()
  const file = await download, path = await file.path()
  const archive = JSON.parse(await readFile(path!, "utf8"))
  expect(archive.versions[0].content).toBe(original)
  archive.versions.unshift({ content: "另一设备归档", createdAt: Date.now() + 1, reason: "手动快照", title: "原标题", cacheId: "other" })
  await dialog.locator('input[type="file"]').setInputFiles({ name: "note.history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(archive)) })
  await expect(dialog.getByRole("status")).toContainText("归档已导入")
  await expect(dialog.locator(".note-history-item")).toHaveCount(2)
  await expect.poll(() => capabilityContent(page)).toBe(original)
})
