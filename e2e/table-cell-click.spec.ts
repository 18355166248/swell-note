import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

const source = "正文\n\n| A | B |\n| --- | --- |\n| 甲 | 乙 |\n| 丙 | 丁 |\n\n两张表之间\n\n| C | D |\n| --- | --- |\n| 戊 | 己 |\n\n结尾"

for (const value of ["", "修改后的内容"]) {
  test(`旧格先失焦且没有后续 click，一次松手仍进入新格：${value || "空白"}`, async ({ page }) => {
    await seedCapabilityNote(page, source)
    const table = page.locator(".note-editor:visible .cm-md-table").first()
    await table.locator("tbody td").first().click()
    await table.locator("textarea").fill(value)
    await table.evaluate((element) => {
      const target = element.querySelectorAll("tbody td")[2] as HTMLElement
      const bounds = target.getBoundingClientRect()
      const init = { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, clientX: bounds.x + 12, clientY: bounds.y + 12 }
      target.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }))
      // 覆盖 WebKit 先 blur、旧 DOM 因提交被替换后不再产生 click 的事件顺序。
      ;(element.querySelector("textarea") as HTMLTextAreaElement | null)?.blur()
      document.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }))
    })
    const target = table.locator("tbody td").nth(2)
    await expect(target.locator("textarea")).toBeFocused()
    await expect(target.locator("textarea")).toHaveValue("丙")
    await expect.poll(() => capabilityContent(page)).toContain(`| ${value} | 乙 |`)
    await expect(table.locator("textarea")).toHaveCount(1)
  })
}

test("格间按压失焦后取消，旧格内容仍提交且不残留失焦输入层", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const table = page.locator(".note-editor:visible .cm-md-table").first()
  await table.locator("tbody td").first().click()
  await table.locator("textarea").fill("取消前的内容")
  await table.evaluate((element) => {
    const target = element.querySelectorAll("tbody td")[2]
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0, buttons: 1 }))
    ;(element.querySelector("textarea") as HTMLTextAreaElement | null)?.blur()
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "mouse" }))
  })
  await expect.poll(() => table.locator("textarea").evaluateAll((inputs) => inputs.every((input) => document.activeElement === input))).toBe(true)
  await expect.poll(() => capabilityContent(page)).toContain("| 取消前的内容 | 乙 |")
  await table.locator("tbody td").nth(2).click()
  await expect(table.locator("tbody td").nth(2).locator("textarea")).toBeFocused()
})

test("Mac 文字格只有按下事件、buttons 为零且无 click，也直接切换光标", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const table = page.locator(".note-editor:visible .cm-md-table").first()
  await table.locator("tbody td").first().click()
  for (const index of [2, 0, 2, 0]) {
    await table.locator("tbody td").nth(index).locator(".cm-md-table-cell-display").evaluate((display) => {
      const bounds = display.getBoundingClientRect()
      display.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, cancelable: true, button: 0, buttons: 0, pointerType: "mouse",
        clientX: bounds.x + 4, clientY: bounds.y + 4,
      }))
    })
    await expect(table.locator("tbody td").nth(index).locator("textarea")).toBeFocused()
  }
})

test("跨表点击一次即获得光标，旧单元格草稿不丢失", async ({ page, isMobile }) => {
  await seedCapabilityNote(page, source)
  const tables = page.locator(".note-editor:visible .cm-md-table")
  await tables.first().locator("tbody td").first().click()
  await page.locator(".cm-md-table-cell-input").fill("甲修改")
  const target = tables.nth(1).locator("tbody td").first()
  if (isMobile) await target.tap()
  else await target.click()
  await expect(target.locator("textarea")).toBeFocused()
  await expect.poll(() => capabilityContent(page)).toContain("| 甲修改 | 乙 |")
})

test("连续点按未修改和已修改的单元格，每次一次即可进入编辑", async ({ page, isMobile }) => {
  await seedCapabilityNote(page, source)
  const table = page.locator(".note-editor:visible .cm-md-table").first()
  for (let round = 0; round < 3; round += 1) {
    for (const index of [0, 3, 1, 2]) {
      const cell = table.locator("tbody td").nth(index)
      if (isMobile) await cell.tap()
      else await cell.click({ position: { x: 4, y: 4 } })
      await expect(cell.locator("textarea")).toBeFocused()
      if (round === 1) await cell.locator("textarea").fill(`修改${index}`)
    }
  }
})

test("单元格内轻微移动后松手仍按点击进入编辑", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const cell = page.locator(".note-editor:visible .cm-md-table").first().locator("tbody td").first()
  const rect = (await cell.boundingBox())!
  await page.mouse.move(rect.x + 12, rect.y + 12)
  await page.mouse.down()
  await page.mouse.move(rect.x + 20, rect.y + 12, { steps: 3 })
  await page.mouse.up()
  await expect(cell.locator("textarea")).toBeFocused()
})

for (const gesture of ["快速跨格", "松键后移动", "滚动后移动", "窗口失焦后移动"] as const) {
  test(`${gesture}不会误触发拖选`, async ({ page }) => {
    await seedCapabilityNote(page, source)
    const table = page.locator(".note-editor:visible .cm-md-table").first()
    await table.evaluate((element, kind) => {
      const cells = element.querySelectorAll("tbody td")
      const start = cells[0].getBoundingClientRect()
      const end = cells[3].getBoundingClientRect()
      const initial = { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: start.x + 12, clientY: start.y + 12 }
      cells[0].dispatchEvent(new MouseEvent("mousedown", initial))
      if (kind === "滚动后移动") document.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
      if (kind === "窗口失焦后移动") window.dispatchEvent(new Event("blur"))
      document.dispatchEvent(new MouseEvent("mousemove", {
        ...initial, buttons: kind === "松键后移动" ? 0 : 1,
        clientX: end.x + 12, clientY: end.y + 12,
      }))
      document.dispatchEvent(new MouseEvent("mouseup", { ...initial, buttons: 0, clientX: end.x + 12, clientY: end.y + 12 }))
    }, gesture)
    await expect(table.locator(".cm-md-table-cell-in-range")).toHaveCount(0)
    await expect(page.locator(".cm-md-table-floatbar")).toHaveCount(0)
    if (gesture === "快速跨格") await expect(table.locator("tbody td").first().locator("textarea")).toBeFocused()
    else {
      await table.locator("tbody td").nth(1).click()
      await expect(table.locator("tbody td").nth(1).locator("textarea")).toBeFocused()
    }
  })
}

test("实际点击松手后快速跨格移动，仍保持原单元格光标", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const table = page.locator(".note-editor:visible .cm-md-table").first()
  const from = (await table.locator("tbody td").first().boundingBox())!
  const to = (await table.locator("tbody td").nth(3).boundingBox())!
  await page.mouse.move(from.x + 12, from.y + 12)
  await page.mouse.down()
  await page.mouse.up()
  await page.mouse.move(to.x + 12, to.y + 12)
  await page.mouse.move(from.x + 12, from.y + 12)
  await expect(table.locator("tbody td").first().locator("textarea")).toBeFocused()
  await expect(table.locator(".cm-md-table-cell-in-range")).toHaveCount(0)
})

test("已经开始的拖选在滚动或窗口失焦后取消，不残留高亮", async ({ page }) => {
  await seedCapabilityNote(page, source)
  const table = page.locator(".note-editor:visible .cm-md-table").first()
  for (const cancelWith of ["wheel", "blur"]) {
    const from = (await table.locator("tbody td").first().boundingBox())!
    const to = (await table.locator("tbody td").nth(3).boundingBox())!
    await page.mouse.move(from.x + 12, from.y + 12)
    await page.mouse.down()
    await page.waitForTimeout(150)
    await page.mouse.move(to.x + 12, to.y + 12, { steps: 3 })
    await expect(table.locator(".cm-md-table-cell-in-range")).toHaveCount(4)
    await page.evaluate((kind) => {
      if (kind === "wheel") document.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }))
      else window.dispatchEvent(new Event("blur"))
    }, cancelWith)
    await page.mouse.up()
    await expect(table.locator(".cm-md-table-cell-in-range")).toHaveCount(0)
    await expect(page.locator(".cm-md-table-wrap[data-range-selecting]")).toHaveCount(0)
  }
  await table.locator("tbody td").nth(1).click()
  await expect(table.locator("tbody td").nth(1).locator("textarea")).toBeFocused()
})

test("第二行第二列空白格点击下方，一次即可交接光标", async ({ page, isMobile }) => {
  await seedCapabilityNote(page, "正文\n\n| A | B | C |\n| --- | --- | --- |\n| 甲 |  | 丙 |\n| 丁 |  | 己 |\n| 庚 |  | 壬 |\n\n结尾")
  const table = page.locator(".note-editor:visible .cm-md-table").first()
  const current = table.locator("tbody tr").nth(1).locator("td").nth(1)
  const below = table.locator("tbody tr").nth(2).locator("td").nth(1)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (isMobile) await current.tap()
    else await current.click()
    await expect(current.locator("textarea")).toBeFocused()
    if (isMobile) await below.tap()
    else await below.click()
    await expect(below.locator("textarea")).toBeFocused()
    await expect(table.locator("textarea")).toHaveCount(1)
    await expect(current.locator("textarea")).toHaveCount(0)
    if (attempt === 1) await below.locator("textarea").fill("下方内容")
  }
  await expect(below.locator("textarea")).toHaveValue("下方内容")
})
