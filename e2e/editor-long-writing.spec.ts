import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

test("章节折叠、源码行号与专注模式不改正文，展开后继续编辑和撤销", async ({ page, isMobile }) => {
  const original = "# 第一章\n\n正文\n\n## 子节\n\n内容\n\n# 第二章\n\n末尾"
  await seedCapabilityNote(page, original)
  const workspace = page.locator(".note-editor:visible"), editor = workspace.locator(".cm-content")
  await editor.press("ControlOrMeta+Home")
  const menu = workspace.getByRole("button", { name: isMobile ? "更多格式" : "插入内容", exact: true })
  await menu.click()
  await workspace.getByRole("menuitem", { name: "折叠当前章节" }).click()
  await expect(workspace.locator(".cm-foldPlaceholder")).toBeVisible()
  await expect.poll(() => capabilityContent(page)).toBe(original)
  await menu.click()
  await workspace.getByRole("menuitem", { name: "展开全部章节" }).click()
  await expect(workspace.locator(".cm-foldPlaceholder")).toHaveCount(0)
  if (isMobile) { await menu.click(); await workspace.getByRole("menuitem", { name: "Markdown 源码模式", exact: true }).click() }
  else await workspace.getByRole("button", { name: "切换为 Markdown 源码模式" }).click()
  await expect(workspace.locator(".cm-lineNumbers")).toBeVisible()
  await workspace.getByRole("button", { name: "更多操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "专注写作", exact: true }).click()
  await expect(workspace).toHaveAttribute("data-focus-mode", "true")
  if (!isMobile) await expect(page.locator(".note-list-panel")).toBeHidden()
  await editor.press("ControlOrMeta+End")
  await editor.pressSequentially("续写")
  await workspace.getByRole("button", { name: "退出专注", exact: true }).click()
  await editor.press("ControlOrMeta+z")
  await expect.poll(() => capabilityContent(page)).toBe(original)
})
