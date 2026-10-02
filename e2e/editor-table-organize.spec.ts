import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

test("表格整理先包含未提交文字，行列复制及排序可撤销并继续编辑", async ({ page }) => {
  await seedCapabilityNote(page, "正文\n\n| 名称 | 数量 |\n| --- | ---: |\n| 甲 | 10 |\n| 乙 | 2 |\n\n结尾")
  const workspace = page.locator(".note-editor:visible"), table = workspace.locator(".cm-md-table")
  await table.getByText("甲", { exact: true }).click()
  await table.locator("textarea").fill("甲修改")
  const organize = async (label: string) => {
    await workspace.locator(".cm-md-table-toolbar").click({ position: { x: 4, y: 4 } })
    await workspace.locator(".cm-md-table-menu > summary").getByText("整理", { exact: true }).click()
    await page.locator(".cm-md-table-menu-panel").getByRole("button", { name: label, exact: true }).click()
  }
  await organize("复制当前行")
  await expect.poll(() => capabilityContent(page)).toContain("| 甲修改 | 10 |\n| 甲修改 | 10 |")
  await table.locator("textarea").press("Escape")
  await table.getByText("2", { exact: true }).click()
  await organize("按当前列升序")
  await expect.poll(() => capabilityContent(page)).toContain("| 乙 | 2 |\n| 甲修改 | 10 |")
  await workspace.getByRole("button", { name: "撤销（⌘/Ctrl+Z）", exact: true }).click()
  await expect.poll(() => capabilityContent(page)).toContain("| 甲修改 | 10 |\n| 甲修改 | 10 |\n| 乙 | 2 |")
  await table.locator("textarea").press("Escape")
  await table.locator("th").filter({ hasText: "数量" }).click()
  await organize("复制当前列")
  await expect.poll(() => capabilityContent(page)).toContain("| 名称 | 数量 | 数量 |")
  await expect.poll(() => capabilityContent(page)).toContain("| 甲修改 | 10 | 10 |")
})
