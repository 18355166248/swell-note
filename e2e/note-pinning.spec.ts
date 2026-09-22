import { expect, test, type Page } from "@playwright/test"

async function seedVault(page: Page) {
  await page.goto("/#/notes/view/all")
  // 独立浏览器测试库，不读取或写入用户的真实笔记文件。
  await page.evaluate(async () => {
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result
        for (const name of ["vaults", "settings", "attachments", "documents"]) {
          if (database.objectStoreNames.contains(name)) continue
          const store = database.createObjectStore(name, { keyPath: name === "vaults" ? "id" : "key" })
          if (name === "attachments" || name === "documents") store.createIndex("cacheId", "cacheId")
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const notes = ["最新笔记", "较早笔记", "最早笔记"].map((title, index) => ({
      id: `pin-${index}`, title, content: "", preview: `${title}摘要`,
      folder: "根目录", starred: false, readOnly: true,
      source: "local", modifiedAt: Date.now() - index * 86400000,
      updatedAt: "最近", contentLoaded: false,
    }))
    const transaction = db.transaction(["vaults", "settings"], "readwrite")
    transaction.objectStore("vaults").put({
      id: "e2e-note-pinning", label: "置顶测试库", activeNoteId: notes[0].id,
      notes, directories: [], sourceKind: "browser", savedAt: Date.now(),
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: "e2e-note-pinning" })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  })
  await page.reload()
}

async function storedPin(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const pinned = await new Promise<boolean | undefined>((resolve, reject) => {
      const get = db.transaction("vaults", "readonly").objectStore("vaults").get("e2e-note-pinning")
      get.onsuccess = () => resolve(get.result?.notes.find((note: { id: string }) => note.id === "pin-2")?.pinned)
      get.onerror = () => reject(get.error)
    })
    db.close()
    return pinned
  })
}

test("列表置顶和取消置顶，刷新后保留，支持只读笔记", async ({ page, isMobile }) => {
  await seedVault(page)
  const rows = page.locator(".note-list-row:visible")
  await expect(rows.first()).toContainText("最新笔记")

  const openActions = async () => {
    const row = rows.filter({ hasText: "最早笔记" })
    if (!isMobile) {
      await row.click({ button: "right" })
      return
    }
    const box = await row.boundingBox()
    if (!box) throw new Error("笔记行不可见")
    const session = await page.context().newCDPSession(page)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
    })
    await expect(page.getByRole("dialog")).toBeVisible()
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await session.detach()
  }

  await openActions()
  await page.getByRole(isMobile ? "button" : "menuitem", { name: "置顶笔记", exact: true }).click()
  await expect(rows.first()).toContainText("最早笔记")
  await expect(rows.first().getByLabel("已置顶")).toBeVisible()
  await expect.poll(() => storedPin(page)).toBe(true)

  await page.reload()
  await expect(rows.first()).toContainText("最早笔记")
  await openActions()
  await page.getByRole(isMobile ? "button" : "menuitem", { name: "取消置顶", exact: true }).click()
  await expect(rows.first()).toContainText("最新笔记")
  await expect(rows.getByLabel("已置顶")).toHaveCount(0)
  await expect.poll(() => storedPin(page)).toBe(false)
  await page.reload()
  await expect(rows.first()).toContainText("最新笔记")
})
