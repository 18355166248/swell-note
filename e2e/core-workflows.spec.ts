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

  test("桌面端失效详情链接不会继续展示上一篇笔记", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const missingId = "webdav:/Swell/测试/已经移动.md"

    await page.goto(`/#/notes/${encodeURIComponent(missingId)}`)
    await expect(page.getByRole("heading", { name: "找不到这篇笔记" })).toBeVisible()
    await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveCount(0)
    const duplicateIds = await page.locator("[id]").evaluateAll((elements) => {
      const counts = new Map<string, number>()
      for (const element of elements) counts.set(element.id, (counts.get(element.id) ?? 0) + 1)
      return [...counts.entries()].filter(([, count]) => count > 1)
    })
    expect(duplicateIds).toEqual([])
    await page.getByRole("button", { name: "返回笔记列表" }).click()
    await expect(page).toHaveURL(/#\/notes(?:\/view\/all)?$/)
  })

  test("移动端直达失效链接会展示恢复页并可打开相似笔记", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const missingId = "webdav:/Swell/测试/第一篇旧版.md"

    await page.goto(`/#/notes/${encodeURIComponent(missingId)}`)
    const workspace = page.locator(".mobile-workspace:visible")
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await expect(workspace.getByRole("heading", { name: "找不到这篇笔记" })).toBeVisible()
    await workspace.getByRole("button", { name: /第一篇/ }).click()
    await expect(page).toHaveURL(/#\/notes\/webdav/)
    await expect(workspace.getByRole("textbox", { name: "笔记标题" })).toHaveValue("第一篇")
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

  test("移动端侧滑跟随手势并在松手后返回或打开导航", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    await workspace.getByText("测试", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "notes")
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await page.mouse.move(6, 360)
    await page.mouse.down()
    await page.mouse.move(70, 362, { steps: 5 })
    await expect(workspace.locator(".mobile-edge-swipe-previous")).toBeVisible()
    await expect(workspace.locator(".mobile-edge-swipe-previous").getByText("测试", { exact: true }).first()).toBeVisible()
    await page.mouse.move(110, 362, { steps: 2 })
    await page.mouse.up()
    await expect(workspace).toHaveAttribute("data-screen", "notes", { timeout: 1_000 })

    await page.mouse.move(6, 360)
    await page.mouse.down()
    await page.mouse.move(92, 362, { steps: 5 })
    await expect(workspace).toHaveAttribute("data-edge-swipe-state", "dragging")
    await expect(workspace.locator(".mobile-edge-swipe-current")).not.toHaveCSS("transform", "none")
    await expect(workspace.locator(".mobile-edge-swipe-previous").getByText("笔记库", { exact: true })).toBeVisible()
    await page.mouse.up()
    await expect(workspace).toHaveAttribute("data-screen", "library", { timeout: 1_000 })

    const rootPage = workspace.locator(".mobile-edge-swipe-current")
    const rootLeft = (await rootPage.boundingBox())?.x
    await page.mouse.move(6, 360)
    await page.mouse.down()
    await page.mouse.move(100, 361, { steps: 5 })
    await expect(workspace).toHaveAttribute("data-edge-swipe-state", "dragging")
    expect((await rootPage.boundingBox())?.x).toBe(rootLeft)
    await expect(workspace.locator(".mobile-edge-swipe-previous")).toHaveCount(0)
    await page.mouse.up()
    await expect(page.getByRole("dialog", { name: "主导航" })).toBeVisible({ timeout: 1_000 })
  })

  test("移动端阅读页保留高频操作并从更多菜单打开大纲", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await expect(workspace.getByRole("button", { name: "同步坚果云笔记库" })).toBeVisible()
    await expect(workspace.getByRole("button", { name: "阅读模式" })).toBeVisible()
    await expect(workspace.getByRole("button", { name: "文档大纲" })).toHaveCount(0)
    await expect(workspace.getByRole("button", { name: "收藏" })).toHaveCount(0)

    await workspace.getByRole("button", { name: "更多操作" }).click()
    await page.getByRole("menuitem", { name: /文档大纲/ }).click()
    const outline = page.getByRole("dialog", { name: "文档大纲" })
    await expect(outline).toBeVisible()
    await expect(outline.getByRole("button", { name: "第一篇 H1" })).toBeVisible()
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

    await page.getByRole("button", { name: "编辑模式" }).click()
    await expect(page.locator(".note-editor[data-view-mode='edit'] .editor-scroll"))
      .not.toHaveCSS("background-color", "rgb(255, 255, 255)")

    await page.goto("/#/settings/storage")
    await expect(page.locator(".settings-route-shell")).not.toHaveCSS("background-color", "rgb(255, 255, 255)")
    await expect(page.getByRole("heading", { name: "本机数据状态" })).toBeVisible()
  })
})
