import { expect, test } from "@playwright/test"
import { connectMockWebDav, MockWebDavServer, SERVER_URL } from "./mock-webdav-server"

// 复现真机遗留状态：旧目录的冲突副本与正常云端路径缓存并存；整个测试只使用隔离的内存 WebDAV。
test("旧路径 404 后确认真实云端路径，去重、保存历史并在重载后保持已解决", async ({ page }) => {
  const server = new MockWebDavServer()
  const path = "/Swell/XIMA广告/免费模式场景新增下载专区.md"
  const oldPath = "/Swell/XIMA广告1/免费模式场景新增下载专区.md"
  const oldId = `webdav:${oldPath}`
  server.addFile(path, "# 最新云端正文\n\n云端修订内容")
  await page.route(`${SERVER_URL}**`, server.handler)
  page.on("dialog", (dialog) => dialog.accept())
  await connectMockWebDav(page)
  // 在同源空页面预置快照，避免旧页面尚未结束的防抖保存覆盖测试注入的冲突。
  await page.route("**/seed-conflict", (route) => route.fulfill({ contentType: "text/html", body: "<html></html>" }))
  await page.goto("/seed-conflict")
  await page.evaluate(async ({ oldId, oldPath }) => {
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result) })
    const tx = db.transaction(["vaults", "documents"], "readwrite")
    const store = tx.objectStore("vaults")
    const all = store.getAll()
    all.onsuccess = () => {
      const cache = all.result[0]
      const source = { ...cache.notes[0], id: oldId, remotePath: oldPath, folder: "XIMA广告1", content: "", baseContent: undefined, contentCached: true, contentLoaded: false, syncStatus: "conflict", revision: "old-etag", syncError: "旧错误" }
      store.put({ ...cache, activeNoteId: oldId, notes: [...cache.notes, source] })
      tx.objectStore("documents").put({ cacheId: cache.id, noteId: oldId, key: `${cache.id}\u0000${oldId}`, path: oldPath, content: "保留本地独有修改", baseContent: "旧正文", title: source.title })
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  }, { oldId, oldPath })
  // 重连恢复适配器；读取目录时保留旧路径工作副本，和手机现场一致。
  await connectMockWebDav(page)
  await page.evaluate((id) => { window.location.hash = `/notes/${encodeURIComponent(id)}` }, oldId)
  await expect(page.locator(".sync-conflict-banner:visible")).toContainText("旧错误")
  await page.getByRole("button", { name: "采用云端版本", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText(oldPath)
  await expect(dialog).toContainText(path)
  let releaseRead!: () => void
  let readStarted!: () => void
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
  const started = new Promise<void>((resolve) => { readStarted = resolve })
  await page.route(`${SERVER_URL}**`, async (route) => {
    if (route.request().method() === "GET" && decodeURIComponent(new URL(route.request().url()).pathname) === `/dav${path}`) {
      readStarted()
      await readGate
    }
    await server.handler(route)
  })
  await dialog.getByRole("button", { name: `采用云端文件：${path}`, exact: true }).click()
  await started
  // 恢复期间退后台：生命周期保存必须等待恢复检查点，不能抢先写回旧路径快照。
  await page.evaluate(async () => {
    const modulePath = "/src/services/vault/save-lifecycle.ts"
    const { flushLifecycleSave } = await import(modulePath)
    ;(window as any).conflictBackgroundSaved = false
    void flushLifecycleSave("background").then(() => { (window as any).conflictBackgroundSaved = true })
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  expect(await page.evaluate(() => (window as any).conflictBackgroundSaved)).toBe(false)
  releaseRead()
  await expect(page.locator(".cm-content:visible")).toContainText("最新云端正文")
  await expect.poll(() => page.evaluate(() => (window as any).conflictBackgroundSaved)).toBe(true)
  await expect(page.locator(".sync-conflict-banner:visible")).toHaveCount(0)
  expect(server.putCount(path)).toBe(0)
  expect(server.putCount(oldPath)).toBe(0)
  const snapshot = await page.evaluate(async () => {
    const open = (name: string, version: number) => new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open(name, version); r.onsuccess = () => resolve(r.result) })
    const db = await open("swell-note-vault-cache", 3)
    const caches = await new Promise<any[]>((resolve) => { const r = db.transaction("vaults").objectStore("vaults").getAll(); r.onsuccess = () => resolve(r.result) })
    db.close()
    const history = await open("swell-note-history", 1)
    const versions = await new Promise<any[]>((resolve) => { const r = history.transaction("versions").objectStore("versions").getAll(); r.onsuccess = () => resolve(r.result) })
    history.close()
    return { notes: caches[0].notes, versions }
  })
  expect(snapshot.notes).toHaveLength(1)
  expect(snapshot.notes[0]).toMatchObject({ remotePath: path, syncStatus: "synced" })
  expect(snapshot.versions).toContainEqual(expect.objectContaining({ noteId: `webdav:${path}`, content: "保留本地独有修改" }))
  await page.reload()
  await expect(page.locator(".cm-content:visible")).toContainText("最新云端正文")
  await expect(page.locator(".sync-conflict-banner:visible")).toHaveCount(0)
})
