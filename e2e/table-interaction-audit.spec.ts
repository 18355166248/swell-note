import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

const source = "正文\n\n| A | B |\n| --- | --- |\n| abcdef | 第二格 |\n| 第三格 | 第四格 |\n\n结尾"

// 使用独立测试库，覆盖多个编辑功能连续操作时的草稿、选区与焦点交接。
test("单元格草稿中打开查找替换，再撤销和继续输入", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const workspace = page.locator(".note-editor:visible")
  const cell = workspace.locator(".cm-md-table tbody td").first()
  await cell.click()
  await cell.locator("textarea").fill("待查找草稿")
  await cell.locator("textarea").press("ControlOrMeta+f")
  await workspace.getByLabel("查找当前笔记").fill("待查找")
  await expect(workspace.locator(".editor-find-field [aria-live]")).toHaveText("1/1")
  await workspace.getByLabel("替换为").fill("已替换")
  await workspace.getByRole("button", { name: "全部", exact: true }).click()
  await expect.poll(() => capabilityContent(page)).toContain("| 已替换草稿 | 第二格 |")
  await workspace.getByRole("button", { name: "关闭查找", exact: true }).click()
  await cell.click()
  await cell.locator("textarea").press("ControlOrMeta+z")
  await expect.poll(() => capabilityContent(page)).toContain("| 待查找草稿 | 第二格 |")
  await cell.click()
  await cell.locator("textarea").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length))
  await page.keyboard.type("X")
  await page.keyboard.press("Tab")
  await expect.poll(() => capabilityContent(page)).toContain("| 待查找草稿X | 第二格 |")
})

test("连续 Tab 录入和 Shift+Tab 返回后逐步撤销重做", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const table = page.locator(".note-editor:visible .cm-md-table")
  await table.locator("tbody td").first().click()
  for (const value of ["甲甲", "乙乙", "丙丙"]) {
    await page.keyboard.press("ControlOrMeta+a")
    await page.keyboard.type(value)
    await page.keyboard.press("Tab")
  }
  await expect.poll(() => capabilityContent(page)).toContain("| 甲甲 | 乙乙 |\n| 丙丙 | 第四格 |")
  await page.keyboard.press("Shift+Tab")
  await expect(table.locator("tbody td").nth(2).locator("textarea")).toBeFocused()
  await page.keyboard.press("ControlOrMeta+z")
  await expect.poll(() => capabilityContent(page)).toContain("| 甲甲 | 乙乙 |\n| 第三格 | 第四格 |")
  await expect(table.locator("textarea")).toBeFocused()
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(table.locator("textarea")).toHaveValue("丙丙")
})

test("格式快捷键撤销重做保留选区，替换选中文字不误改相邻格", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const cell = page.locator(".note-editor:visible .cm-md-table tbody td").first()
  await cell.click()
  await cell.locator("textarea").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 4))
  await page.keyboard.press("ControlOrMeta+b")
  await expect(cell.locator("textarea")).toHaveValue("ab**cd**ef")
  await page.keyboard.press("ControlOrMeta+z")
  await expect(cell.locator("textarea")).toHaveValue("abcdef")
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(cell.locator("textarea")).toHaveValue("ab**cd**ef")
  await page.keyboard.type("X Y")
  await page.keyboard.press("Tab")
  await expect.poll(() => capabilityContent(page)).toContain("| abX Yef | 第二格 |")
})

test("中文组合输入期间导航键和格式键不提前提交单元格", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const cell = page.locator(".note-editor:visible .cm-md-table tbody td").first()
  await cell.click()
  const input = cell.locator("textarea")
  const result = await input.evaluate((el: HTMLTextAreaElement) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))
    const prevented = ["Enter", "Tab", "ArrowDown", "Escape", "b"].map(key => {
      const event = new KeyboardEvent("keydown", { key, metaKey: key === "b", isComposing: true, keyCode: 229, bubbles: true, cancelable: true })
      el.dispatchEvent(event)
      return event.defaultPrevented
    })
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }))
    return prevented
  })
  expect(result).toEqual([false, false, false, false, false])
  await expect(input).toBeFocused()
  await expect(input).toHaveValue("abcdef")
})

test("长单元格从末尾用方向键返回顶部，光标行保持可见", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const cell = page.locator(".note-editor:visible .cm-md-table tbody td").first()
  await cell.click()
  const input = cell.locator("textarea")
  await input.fill(Array.from({ length: 60 }, (_, i) => `第${i}行`).join("\n"))
  await page.keyboard.type("x")
  for (let step = 0; step < 100; step++) {
    if (await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart <= el.value.indexOf("\n"))) break
    await page.keyboard.press("ArrowUp")
  }
  while (await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart > 0)) await page.keyboard.press("ArrowLeft")
  expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(0)
  await expect.poll(() => input.evaluate(el => {
    const viewport = el.closest('[data-slot="scroll-area-viewport"]')!.getBoundingClientRect()
    return el.getBoundingClientRect().top >= viewport.top - 1
  })).toBe(true)
  await expect(input).toBeFocused()
})

for (const dismiss of ["escape", "outside"] as const) {
  test(`单元格文字右键菜单关闭后草稿和光标交接：${dismiss}`, async ({ page, isMobile }) => {
    test.skip(isMobile, "桌面右键")
    await seedCapabilityNote(page, source)
    const cells = page.locator(".note-editor:visible .cm-md-table tbody td")
    await cells.first().click()
    const input = cells.first().locator("textarea")
    await input.fill("修改中的文字")
    await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(1, 3))
    await input.click({ button: "right" })
    await expect(page.getByRole("menu")).toBeVisible()
    if (dismiss === "escape") {
      await page.keyboard.press("Escape")
      await expect(input).toBeFocused()
      expect(await input.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([1, 3])
      await page.keyboard.type("替代")
      await page.keyboard.press("Tab")
      await expect.poll(() => capabilityContent(page)).toContain("| 修替代的文字 | 第二格 |")
    } else {
      // 菜单可能盖住相邻单元格；先点确认位于菜单外的空白边缘，避免误点菜单中的删除操作。
      const menu = (await page.getByRole("menu").boundingBox())!
      expect(menu.x > 5 || menu.y > 5).toBe(true)
      await page.mouse.click(5, 5)
      await expect(page.getByRole("menu")).toHaveCount(0)
      await cells.nth(1).click()
      await expect(cells.nth(1).locator("textarea")).toBeFocused()
      await expect.poll(() => capabilityContent(page)).toContain("| 修改中的文字 | 第二格 |")
    }
  })
}
