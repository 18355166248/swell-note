import { expect, test } from "@playwright/test"
import { seedCapabilityNote } from "./editor-capability-seed"

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "桌面鼠标切格、链接点击与文字拖选兼容")
})

for (const editing of [false, true]) {
  test(`表格链接单击直接打开，不被切格处理抢走：${editing ? "正在编辑" : "未编辑"}`, async ({ page }) => {
    await seedCapabilityNote(page, "正文\n\n| A | B |\n| --- | --- |\n| 第一格 | [文档](https://example.com/table) |\n| 下一行 | 另一格 |\n\n结尾")
    await page.evaluate(() => { window.open = (url) => { document.body.dataset.openedLink = String(url); return null } })
    const table = page.locator(".note-editor:visible .cm-md-table")
    if (editing) await table.locator("tbody td").first().click()
    await table.locator(".cm-md-table-link").click()
    await expect(page.locator("body")).toHaveAttribute("data-opened-link", "https://example.com/table")
    await expect(table.locator("tbody td").nth(1).locator("textarea")).toHaveCount(0)
  })
}

test("从链接开始拖选单元格不打开链接", async ({ page }) => {
  await seedCapabilityNote(page, "正文\n\n| A | B |\n| --- | --- |\n| [文档](https://example.com/table) | 右侧 |\n| 下一行 | 另一格 |\n\n结尾")
  await page.evaluate(() => { window.open = (url) => { document.body.dataset.openedLink = String(url); return null } })
  const table = page.locator(".note-editor:visible .cm-md-table")
  const link = (await table.locator(".cm-md-table-link").boundingBox())!
  const end = (await table.locator("tbody td").nth(3).boundingBox())!
  await page.mouse.move(link.x + 4, link.y + 8)
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.move(end.x + 12, end.y + 12, { steps: 5 })
  await page.mouse.up()
  await expect(table.locator(".cm-md-table-cell-in-range")).toHaveCount(4)
  await expect(page.locator("body")).not.toHaveAttribute("data-opened-link", /.+/)
})

test("缺失松手的切格之后，在输入框内拖文字不会变成单元格拖选", async ({ page }) => {
  await seedCapabilityNote(page, "正文\n\n| A | B |\n| --- | --- |\n| 第一格 | 右侧 |\n| abcdefghijklmnop | 另一格 |\n\n结尾")
  const table = page.locator(".note-editor:visible .cm-md-table")
  await table.locator("tbody td").first().click()
  const target = table.locator("tbody td").nth(2)
  const display = (await target.locator(".cm-md-table-cell-display").boundingBox())!
  await page.mouse.move(display.x + 4, display.y + 8)
  await target.locator(".cm-md-table-cell-display").evaluate((display) => {
    display.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, buttons: 0 }))
  })
  await expect(target.locator("textarea")).toBeFocused()
  const input = (await target.locator("textarea").boundingBox())!
  const other = (await table.locator("tbody td").nth(3).boundingBox())!
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.move(other.x + 20, input.y + 8, { steps: 5 })
  await page.mouse.up()
  await expect(table.locator(".cm-md-table-cell-in-range")).toHaveCount(0)
  await expect(target.locator("textarea")).toBeFocused()
  await expect.poll(() => target.locator("textarea").evaluate((input: HTMLTextAreaElement) => input.selectionEnd - input.selectionStart)).toBeGreaterThan(0)
})
