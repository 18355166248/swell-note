import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"
import { useCompatibilityPreview, useUnifiedCanvas } from "./note-view-mode"

test("调整图片尺寸、视觉编辑说明和换图均保留 title，阅读往返与撤销正确", async ({ page }) => {
  await page.route("https://example.com/*.png", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") }))
  const original = '正文\n\n![架构图](https://example.com/a.png "原始说明")\n\n结尾'
  await seedCapabilityNote(page, original)
  let image = page.locator(".note-editor:visible .cm-md-image")
  await image.hover()
  await image.getByRole("combobox", { name: "图片宽度" }).selectOption("480")
  await expect.poll(() => capabilityContent(page)).toContain('(https://example.com/a.png "原始说明")<!-- swell-image:width=480 -->')
  await expect(image).toHaveAttribute("style", /width: 480px/)
  await image.getByRole("button", { name: "说明", exact: true }).click()
  await image.getByLabel("图片替代文字").fill("新[图]")
  await image.getByLabel("图片说明", { exact: true }).fill('新"说明')
  await image.getByRole("button", { name: "保存说明" }).click()
  await expect.poll(() => capabilityContent(page)).toContain('![新\\[图\\]](https://example.com/a.png "新\\\"说明")<!-- swell-image:width=480 -->')
  await image.hover()
  await image.getByRole("button", { name: "更换", exact: true }).click()
  await image.getByLabel("图片地址或附件路径").fill("https://example.com/b.png")
  await image.getByRole("button", { name: "应用", exact: true }).click()
  await expect.poll(() => capabilityContent(page)).toContain('(https://example.com/b.png "新\\\"说明")<!-- swell-image:width=480 -->')
  await useCompatibilityPreview(page)
  const previewImage = page.locator(".note-editor:visible .markdown-preview img")
  await expect(previewImage).toHaveAttribute("title", '新"说明')
  // 手机宽度受页面约束；声明宽度必须保持，实际盒宽可缩小。
  await expect(previewImage).toHaveAttribute("style", /width: 480px/)
  await useUnifiedCanvas(page)
  image = page.locator(".note-editor:visible .cm-md-image")
  await image.hover()
  await image.getByRole("combobox", { name: "图片宽度" }).selectOption("")
  await expect.poll(() => capabilityContent(page)).toContain('"新\\\"说明")<!-- swell-image:width=auto -->')
  await page.locator(".note-editor:visible .cm-content").press("ControlOrMeta+z")
  await expect.poll(() => capabilityContent(page)).toContain('width=480')
  await page.reload()
  // 重载手机先回目录，重新打开后正文、说明和独立尺寸都应持久化。
  const mobile = page.locator(".mobile-workspace:visible")
  if (await mobile.count()) {
    if (await mobile.getAttribute("data-screen") === "library") await mobile.getByRole("button", { name: /^测试 \d+$/ }).click()
    if (await mobile.getAttribute("data-screen") !== "editor") await mobile.locator(".note-list-row").getByText("第一篇", { exact: true }).click()
  }
  await expect(page.locator(".note-editor:visible .cm-md-image")).toHaveAttribute("title", '新"说明')
})
