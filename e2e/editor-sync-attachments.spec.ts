import { expect, test } from "@playwright/test"
import { connectMockWebDav, MockWebDavServer, SERVER_URL } from "./mock-webdav-server"

for (const outcome of ["success", "cancel", "failure"] as const) {
  test(`附件上传中持续编辑，${outcome} 后新正文保留本机且不混入上传快照`, async ({ page }) => {
    const server = new MockWebDavServer()
    server.addFile("/Swell/note.md", "原文")
    let started = false, release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    await page.route(`${SERVER_URL}**`, async (route) => {
      if (route.request().method() === "PUT" && route.request().url().includes("/attachments/")) {
        started = true
        await gate
        if (outcome === "failure") return route.fulfill({ status: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: "test failure" })
      }
      return server.handler(route)
    })
    try {
      // 连接界面先完成渲染，库元数据随后落盘；等待真实缓存建立再预置附件。
      await connectMockWebDav(page)
      await expect.poll(() => page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("swell-note-vault-cache", 3); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
        try {
          return await new Promise<string>((resolve, reject) => { const r = db.transaction("settings").objectStore("settings").get("last-cache"); r.onsuccess = () => resolve(r.result?.value ?? ""); r.onerror = () => reject(r.error) })
        } finally { db.close() }
      })).not.toBe("")
      await expect(page.getByRole("button", { name: "同步当前笔记库", exact: true })).toBeEnabled()
      await page.evaluate(() => { location.hash = `/notes/${encodeURIComponent("webdav:/Swell/note.md")}` })
      const workspace = page.locator(".note-editor:visible"), editor = workspace.locator(".cm-content")
      await expect(editor).toBeVisible()
      await editor.press("ControlOrMeta+End")
      await editor.pressSequentially("上传快照")
      // 预置独立待同步附件，不需要真实文件选择或真实 WebDAV 写入。
      await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("swell-note-vault-cache", 3); r.onsuccess = () => resolve(r.result) })
        const cacheId = await new Promise<string>((resolve) => { const r = db.transaction("settings").objectStore("settings").get("last-cache"); r.onsuccess = () => resolve(r.result?.value ?? "") })
        if (!cacheId) throw new Error("测试库缓存尚未建立")
        const path = "/Swell/attachments/test.bin", tx = db.transaction("attachments", "readwrite")
        tx.objectStore("attachments").put({ cacheId, key: `${cacheId}\u0000${path}`, path, noteId: "webdav:/Swell/note.md", data: new Uint8Array([1, 2]).buffer, status: "pending", createdAt: Date.now() })
        await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() }); db.close()
      })
      await workspace.getByRole("button", { name: "同步坚果云笔记库" }).click()
      await expect.poll(() => started).toBe(true)
      await expect(editor).toHaveAttribute("contenteditable", "true")
      await editor.pressSequentially("附件期间新输入")
      if (outcome === "cancel") await page.getByRole("button", { name: "取消同步", exact: true }).click()
      release()
      await expect(workspace.getByRole("button", { name: "同步坚果云笔记库" })).toBeEnabled()
      await expect(editor).toContainText("附件期间新输入")
      if (outcome === "success") expect(server.readFile("/Swell/note.md")).toBe("原文上传快照")
      else expect(server.readFile("/Swell/note.md")).toBe("原文")
      const saved = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("swell-note-vault-cache", 3); r.onsuccess = () => resolve(r.result) })
        const entries = await new Promise<{ content: string; noteId: string }[]>((resolve) => { const r = db.transaction("documents").objectStore("documents").getAll(); r.onsuccess = () => resolve(r.result) }); db.close()
        return entries.find((entry) => entry.noteId === "webdav:/Swell/note.md")?.content
      })
      expect(saved).toBe("原文上传快照附件期间新输入")
    } finally { release() }
  })
}
