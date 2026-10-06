import { expect, test } from "@playwright/test"
import { seedCapabilityNote, capabilityContent } from "./editor-capability-seed"

const table = "| 名称 | 状态 |\n| --- | --- |\n| 苹果 | 新鲜 |\n| 香蕉 | 普通 |"
test("单元格提交后，格内快捷键撤销与重做沿用正文历史", async ({ page }) => {
  await seedCapabilityNote(page, table)
  const note = page.locator(".note-editor:visible")
  await note.locator("td").getByText("苹果", { exact: true }).click()
  const input = note.locator(".cm-md-table-cell-input")
  await input.fill("苹果更新")
  await input.press("Tab")
  await expect.poll(() => capabilityContent(page)).toBe(table.replace("苹果", "苹果更新"))
  await input.press("ControlOrMeta+z")
  await expect.poll(() => capabilityContent(page)).toBe(table)
  await expect(input).toBeFocused()
  await input.press("ControlOrMeta+Shift+z")
  await expect.poll(() => capabilityContent(page)).toBe(table.replace("苹果", "苹果更新"))
})

test("表格转义管道、缺列和代码片段编辑后保持结构，一步撤销恢复原文", async ({ page }) => {
  const original = String.raw`| A | B | C |
| --- | --- | --- |
| path\\| next | ` + "`a``**b**`" + String.raw` |
| only |`
  await seedCapabilityNote(page, original)
  const note = page.locator(".note-editor:visible"), rows = note.locator(".cm-md-table tbody tr")
  await expect(rows.first().locator("td").nth(1)).toHaveText("next")
  await expect(rows.first().locator("code")).toHaveText("a``**b**")
  await expect(rows.nth(1).locator("td")).toHaveCount(3)
  await rows.nth(1).locator("td").nth(2).click()
  const input = note.locator(".cm-md-table-cell-input")
  await input.fill("补齐末列")
  await input.press("Tab")
  await expect.poll(() => capabilityContent(page)).toContain("| only |  | 补齐末列 |")
  await input.press("ControlOrMeta+z")
  await expect.poll(() => capabilityContent(page)).toBe(original)
})

test("引用式链接和图片在表格内展示，定义修改与撤销后目标及时更新", async ({ page, isMobile }) => {
  const original = "| 链接 | 图片 |\n| --- | --- |\n| [说明][ref] | ![参考图][pic] |\n\n[pic]: https://example.com/ref.png\n[ref]: https://example.com/guide-a"
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64")
  await page.route("https://example.com/ref.png", route => route.fulfill({ contentType: "image/png", body: png }))
  await seedCapabilityNote(page, original)
  const note = page.locator(".note-editor:visible"), link = note.locator(".cm-md-table a")
  await expect(link).toHaveAttribute("data-md-href", "https://example.com/guide-a")
  await expect(note.locator(".cm-md-table img")).toHaveAttribute("alt", "参考图")
  const mode = async (source: boolean) => {
    if (isMobile) {
      await note.getByRole("button", { name: "更多格式", exact: true }).click()
      await note.getByRole("menuitem", { name: source ? "Markdown 源码模式" : "退出 Markdown 源码", exact: true }).click()
    } else await note.getByRole("button", { name: source ? "切换为 Markdown 源码模式" : "退出 Markdown 源码模式", exact: true }).click()
  }
  await mode(true)
  const editor = note.locator(".cm-content")
  await editor.press("ControlOrMeta+End")
  await editor.press("Backspace")
  await editor.pressSequentially("b")
  await mode(false)
  await expect(link).toHaveAttribute("data-md-href", "https://example.com/guide-b")
  await editor.press("ControlOrMeta+z")
  await expect(link).toHaveAttribute("data-md-href", "https://example.com/guide-a")
})

test("公式未保存草稿能从工具栏撤销，重做恢复这一笔源码", async ({ page }) => {
  const original = "前文\n\n$$\nx^2\n$$\n\n后文"
  await seedCapabilityNote(page, original)
  const note = page.locator(".note-editor:visible")
  await note.getByRole("button", { name: "编辑公式源码", exact: true }).click()
  await note.locator(".cm-md-rich-editor textarea").fill("$$\ny^2\n$$")
  const undo = note.getByRole("button", { name: "撤销（⌘/Ctrl+Z）", exact: true })
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect.poll(() => capabilityContent(page)).toBe(original)
  await expect(note.locator(".cm-md-rich-editor textarea")).toHaveCount(0)
  // 手机把重做放在更多格式菜单中。
  const redo = note.getByRole("button", { name: "重做（⌘/Ctrl+Shift+Z）", exact: true })
  if (await redo.count()) await redo.click()
  else {
    await note.getByRole("button", { name: "更多格式", exact: true }).click()
    await note.getByRole("menuitem", { name: "重做", exact: true }).click()
  }
  await expect.poll(() => capabilityContent(page)).toBe(original.replace("x^2", "y^2"))
})
