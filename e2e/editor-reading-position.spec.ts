import { expect, test, type Page } from "@playwright/test"
import { seedCapabilityNote } from "./editor-capability-seed"
import { lockUnifiedCanvas } from "./note-view-mode"

const content = Array.from({ length: 240 }, (_, index) => `段落 ${String(index).padStart(3, "0")}：这是用于阅读恢复的长文，每一段都有独立标识，字号和宽度改变后应继续阅读同一段。`).join("\n\n")
const viewport = (page: Page) => page.locator(".note-editor:visible .editor-scroll [data-slot=scroll-area-viewport]")
async function topParagraph(page: Page) {
  return viewport(page).evaluate((element) => {
    const y = element.getBoundingClientRect().top
    const lines = [...element.querySelectorAll<HTMLElement>(".cm-line")]
    const line = lines.find((line) => line.getBoundingClientRect().bottom > y + 2 && line.textContent?.startsWith("段落"))
    return line?.textContent?.match(/段落 \d+/)?.[0] ?? null
  })
}
async function reopen(page: Page) {
  await page.reload()
  await expect(page.locator(".mobile-workspace:visible, .note-editor:visible").first()).toBeVisible()
  const mobile = page.locator(".mobile-workspace:visible")
  if (await mobile.count()) {
    if (await mobile.getAttribute("data-screen") === "library") await mobile.getByRole("button", { name: /^测试 \d+$/ }).click()
    if (await mobile.getAttribute("data-screen") !== "editor") await mobile.locator(".note-list-row").getByText("第一篇", { exact: true }).click()
  }
  await expect(page.locator(".note-editor:visible .cm-content")).toBeVisible()
}
async function readMiddle(page: Page) {
  await viewport(page).evaluate((element) => { element.scrollTop = 6500 })
  await expect.poll(() => topParagraph(page)).not.toBeNull()
  await expect.poll(() => page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem("swell-note:reading-positions:v1") ?? "[]")
    return entries.some((entry: [string, { scrollTop: number }]) => entry[1].scrollTop > 1000)
  })).toBe(true)
  return await topParagraph(page)
}

test("长文重载并调整字号，回到原段且不抢焦点或选区", async ({ page }) => {
  await seedCapabilityNote(page, content)
  await lockUnifiedCanvas(page)
  const before = await readMiddle(page)
  await page.evaluate(() => {
    const key = "swell-note:ui-preferences:v1"
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), editorFontSize: 24 }))
  })
  await reopen(page)
  await expect.poll(() => topParagraph(page)).toBe(before)
  await expect(page.locator(".note-editor:visible .cm-content")).not.toBeFocused()
  // pagehide 即刻记录最末位置，不依赖滚动停顿定时器。
  await viewport(page).evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel"))
    element.scrollTop = 0
  })
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")))
  await reopen(page)
  await expect.poll(() => viewport(page).evaluate((element) => element.scrollTop)).toBe(0)
})

test("前文插入后重载仍找到原段落", async ({ page }) => {
  await seedCapabilityNote(page, content)
  const before = await readMiddle(page)
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("swell-note-vault-cache", 3); request.onsuccess = () => resolve(request.result) })
    const transaction = database.transaction("documents", "readwrite"), store = transaction.objectStore("documents")
    const request = store.get("editor-capability-test\u0000webdav:/Swell/测试/第一篇.md")
    request.onsuccess = () => { const note = request.result; note.content = "新前文\n\n".repeat(50) + note.content; note.baseContent = note.content; store.put(note) }
    await new Promise<void>((resolve) => { transaction.oncomplete = () => resolve() })
    database.close()
  })
  await reopen(page)
  await expect.poll(() => topParagraph(page)).toBe(before)
})

test("宽窄布局切换保留阅读位置，隐藏布局不写入零", async ({ page, isMobile }) => {
  await seedCapabilityNote(page, content)
  const before = await readMiddle(page)
  await page.setViewportSize(isMobile ? { width: 1280, height: 900 } : { width: 390, height: 844 })
  // CSS 断点先变化，React 路由布局下一帧才挂载；等待新布局后再判断是否需要打开笔记。
  if (!isMobile) await expect(page.locator(".mobile-workspace:visible")).toBeVisible()
  else await expect(page.locator(".note-editor:visible .cm-content")).toBeVisible()
  const mobile = page.locator(".mobile-workspace:visible")
  if (await mobile.count()) {
    if (await mobile.getAttribute("data-screen") === "library") await mobile.getByRole("button", { name: /^测试 \d+$/ }).click()
    if (await mobile.getAttribute("data-screen") !== "editor") await mobile.locator(".note-list-row").getByText("第一篇", { exact: true }).click()
  }
  await expect.poll(() => topParagraph(page)).toBe(before)
  await reopen(page)
  await expect.poll(() => topParagraph(page)).toBe(before)
})
