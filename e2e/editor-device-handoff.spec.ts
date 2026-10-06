import { expect, test } from "@playwright/test"
import { connectMockWebDav, MockWebDavServer, SERVER_URL } from "./mock-webdav-server"

test("自动模式无本机修改时，回前台仍拉取另一设备正文", async ({ page }) => {
  const server = new MockWebDavServer()
  server.addFile("/Swell/note.md", "另一设备修改前")
  await page.addInitScript(() => localStorage.setItem("swell-note:sync-preferences:v1", JSON.stringify({ autoSyncMode: "background" })))
  await page.route(`${SERVER_URL}**`, (route) => server.handler(route))
  await connectMockWebDav(page)
  await page.evaluate(() => { location.hash = `/notes/${encodeURIComponent("webdav:/Swell/note.md")}` })
  const editor = page.locator(".note-editor:visible .cm-content")
  await expect(editor).toContainText("另一设备修改前")
  // 等待启动自动检查完整结束，后面的变化必须由本次前台事件发现。
  await page.waitForTimeout(1500)
  await expect(page.locator(".note-editor:visible").getByRole("button", { name: "同步坚果云笔记库", exact: true })).toBeEnabled()
  server.addFile("/Swell/note.md", "Mac 已上传的新正文")
  await page.evaluate(() => {
    const now = Date.now.bind(Date)
    Date.now = () => now() + 31000
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(editor).toContainText("Mac 已上传的新正文")
  expect(server.readFile("/Swell/note.md")).toBe("Mac 已上传的新正文")
})

for (const referenceStyle of [false, true]) test(`准备${referenceStyle ? "引用式" : "普通"}附件后断网重载仍可重新读取缓存，缺失项单独反馈`, async ({ page }) => {
  const server = new MockWebDavServer()
  server.addFile("/Swell/note.md", referenceStyle
    ? "[资料][pdf]\n\n[缺失][missing]\n\n[pdf]: attachments/a.pdf\n[missing]: attachments/missing.pdf"
    : "[资料](attachments/a.pdf)\n\n[缺失](attachments/missing.pdf)")
  server.addFile("/Swell/attachments/a.pdf", "offline-test-bytes")
  await page.route(`${SERVER_URL}**`, (route) => server.handler(route))
  await connectMockWebDav(page)
  await page.evaluate(() => { location.hash = `/notes/${encodeURIComponent("webdav:/Swell/note.md")}` })
  const prepare = async () => {
    await expect(page.locator(".note-editor:visible .cm-content")).toBeVisible()
    await page.locator(".note-editor:visible").getByRole("button", { name: "更多操作", exact: true }).click()
    await page.getByRole("menuitem", { name: "准备当前笔记离线附件" }).click()
    const dialog = page.getByRole("dialog", { name: "准备当前笔记离线附件" })
    await expect(dialog.getByRole("status")).toContainText("1 个成功 · 1 个失败")
    await expect(dialog.getByRole("status")).toContainText("本轮检查完成")
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
  }
  await prepare()
  // 仅阻断远端网络，页面本机资源仍可重载；模拟离线网络事件供 App 进入离线状态。
  await page.unroute(`${SERVER_URL}**`)
  await page.route(`${SERVER_URL}**`, (route) => route.abort())
  await page.reload()
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); window.dispatchEvent(new Event("offline")) })
  await expect(page.locator(".note-editor:visible .cm-content")).toBeVisible()
  await prepare()
})
