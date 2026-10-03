import { expect, type Page } from "@playwright/test"

// 所有能力验收都用独立缓存库；不连接真实 WebDAV，不修改用户笔记。
export async function seedCapabilityNote(page: Page, content: string, readOnly = false) {
  await page.goto("/#/notes")
  await page.evaluate(async ({ content, readOnly }) => {
    const cacheId = "editor-capability-test", noteId = `${readOnly ? "browser" : "webdav"}:/Swell/测试/第一篇.md`
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const db = request.result
        for (const store of ["vaults", "settings"]) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: store === "vaults" ? "id" : "key" })
        for (const name of ["attachments", "documents"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "key" }).createIndex("cacheId", "cacheId")
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(["vaults", "settings", "documents"], "readwrite")
    transaction.objectStore("vaults").put({
      activeNoteId: noteId, directories: ["测试"], id: cacheId, label: "编辑能力测试库", sourceKind: readOnly ? "browser" : "webdav", savedAt: Date.now(),
      // WebDAV 的已缓存工作副本恢复后可编辑；真正的本地离线缓存才走源文件只读分支。
      notes: [{ id: noteId, content: "", contentLoaded: false, contentCached: true, folder: "测试", preview: "能力验收", readOnly, remotePath: "/Swell/测试/第一篇.md", revision: '"v1"', source: readOnly ? "local" : "webdav", starred: false, syncStatus: "synced", title: "第一篇", updatedAt: "刚刚" }],
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    transaction.objectStore("documents").put({ baseContent: content, cacheId, content, key: `${cacheId}\u0000${noteId}`, noteId, path: "/Swell/测试/第一篇.md", outgoingLinks: [], tags: [], title: "第一篇" })
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
    database.close()
  }, { content, readOnly })
  await page.reload()
  const mobile = page.locator(".mobile-workspace:visible")
  if (await mobile.count()) {
    if (await mobile.getAttribute("data-screen") === "library") await mobile.getByRole("button", { name: /^测试 \d+$/ }).click()
    if (await mobile.getAttribute("data-screen") !== "editor") await mobile.locator(".note-list-row").getByText("第一篇", { exact: true }).click()
  }
  await expect(page.locator(".note-editor:visible .cm-content")).toBeVisible()
  if (readOnly) await expect(page.locator(".note-editor:visible .cm-content")).toHaveAttribute("contenteditable", "false")
}

export async function capabilityContent(page: Page, readOnly = false) {
  return page.evaluate(async (readOnly) => {
    const database = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("swell-note-vault-cache", 3); request.onsuccess = () => resolve(request.result) })
    try {
      return await new Promise<string>((resolve) => {
        const request = database.transaction("documents").objectStore("documents").get(`editor-capability-test\u0000${readOnly ? "browser" : "webdav"}:/Swell/测试/第一篇.md`)
        request.onsuccess = () => resolve(request.result?.content ?? "")
      })
    } finally { database.close() }
  }, readOnly)
}
