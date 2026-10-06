import { expect, test } from "@playwright/test"
import { seedCapabilityNote } from "./editor-capability-seed"

test("普通笔记不加载画图包，实际打开 Excalidraw 时仍可加载画布", async ({ page }) => {
  const drawingRequests: string[] = []
  page.on("request", (request) => { if (/plugin-excalidraw-[^/]+\.js/.test(request.url())) drawingRequests.push(request.url()) })
  await seedCapabilityNote(page, "普通 Markdown 正文")
  expect(drawingRequests).toHaveLength(0)
  const editor = page.locator(".note-editor:visible .cm-content")
  await editor.click()
  await editor.press("ControlOrMeta+A")
  await page.keyboard.insertText('---\nexcalidraw-plugin: parsed\n---\n\n## Drawing\n```json\n{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}\n```')
  await expect(page.locator(".excalidraw-plugin")).toBeVisible()
  await expect.poll(() => page.locator(".excalidraw-plugin canvas").count()).toBeGreaterThan(0)
  expect(drawingRequests.length).toBeGreaterThan(0)
})
