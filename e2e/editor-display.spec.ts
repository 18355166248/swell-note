import { expect, test } from "@playwright/test"

test("正文显示偏好可调整并在重新打开后保留", async ({ page }) => {
  await page.goto("/#/settings/appearance")
  await expect(page.getByRole("heading", { name: "界面外观" })).toBeVisible()
  await page.getByRole("combobox", { name: "正文字号", exact: true }).selectOption("24")
  await page.getByRole("combobox", { name: "正文行宽", exact: true }).selectOption("wide")
  await expect(page.locator(".editor-display-sample")).toHaveCSS("font-size", "24px")
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--editor-page-width"))).toBe("1200px")
  await page.reload()
  await expect(page.getByRole("combobox", { name: "正文字号", exact: true })).toHaveValue("24")
  await expect(page.getByRole("combobox", { name: "正文行宽", exact: true })).toHaveValue("wide")
  // 窄屏下设置控件和大字预览仍不能撑宽页面，否则移动端要横向拖动才能操作。
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole("combobox", { name: "正文字号", exact: true }).selectOption("16")
  await page.getByRole("combobox", { name: "正文行宽", exact: true }).selectOption("narrow")
  await expect(page.locator(".editor-display-sample")).toHaveCSS("font-size", "16px")
})
