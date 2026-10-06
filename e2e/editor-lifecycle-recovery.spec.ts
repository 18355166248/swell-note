import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

test("复杂块未保存草稿重启后恢复，取消不修改正文", async ({ page }) => {
  const original = "正文\n\n$$\nx^2\n$$\n\n结尾"
  await seedCapabilityNote(page, original)
  const block = page.locator(".note-editor:visible .cm-md-rich-block").first()
  await block.getByRole("button", { name: "编辑" }).click()
  await block.locator("textarea").fill("$$\n恢复草稿\n$$")
  await page.reload()
  const restored = page.locator(".note-editor:visible .cm-md-rich-block textarea").first()
  await expect(restored).toHaveValue("$$\n恢复草稿\n$$")
  await expect.poll(() => capabilityContent(page)).toBe(original)
  await page.locator(".note-editor:visible .cm-md-rich-block").first().getByRole("button", { name: "取消", exact: true }).click()
  await page.reload()
  await expect(page.locator(".note-editor:visible .cm-md-rich-block")).toBeVisible()
  await expect(page.locator(".cm-md-rich-editor textarea")).toHaveCount(0)
  await expect.poll(() => capabilityContent(page)).toBe(original)
})

test("后台事件立即保存活动单元格，不需要先失焦", async ({ page }) => {
  await seedCapabilityNote(page, "| 名称 |\n| --- |\n| 原文 |")
  const table = page.locator(".note-editor:visible .cm-md-table")
  await table.getByText("原文", { exact: true }).click()
  await table.locator("textarea").fill("后台最后输入")
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")))
  await expect.poll(() => capabilityContent(page)).toContain("后台最后输入")
  await page.reload()
  await expect(page.locator(".note-editor:visible .cm-md-table")).toContainText("后台最后输入")
})
