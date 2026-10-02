import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

test("窄屏长表格横滚、单元格续写和缓存重载保留正文", async ({ page, isMobile }) => {
  test.skip(!isMobile, "这一项专门覆盖触摸布局")
  const original = "正文\n\n| 名称 | 状态 | 长备注 | 其他 | 末列 |\n| --- | --- | --- | --- | --- |\n| 苹果 | 新鲜 | 需要横向滚动查看的备注 | 普通 | 最后 |\n| 香蕉 | 一般 | 备注 | 普通 | 末尾 |\n\n结尾"
  await seedCapabilityNote(page, original)
  const workspace = page.locator(".note-editor:visible"), table = workspace.locator(".cm-md-table")
  await table.getByText("苹果", { exact: true }).tap()
  await table.locator("textarea").fill("苹果连续中文输入123")
  await table.locator("textarea").press("Tab")
  await expect.poll(() => capabilityContent(page)).toContain("苹果连续中文输入123")
  await table.locator("textarea").press("Escape")
  const scroller = workspace.locator(".cm-md-table-scroll")
  await scroller.evaluate((element) => { element.scrollLeft = element.scrollWidth })
  await table.getByText("最后", { exact: true }).tap()
  await table.locator("textarea").fill("末列续写")
  await table.locator("textarea").press("Tab")
  const expected = original.replace("苹果", "苹果连续中文输入123").replace("最后", "末列续写")
  await expect.poll(() => capabilityContent(page)).toBe(expected)
  await page.reload()
  await expect(page.locator(".note-editor:visible .cm-md-table")).toContainText("苹果连续中文输入123")
  await expect.poll(() => capabilityContent(page)).toBe(expected)
})
