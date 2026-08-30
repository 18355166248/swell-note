import { expect, test, type Page } from "@playwright/test"

async function seedCachedVault(page: Page) {
  await page.goto("/#/notes")
  await page.evaluate(async () => {
    const cacheId = "e2e-vault"
    const noteA = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/第一篇.md",
      preview: "第一篇摘要",
      readOnly: false,
      remotePath: "/Swell/测试/第一篇.md",
      revision: '"a1"',
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title: "第一篇",
      updatedAt: "刚刚",
    }
    const noteB = {
      ...noteA,
      id: "webdav:/Swell/测试/第二篇.md",
      preview: "第二篇摘要",
      remotePath: "/Swell/测试/第二篇.md",
      revision: '"b1"',
      title: "第二篇",
    }
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("vaults")) db.createObjectStore("vaults", { keyPath: "id" })
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" })
        if (!db.objectStoreNames.contains("attachments")) {
          const store = db.createObjectStore("attachments", { keyPath: "key" })
          store.createIndex("cacheId", "cacheId")
        }
        if (!db.objectStoreNames.contains("documents")) {
          const store = db.createObjectStore("documents", { keyPath: "key" })
          store.createIndex("cacheId", "cacheId")
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(["vaults", "settings", "documents"], "readwrite")
    transaction.objectStore("vaults").put({
      activeNoteId: noteA.id,
      directories: ["测试"],
      id: cacheId,
      label: "E2E 离线库",
      lastSyncedAt: Date.now(),
      notes: [noteA, noteB],
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    for (const [note, content] of [[noteA, "# 第一篇\n\n正文 A"], [noteB, "# 第二篇\n\n正文 B"]] as const) {
      transaction.objectStore("documents").put({
        baseContent: content,
        cacheId,
        content,
        key: `${cacheId}\u0000${note.id}`,
        noteId: note.id,
        outgoingLinks: [],
        path: note.remotePath,
        tags: [],
        title: note.title,
      })
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  })
  await page.reload()
}

test.describe("核心笔记流程", () => {
  test("桌面端缓存启动、切换笔记、显示模式保持和版本历史入口", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".desktop-workspace:visible")

    await expect(workspace.getByText("第一篇", { exact: true }).first()).toBeVisible()
    await workspace.getByText("第二篇", { exact: true }).first().click()
    await expect(page).toHaveURL(/#\/notes\/webdav/)
    await expect(workspace.getByRole("article").getByText("正文 B", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "编辑模式" }).click()
    await expect(page.getByRole("button", { name: "编辑模式" })).toHaveAttribute("aria-pressed", "true")
    await workspace.getByText("第一篇", { exact: true }).first().click()
    await expect(page.getByRole("button", { name: "编辑模式" })).toHaveAttribute("aria-pressed", "true")
    await page.reload()
    await expect(page.getByRole("button", { name: "编辑模式" })).toHaveAttribute("aria-pressed", "true")

    await page.getByRole("button", { name: "更多操作" }).click()
    await page.getByRole("menuitem", { name: /本地版本历史/ }).click()
    await expect(page.getByRole("heading", { name: "本地版本历史" })).toBeVisible()
    await expect(page.getByText("编辑并保存后，这里会出现修改前的版本。")).toBeVisible()

    await page.goto("/#/settings/storage")
    await expect(page.getByRole("heading", { name: "本机数据状态" })).toBeVisible()
    await expect(page.getByRole("button", { name: /备份 ZIP/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /恢复 ZIP/ })).toBeVisible()
  })

  test("移动端搜索确认会失焦，清空后恢复全部数据", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    const search = workspace.getByRole("textbox", { name: "搜索笔记" })
    await search.fill("第二篇")
    await search.press("Enter")
    await expect(search).not.toBeFocused()
    await expect(workspace.getByText("第二篇", { exact: true }).first()).toBeVisible()
    await expect(workspace.getByText("第一篇", { exact: true })).toHaveCount(0)

    await workspace.getByRole("button", { name: "清空搜索" }).click()
    await expect(search).toHaveValue("")
    await expect(workspace.getByText("第一篇", { exact: true }).first()).toBeVisible()
    await expect(search).not.toBeFocused()
  })

  test("深色模式刷新后保持且主要工作区没有浅色断层", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    await page.evaluate(() => {
      localStorage.setItem("swell-note:ui-preferences:v1", JSON.stringify({ colorMode: "dark", noteViewMode: "read" }))
    })
    await page.reload()

    await expect(page.locator("html")).toHaveClass(/dark/)
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark")
    for (const selector of [".navigation-rail", ".note-list-panel", ".note-editor"]) {
      await expect(page.locator(selector)).not.toHaveCSS("background-color", "rgb(255, 255, 255)")
    }

    await page.goto("/#/settings/storage")
    await expect(page.locator(".settings-route-shell")).not.toHaveCSS("background-color", "rgb(255, 255, 255)")
    await expect(page.getByRole("heading", { name: "本机数据状态" })).toBeVisible()
  })
})
