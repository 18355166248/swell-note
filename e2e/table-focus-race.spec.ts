import { expect, test } from "@playwright/test"
import { seedCapabilityNote, capabilityContent } from "./editor-capability-seed"

// 保留真实事件顺序，不在 Tab 后等待输入框，才能暴露焦点交接空窗。
test("快速切格后全选仅作用于目标格，不能覆盖整篇笔记", async ({ page }, testInfo) => {
  await seedCapabilityNote(page, "正文\n\n| A | B |\n| --- | --- |\n| abcdef | 第二格 |\n| 第三格 | 第四格 |\n\n结尾")
  await page.evaluate(() => {
    const logs: unknown[] = []
    ;(window as unknown as { audit: unknown[] }).audit = logs
    for (const type of ['focusin', 'focusout', 'keydown', 'input']) document.addEventListener(type, event => {
      const a = document.activeElement as HTMLTextAreaElement
      logs.push({ type, key: (event as KeyboardEvent).key, target: (event.target as HTMLElement)?.className, active: a?.className, value: a?.value })
    }, true)
  })
  await page.locator('.note-editor:visible .cm-md-table tbody td').first().click()
  for (const value of ['甲甲', '乙乙', '丙丙']) {
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(value)
    await page.keyboard.press('Tab')
  }
  await testInfo.attach('focus-events', { body: JSON.stringify(await page.evaluate(() => (window as unknown as { audit: unknown[] }).audit), null, 2), contentType: 'application/json' })
  await expect.poll(() => capabilityContent(page)).toContain('| 甲甲 | 乙乙 |\n| 丙丙 | 第四格 |')
})

for (const blur of [false, true]) {
  test(`退出表格后页面全选仍覆盖正文，撤销可恢复表格：失焦=${blur}`, async ({ page }) => {
    const source = "正文\n\n| A | B |\n| --- | --- |\n| abcdef | 第二格 |\n\n结尾"
    await seedCapabilityNote(page, source)
    const workspace = page.locator(".note-editor:visible")
    await workspace.locator(".cm-md-table tbody td").first().click()
    await workspace.locator(".cm-md-table-cell-input").fill("已提交")
    await workspace.locator(".cm-line").getByText("结尾", { exact: true }).click()
    await expect.poll(() => capabilityContent(page)).toContain("| 已提交 | 第二格 |")
    if (blur) {
      await workspace.locator(".cm-content").evaluate(el => el.blur())
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    }
    await page.keyboard.press("ControlOrMeta+a")
    await page.keyboard.type("replacement")
    await expect.poll(() => capabilityContent(page)).toBe("replacement")
    // 输入同一段连续文本后撤销，应恢复此前整篇正文及已提交的单元格内容。
    await page.keyboard.press("ControlOrMeta+z")
    await expect.poll(() => capabilityContent(page)).toBe(source.replace("abcdef", "已提交"))
  })
}
