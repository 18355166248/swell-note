import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"
import { lockUnifiedCanvas, useUnifiedCanvas } from "./note-view-mode"

test("源码编辑锁定后渲染正文，解锁恢复源码、撤销和同一编辑器", async ({ page, isMobile }) => {
  const content = "# 第一章\n\n**正文重点**\n\n末尾"
  await seedCapabilityNote(page, content)
  const note = page.locator(".note-editor:visible"), editor = note.locator(".cm-content")
  if (isMobile) {
    await note.getByRole("button", { name: "更多格式", exact: true }).click()
    await note.getByRole("menuitem", { name: "Markdown 源码模式", exact: true }).click()
  } else await note.getByRole("button", { name: "切换为 Markdown 源码模式" }).click()
  await expect(note.locator(".cm-lineNumbers")).toBeVisible()
  await editor.evaluate((element) => Object.assign(window, { __readingEditor: element }))
  await editor.press("ControlOrMeta+End")
  await editor.pressSequentially("追加")
  await expect.poll(() => capabilityContent(page)).toBe(content + "追加")
  await lockUnifiedCanvas(page)
  await expect(note.locator(".cm-lineNumbers")).toHaveCount(0)
  await expect(note.locator(".cm-md-strong")).toContainText("正文重点")
  expect(await editor.evaluate((element) => element === (window as unknown as { __readingEditor: Element }).__readingEditor)).toBe(true)
  await note.getByRole("button", { name: "更多操作" }).click()
  await expect(page.getByRole("menuitem", { name: "兼容阅读视图" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await useUnifiedCanvas(page)
  await expect(note.locator(".cm-lineNumbers")).toBeVisible()
  await editor.press("ControlOrMeta+z")
  await expect.poll(() => capabilityContent(page)).toBe(content)
})

test("引用式图片、附件在统一画布中可查看，数字说明不改变尺寸", async ({ page }) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64")
  await page.route("https://example.com/ref.png", (route) => route.fulfill({ contentType: "image/png", body: png }))
  await seedCapabilityNote(page, '开头\n\n![参考图][pic]\n\n[资料][pdf]\n\n[pic]: https://example.com/ref.png "2026"\n[pdf]: attachments/a.pdf')
  const note = page.locator(".note-editor:visible")
  const image = note.locator(".cm-md-image")
  await expect(image.locator("img")).toBeVisible()
  await expect(image).toHaveAttribute("title", "2026")
  expect(await image.evaluate((element) => (element as HTMLElement).style.width)).toBe("")
  await expect(note.locator(".cm-md-attachment")).toContainText("资料")
  await lockUnifiedCanvas(page)
  await expect(image.locator("img")).toBeVisible()
  await expect(note.locator(".cm-md-attachment")).toContainText("资料")
})
