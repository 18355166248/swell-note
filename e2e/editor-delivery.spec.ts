import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

test("HTML 导出保留中文、公式、图表、表格和失效附件说明，预览能打印为 PDF", async ({ page, context, isMobile }) => {
  const original = "中文正文\n\n$$\nx^2\n$$\n\n```mermaid\nflowchart TD\n A[开始] --> B[结束]\n```\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n![缺失](attachments/missing.png)"
  await seedCapabilityNote(page, original)
  await page.locator(".note-editor:visible").getByRole("button", { name: "更多操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "导出 HTML / 打印", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "导出与打印" })
  const preview = dialog.frameLocator("iframe")
  await expect(preview.locator("body")).toContainText("中文正文")
  await expect(preview.locator("math")).toBeVisible()
  await expect(preview.locator("svg")).toBeVisible()
  await expect(preview.locator("table")).toBeVisible()
  await expect(preview.locator(".delivery-warning")).toContainText("未包含附件")
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "下载 HTML" }).click()
  const saved = await download, html = await readFile((await saved.path())!, "utf8")
  expect(html).toContain("<math")
  expect(html).toContain("<svg")
  expect(html).toContain("@media print")
  expect(saved.suggestedFilename()).toBe("第一篇.html")
  await expect(dialog.getByRole("button", { name: "打印 / 保存 PDF" })).toBeEnabled()
  if (!isMobile) {
    const printable = await context.newPage()
    await printable.setContent(html)
    const pdf = await printable.pdf({ format: "A4" })
    expect(pdf.byteLength).toBeGreaterThan(5000)
    await printable.close()
  }
  await expect.poll(() => capabilityContent(page)).toBe(original)
})

test("只读源笔记保持禁写，仍可访问本地历史和导出", async ({ page }) => {
  const original = "只读正文"
  await seedCapabilityNote(page, original, true)
  const workspace = page.locator(".note-editor:visible")
  await expect(workspace.locator(".cm-content")).toHaveAttribute("contenteditable", "false")
  await workspace.getByRole("button", { name: "更多操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "本地版本历史" }).click()
  const history = page.getByRole("dialog", { name: "本地版本历史" })
  await expect(history).toBeVisible()
  await history.getByRole("button", { name: "关闭", exact: true }).click()
  await workspace.getByRole("button", { name: "更多操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "导出 HTML / 打印", exact: true }).click()
  const delivery = page.getByRole("dialog", { name: "导出与打印" })
  await expect(delivery.frameLocator("iframe").locator("body")).toContainText(original)
  await expect(delivery.getByRole("button", { name: "下载 HTML" })).toBeEnabled()
  await expect.poll(() => capabilityContent(page, true)).toBe(original)
})
