import { expect, test } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

test("编辑画布按需预览缓存附件，下载和关闭后仍可续写及重试", async ({ page }) => {
  const original = "正文\n\n[录音](attachments/a.mp3)\n\n[方案](attachments/missing.pdf)\n\n结尾"
  await seedCapabilityNote(page, original)
  await page.evaluate(async () => {
    const cacheId = "editor-capability-test", path = "/Swell/测试/attachments/a.mp3"
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("swell-note-vault-cache", 3); r.onsuccess = () => resolve(r.result) })
    const tx = db.transaction("attachments", "readwrite")
    tx.objectStore("attachments").put({ cacheId, path, key: `${cacheId}\u0000${path}`, noteId: "webdav:/Swell/测试/第一篇.md", data: new Uint8Array([1, 2]).buffer, mimeType: "audio/mpeg", status: "synced", createdAt: Date.now() })
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() }); db.close()
  })
  const workspace = page.locator(".note-editor:visible")
  await expect(workspace.locator(".cm-md-attachment")).toHaveCount(2)
  await expect(workspace.locator("audio")).toHaveCount(0)
  await workspace.getByRole("button", { name: "打开附件：录音", exact: true }).click()
  await expect(workspace.locator("audio")).toBeVisible()
  const download = page.waitForEvent("download")
  await workspace.getByRole("link", { name: "下载：录音" }).click()
  expect((await download).suggestedFilename()).toBe("a.mp3")
  await workspace.getByRole("button", { name: "关闭预览" }).click()
  await expect(workspace.locator("audio")).toHaveCount(0)
  await workspace.getByRole("button", { name: "打开附件：方案", exact: true }).click()
  await expect(workspace.getByRole("button", { name: "重试读取附件" })).toBeVisible()
  await workspace.locator(".cm-md-attachment").first().getByRole("button", { name: "编辑附件引用" }).click()
  await workspace.locator(".cm-content").press("ArrowRight")
  await workspace.locator(".cm-content").press("ControlOrMeta+End")
  await workspace.locator(".cm-content").pressSequentially("继续写")
  await expect.poll(() => capabilityContent(page)).toBe(original + "继续写")
})
