import { expect, test, type Page } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

async function openPicker(page: Page) {
  const toolbar = page.locator(".note-editor:visible .formatting-toolbar")
  if (await toolbar.getAttribute("data-mobile") === "true") {
    await toolbar.getByRole("button", { name: "更多格式", exact: true }).click()
    await toolbar.getByRole("menuitem", { name: "表格", exact: true }).click()
  } else await toolbar.getByRole("button", { name: "表格", exact: true }).click()
  return page.getByRole("dialog", { name: "插入表格", exact: true })
}

async function expectInViewport(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect(), viewport = window.visualViewport!
    const x = rect.left + rect.width / 2, y = rect.top + Math.min(20, rect.height / 2)
    return rect.left >= viewport.offsetLeft + 7 && rect.top >= viewport.offsetTop + 7
      && rect.right <= viewport.offsetLeft + viewport.width - 7
      && rect.bottom <= viewport.offsetTop + viewport.height - 7
      && element.contains(document.elementFromPoint(x, y))
  })).toBe(true)
}

test("小屏尺寸浮层保持可见、光标和插入操作，取消与 Escape 正常关闭", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seedCapabilityNote(page, "正文\n\n结尾")
  await page.locator(".note-editor:visible .cm-content").click()
  const picker = await openPicker(page)
  await expectInViewport(page, ".table-picker-popover")
  await page.screenshot({ animations: "disabled", path: `/tmp/swell-note-table-picker-${testInfo.project.name}.png` })
  await picker.getByRole("button", { name: "增加列数", exact: true }).click()
  await expect(picker.getByLabel("列数", { exact: true })).toHaveText("4")
  await expect(page.locator(".note-editor:visible .cm-content")).toBeFocused()
  await picker.getByRole("button", { name: "取消", exact: true }).click()
  await expect(picker).toHaveCount(0)
  await openPicker(page)
  await page.keyboard.press("Escape")
  await expect(picker).toHaveCount(0)
  await openPicker(page)
  await picker.getByRole("button", { name: "插入 3 × 3", exact: true }).click()
  await expect(page.locator(".cm-md-table-cell-input")).toBeFocused()
  await expect.poll(() => capabilityContent(page)).toContain("|  |  |  |\n| --- | --- | --- |")
})

test("横屏和模拟键盘可视区变化后尺寸浮层仍可滚动确认", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 })
  await seedCapabilityNote(page, "正文\n\n结尾")
  const picker = await openPicker(page)
  for (let count = 0; count < 17; count += 1) await picker.getByRole("button", { name: "增加行数（含表头）", exact: true }).click()
  await expectInViewport(page, ".table-picker-popover")
  // 模拟键盘缩小可视高度及 iOS 的视口平移；不把它当作真机键盘验收。
  await page.evaluate(() => {
    const viewport = window.visualViewport!
    Object.defineProperty(viewport, "height", { configurable: true, value: 180 })
    Object.defineProperty(viewport, "offsetTop", { configurable: true, value: 80 })
    viewport.dispatchEvent(new Event("resize"))
    viewport.dispatchEvent(new Event("scroll"))
  })
  await expectInViewport(page, ".table-picker-popover")
  await expectInViewport(page, ".table-picker-actions button[data-primary]")
  await picker.getByRole("button", { name: "插入 20 × 3", exact: true }).click()
  await expect(page.locator(".cm-md-table-cell-input")).toBeFocused()
  await expect(page.locator(".cm-md-table tr:has(td)")).toHaveCount(19)
})

test("表格操作菜单跟随键盘可视区变化且所有操作可滚动访问", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seedCapabilityNote(page, "正文\n\n| 名称 | 数量 |\n| --- | --- |\n| 甲 | 1 |\n\n结尾")
  await page.locator(".note-editor:visible .cm-md-table-toolbar").click({ position: { x: 4, y: 4 } })
  await page.locator(".note-editor:visible .cm-md-table-menu > summary").getByText("整理", { exact: true }).click()
  await expectInViewport(page, ".cm-md-table-menu-panel:visible")
  await page.evaluate(() => {
    const viewport = window.visualViewport!
    Object.defineProperty(viewport, "height", { configurable: true, value: 150 })
    Object.defineProperty(viewport, "offsetTop", { configurable: true, value: 100 })
    viewport.dispatchEvent(new Event("resize"))
  })
  await expectInViewport(page, ".cm-md-table-menu-panel:visible")
  await page.locator(".cm-md-table-menu-panel:visible").getByRole("button", { name: "按当前列降序", exact: true }).scrollIntoViewIfNeeded()
  await expectInViewport(page, ".cm-md-table-menu-panel:visible")
})


test("快捷尺寸只更新选择，预览高度稳定且取消不写正文", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seedCapabilityNote(page, "正文\n\n结尾")
  await page.locator(".note-editor:visible .cm-content").click()
  const picker = await openPicker(page)
  const initialHeight = (await picker.boundingBox())!.height
  await picker.getByRole("button", { name: "4 行 × 4 列", exact: true }).click()
  await expect(picker.getByRole("button", { name: "4 行 × 4 列", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(picker.getByLabel("行数（含表头）", { exact: true })).toHaveText("4")
  await expect(picker.getByLabel("列数", { exact: true })).toHaveText("4")
  await expect(page.locator(".note-editor:visible .cm-content")).toBeFocused()
  expect((await picker.boundingBox())!.height).toBe(initialHeight)
  await page.screenshot({ animations: "disabled", path: `/tmp/swell-note-table-picker-refined-${testInfo.project.name}.png` })
  expect(await capabilityContent(page)).toBe("正文\n\n结尾")
  // 键盘也能选择快捷尺寸；到达边界后减号禁用，不会生成零行/零列。
  const preset = picker.getByRole("button", { name: "2 行 × 2 列", exact: true })
  await preset.focus()
  await preset.press("Enter")
  await expect(picker.getByRole("button", { name: "减少行数（含表头）", exact: true })).toBeDisabled()
  await picker.getByRole("button", { name: "减少列数", exact: true }).click()
  await expect(picker.getByRole("button", { name: "减少列数", exact: true })).toBeDisabled()
  await picker.getByRole("button", { name: "取消", exact: true }).click()
  await expect(page.locator(".note-editor:visible .cm-content")).toBeFocused()
  await openPicker(page)
  await expect(picker.getByRole("button", { name: "3 行 × 3 列", exact: true })).toHaveAttribute("aria-pressed", "true")
})
