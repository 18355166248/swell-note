import { expect, test, type Page } from "@playwright/test"

async function seedRegressionVault(page: Page, count = 90) {
  await page.goto("/#/notes")
  await page.evaluate(async ({ count }) => {
    const cacheId = "six-regressions"
    const notes = Array.from({ length: count }, (_, index) => {
      const folder = index === 0 ? "其他" : "目标 / 子目录"
      const title = index === count - 1 ? "终点笔记" : `搜索结果 ${String(index + 1).padStart(3, "0")}`
      const remotePath = `/Swell/${folder.replaceAll(" / ", "/")}/${title}.md`
      return {
        content: "",
        contentCached: true,
        contentLoaded: false,
        folder,
        id: `webdav:${remotePath}`,
        preview: `公共检索词 正文 ${index}`,
        readOnly: false,
        remotePath,
        revision: `"v${index}"`,
        source: "webdav",
        starred: index === 0,
        syncStatus: "synced",
        tags: index === 1 ? ["计划"] : [],
        title,
        updatedAt: "刚刚",
      }
    })
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
    const fillerDirectories = Array.from({ length: 30 }, (_, index) => `A-${String(index + 1).padStart(2, "0")}`)
    transaction.objectStore("vaults").put({
      activeNoteId: notes[0].id,
      directories: [...fillerDirectories, "其他", "目标", "目标 / 子目录"],
      id: cacheId,
      label: "六项回归库",
      notes,
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    for (const [index, note] of notes.entries()) {
      const content = index === 0 ? "" : `# ${note.title}\n\n公共检索词 正文 ${index}`
      transaction.objectStore("documents").put({
        baseContent: content,
        cacheId,
        content,
        key: `${cacheId}\u0000${note.id}`,
        noteId: note.id,
        outgoingLinks: [],
        path: note.remotePath,
        tags: note.tags,
        title: note.title,
      })
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, { count })
  await page.reload()
}

async function openFirstEmptyNote(page: Page, mobile: boolean) {
  const workspace = page.locator(`${mobile ? ".mobile-workspace" : ".desktop-workspace"}:visible`)
  if (mobile) {
    await workspace.getByText("其他", { exact: true }).first().click()
    await workspace.getByText("搜索结果 001", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
  }
  return workspace
}

test.describe("六项反馈浏览器回归", () => {
  test("空笔记点击任务列表后可显示、勾选、撤销重做并在重开后保留", async ({ page }, testInfo) => {
    await seedRegressionVault(page)
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = await openFirstEmptyNote(page, mobile)
    const editor = workspace.locator(".cm-content:visible")
    await editor.click()
    await workspace.getByRole("button", { name: "任务列表" }).click()
    await expect(editor.locator(".cm-md-task-checkbox")).toHaveCount(1)
    await expect(editor).toHaveText("")

    await page.keyboard.press("ControlOrMeta+z")
    await expect(editor.locator(".cm-md-task-checkbox")).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+Shift+z")
    await expect(editor.locator(".cm-md-task-checkbox")).toHaveCount(1)
    await editor.locator(".cm-md-task-checkbox").click()
    await expect(editor.locator(".cm-md-task-checkbox")).toBeChecked()
    await page.waitForTimeout(650)
    await page.reload()
    const reopenedEditor = page.locator(".cm-content:visible")
    await reopenedEditor.click()
    await reopenedEditor.press("End")
    await expect(reopenedEditor.locator(".cm-md-task-checkbox")).toBeChecked()
  })

  test("大量全局搜索结果使用单一受限滚动宿主并可加载到末页", async ({ page }) => {
    await seedRegressionVault(page)
    await page.getByRole("button", { name: /全局搜索/ }).first().click()
    await page.getByRole("combobox", { name: "全局搜索笔记" }).fill("公共检索词")
    const viewport = page.locator("[data-search-scroll-viewport]")
    await expect(page.locator(".global-search-results [role=option]")).toHaveCount(50)
    const before = await viewport.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }))
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight)
    await viewport.hover()
    await page.mouse.wheel(0, 1400)
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await page.getByRole("button", { name: /加载更多/ }).click()
    await expect(page.locator(".global-search-results [role=option]")).toHaveCount(90)
    await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(page.locator(".global-search-results [role=option]").last()).toBeInViewport()
  })

  test("全局搜索的范围、标签、目录筛选组合在浏览器中生效", async ({ page }) => {
    await seedRegressionVault(page)
    await page.getByRole("button", { name: /全局搜索/ }).first().click()
    const query = page.getByRole("combobox", { name: "全局搜索笔记" })
    await query.fill("公共检索词")
    await page.getByLabel("搜索范围").selectOption("title")
    await expect(page.locator(".global-search-summary")).toContainText("找到 0 篇")
    await page.getByLabel("搜索范围").selectOption("body")
    await expect(page.locator(".global-search-summary")).toContainText("找到 89 篇")
    await page.getByLabel("筛选标签").selectOption("计划")
    await expect(page.locator(".global-search-summary")).toContainText("找到 1 篇")
    await page.getByLabel("筛选目录").selectOption("其他")
    await expect(page.locator(".global-search-summary")).toContainText("找到 0 篇")
    await page.getByLabel("筛选目录").selectOption("目标")
    await expect(page.locator(".global-search-summary")).toContainText("找到 1 篇")
  })

  test("全局搜索键盘跨页往返后活动项仍在结果视口内", async ({ page }) => {
    await seedRegressionVault(page)
    await page.getByRole("button", { name: /全局搜索/ }).first().click()
    const combobox = page.getByRole("combobox", { name: "全局搜索笔记" })
    await combobox.fill("公共检索词")
    for (let index = 0; index < 55; index += 1) await combobox.press("ArrowDown")
    await expect(page.locator(".global-search-results [role=option]")).toHaveCount(90)
    for (let index = 0; index < 55; index += 1) await combobox.press("ArrowUp")

    const visible = await page.locator('[role="option"][aria-selected="true"]').evaluate((active) => {
      const viewport = active.closest<HTMLElement>("[data-search-scroll-viewport]")
      if (!viewport) return false
      const activeRect = active.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      return activeRect.top >= viewportRect.top && activeRect.bottom <= viewportRect.bottom
    })
    expect(visible).toBe(true)
  })

  test("搜索打开深层末尾笔记时清理旧筛选并定位目录与虚拟列表", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedRegressionVault(page)
    const workspace = page.locator(".desktop-workspace:visible")
    await workspace.locator('[data-folder-path="其他"] .library-row-main').click()
    await workspace.getByRole("button", { name: /全局搜索/ }).click()
    await page.getByRole("combobox", { name: "全局搜索笔记" }).fill("终点笔记")
    await page.getByRole("option", { name: /终点笔记/ }).click()

    await expect(page).toHaveURL(/#\/notes\/webdav/)
    await expect(workspace.locator('[data-folder-path="目标 / 子目录"]')).toHaveAttribute("data-active", "true")
    const libraryViewport = workspace.locator(".library-folder-scroll [data-slot='scroll-area-viewport']")
    expect(await libraryViewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(workspace.locator(".note-list-row[data-active='true']")).toContainText("终点笔记")
    const listViewport = workspace.locator(".note-list-scroll [data-slot='scroll-area-viewport']")
    expect(await listViewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  })
})
