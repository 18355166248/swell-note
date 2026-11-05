import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

const content = "正文\n\n| 名称 | 状态 |\n| --- | --- |\n| 苹果 | 新鲜 |\n| 香蕉 | 一般 |\n\n结尾"

test("Shift+Enter 格内换行，保存重开后上下键在行边界切同列", async ({ page }) => {
  await seedCapabilityNote(page, content)
  const table = page.locator(".note-editor:visible .cm-md-table")
  await table.locator("tbody tr").first().locator("td").first().click()
  const input = page.locator(".cm-md-table-cell-input")
  await input.fill("第一行")
  await input.press("Shift+Enter")
  await page.keyboard.type("第二行")
  await expect(input).toHaveValue("第一行\n第二行")
  await expect(table.locator("tbody tr")).toHaveCount(2)
  await input.press("Tab")
  await expect.poll(() => capabilityContent(page)).toContain("| 第一行<br>第二行 | 新鲜 |")
  await table.locator("tbody tr").first().locator("td").first().click()
  await expect(input).toHaveValue("第一行\n第二行")
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length))
  await input.press("ArrowUp")
  await expect(table.locator("tbody tr").first().locator("td").first().locator("textarea")).toBeFocused()
  await input.press("ArrowUp")
  await expect(table.locator("th").first().locator("textarea")).toBeFocused()
  await input.press("ArrowDown")
  await expect(table.locator("tbody tr").first().locator("td").first().locator("textarea")).toBeFocused()
  await input.press("ControlOrMeta+ArrowDown")
  await expect(table.locator("tbody tr").nth(1).locator("td").first().locator("textarea")).toBeFocused()
  await input.press("ArrowDown")
  await expect(table.locator("tbody tr")).toHaveCount(2)
  await page.reload()
  const mobile = page.locator(".mobile-workspace:visible")
  if (await mobile.count()) {
    if (await mobile.getAttribute("data-screen") === "library") await mobile.getByRole("button", { name: /^测试 \d+$/ }).click()
    if (await mobile.getAttribute("data-screen") !== "editor") await mobile.locator(".note-list-row").getByText("第一篇", { exact: true }).click()
  }
  await expect(table).toBeVisible()
  await table.locator("tbody tr").first().locator("td").first().click()
  await expect(input).toHaveValue("第一行\n第二行")
})

test("软换行内上下键移动光标，到显示行边缘才跨单元格", async ({ page }) => {
  await seedCapabilityNote(page, content)
  const table = page.locator(".note-editor:visible .cm-md-table")
  await table.locator("tbody tr").first().locator("td").first().click()
  const input = page.locator(".cm-md-table-cell-input")
  await input.fill("这是一段会在窄列中自动折行的文字，用来验证方向键仍然可以移动格内的文本光标。")
  await input.evaluate((element: HTMLTextAreaElement) => { element.style.width = "60px"; element.setSelectionRange(0, 0) })
  await input.press("ArrowDown")
  await expect(table.locator("tbody tr").first().locator("td").first().locator("textarea")).toBeFocused()
  await expect.poll(() => input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBeGreaterThan(0)
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length))
  await input.press("ArrowDown")
  await expect(table.locator("tbody tr").nth(1).locator("td").first().locator("textarea")).toBeFocused()
  await expect.poll(() => capabilityContent(page)).toContain("这是一段会在窄列中自动折行的文字")
})

test("Enter 末行补行，格内换行撤销重做后仍可编辑", async ({ page }) => {
  await seedCapabilityNote(page, content)
  const workspace = page.locator(".note-editor:visible"), table = workspace.locator(".cm-md-table")
  await table.locator("tbody tr").first().locator("td").first().click()
  const input = page.locator(".cm-md-table-cell-input")
  await input.fill("甲")
  await input.press("Shift+Enter")
  await page.keyboard.type("乙")
  await workspace.getByRole("button", { name: "撤销（⌘/Ctrl+Z）", exact: true }).click()
  await expect(input).toHaveValue("苹果")
  const redo = workspace.getByRole("button", { name: "重做（⌘/Ctrl+Shift+Z）", exact: true })
  if (await redo.isVisible()) await redo.click()
  else {
    await workspace.getByRole("button", { name: "更多格式", exact: true }).click()
    await workspace.locator(".toolbar-more-menu").getByText("重做", { exact: true }).click()
  }
  await expect(input).toHaveValue("甲\n乙")
  await input.press("Tab")
  await table.locator("tbody tr").last().locator("td").last().click()
  await input.press("Enter")
  await expect(table.locator("tbody tr")).toHaveCount(3)
  await expect(table.locator("tbody tr").last().locator("td").first().locator("textarea")).toBeFocused()
})

test("左右键逐字符移动，到边界后切格并按进入方向定位", async ({ page }) => {
  await seedCapabilityNote(page, content)
  const table = page.locator(".note-editor:visible .cm-md-table")
  const first = table.locator("tbody tr").first().locator("td").first()
  const second = table.locator("tbody tr").first().locator("td").nth(1)
  await first.click()
  const input = page.locator(".cm-md-table-cell-input")
  await input.fill("甲😀乙")
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0))
  // 字符移动仍走浏览器原生行为，emoji 的两个 UTF-16 单元不能被拆开。
  for (const caret of [1, 3, 4]) {
    await input.press("ArrowRight")
    await expect(first.locator("textarea")).toBeFocused()
    expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(caret)
  }
  await input.press("ArrowRight")
  await expect(second.locator("textarea")).toBeFocused()
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0)
  await expect.poll(() => capabilityContent(page)).toContain("| 甲😀乙 | 新鲜 |")
  await input.press("ArrowRight")
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(1)
  await expect(second.locator("textarea")).toBeFocused()
  await input.press("ArrowLeft")
  await expect(second.locator("textarea")).toBeFocused()
  await input.press("ArrowLeft")
  await expect(first.locator("textarea")).toBeFocused()
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(4)
  for (const caret of [3, 1, 0]) {
    await input.press("ArrowLeft")
    expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(caret)
  }
  await input.press("ArrowLeft")
  await expect(first.locator("textarea")).toBeFocused()
  // 选区先由原生方向键收拢，不能直接跨格；Shift+方向键继续选择文字。
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, element.value.length))
  await input.press("ArrowRight")
  await expect(first.locator("textarea")).toBeFocused()
  await input.press("Shift+ArrowLeft")
  await expect(first.locator("textarea")).toBeFocused()
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart < element.selectionEnd)).toBe(true)
})

test("左右跨空单元格和多行内容，行末不换行，表头同样可切换", async ({ page }) => {
  await seedCapabilityNote(page, "正文\n\n| A | B | C |\n| --- | --- | --- |\n| 左 |  | 前<br>后 |\n\n结尾")
  const table = page.locator(".note-editor:visible .cm-md-table")
  const cells = table.locator("tbody tr").first().locator("td")
  await cells.nth(0).click()
  const input = page.locator(".cm-md-table-cell-input")
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length))
  await input.press("ArrowRight")
  await expect(cells.nth(1).locator("textarea")).toBeFocused()
  await expect(input).toHaveValue("")
  await input.press("ArrowRight")
  await expect(cells.nth(2).locator("textarea")).toBeFocused()
  await expect(input).toHaveValue("前\n后")
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(0)
  await input.press("ArrowLeft")
  await expect(cells.nth(1).locator("textarea")).toBeFocused()
  await input.press("ArrowLeft")
  await expect(cells.nth(0).locator("textarea")).toBeFocused()
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(1)
  await cells.nth(2).click()
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length))
  await input.press("ArrowRight")
  await expect(cells.nth(2).locator("textarea")).toBeFocused()
  await expect(table.locator("tbody tr")).toHaveCount(1)
  const header = table.locator("th")
  await header.nth(1).click()
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 0))
  await input.press("ArrowLeft")
  await expect(header.nth(0).locator("textarea")).toBeFocused()
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(1)
})

test("格内空格正常输入，输入法确认不被外层单元格取消", async ({ page }) => {
  await seedCapabilityNote(page, content)
  const cell = page.locator(".note-editor:visible .cm-md-table tbody td").first()
  await cell.click()
  const input = cell.locator("textarea")
  await input.fill("abcdef")
  await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 4))
  // 必须走真实键盘事件；fill / insertText 不经过 keydown，会漏掉空格被拦截的问题。
  await page.keyboard.type("X Y")
  await expect(input).toHaveValue("abX Yef")
  expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(5)
  const prevented = await input.evaluate((el) => ["Enter", " "].map((key) => {
    const event = new KeyboardEvent("keydown", { key, isComposing: true, keyCode: 229, bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event.defaultPrevented
  }))
  expect(prevented).toEqual([false, false])
  await expect(input).toBeFocused()
  await expect(input).toHaveValue("abX Yef")
  await input.press("Tab")
  await expect.poll(() => capabilityContent(page)).toContain("| abX Yef | 新鲜 |")
})

for (const wrapped of [false, true]) {
  test(`长单元格在顶部、中部和末尾输入，滚动跟随实际光标：${wrapped ? "软换行" : "显式换行"}`, async ({ page }) => {
    await seedCapabilityNote(page, content)
    const cell = page.locator(".note-editor:visible .cm-md-table tbody td").first()
    await cell.click()
    const input = cell.locator("textarea")
    await input.fill(wrapped ? "较长的中文内容用于检查自动折行。".repeat(100) : Array.from({ length: 70 }, (_, i) => `第${i}行内容`).join("\n"))
    for (const position of [0, 0.5, 1]) {
      const offset = await input.evaluate((el: HTMLTextAreaElement, fraction) => {
        const offset = Math.floor(el.value.length * fraction)
        el.setSelectionRange(offset, offset)
        return offset
      }, position)
      await page.keyboard.type("xyz")
      // 用独立 textarea 的原生排版测量光标行，避免复用被测镜像算法。
      await expect.poll(() => input.evaluate((el: HTMLTextAreaElement) => {
        const probe = el.cloneNode() as HTMLTextAreaElement
        probe.value = el.value
        const style = getComputedStyle(el)
        probe.style.cssText = style.cssText
        for (const property of ["font", "line-height", "letter-spacing", "white-space", "overflow-wrap", "word-break", "padding", "border", "box-sizing"]) probe.style.setProperty(property, style.getPropertyValue(property))
        Object.assign(probe.style, { position: "fixed", top: "0", left: "-10000px", width: `${el.getBoundingClientRect().width}px`, height: style.lineHeight, overflow: "hidden" })
        document.body.append(probe)
        // 用内容前缀的原生 scrollHeight 测量当前行，不转移焦点。
        probe.value = el.value.slice(0, el.selectionStart) + "x"
        const offset = probe.scrollHeight - probe.clientHeight
        probe.remove()
        const top = el.getBoundingClientRect().top + offset - el.scrollTop
        const viewport = el.closest('[data-slot="scroll-area-viewport"]')!.getBoundingClientRect()
        return { visible: top >= viewport.top && top + parseFloat(style.lineHeight) <= Math.min(viewport.bottom, window.innerHeight), top, viewportTop: viewport.top, viewportBottom: viewport.bottom, caret: el.selectionStart }
      })).toMatchObject({ visible: true })
      await expect(input).toBeFocused()
      expect(await input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(offset + 3)
    }
  })
}
