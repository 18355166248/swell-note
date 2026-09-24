import { expect, test, type Page } from "@playwright/test"

import { lockUnifiedCanvas, useCompatibilityPreview, useUnifiedCanvas } from "./note-view-mode"
import { createVaultBackup } from "../src/services/backup/vault-backup"

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
  test("恢复备份先预览同名与新增文件，确认后才写入", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    await page.evaluate(() => localStorage.setItem("swell-note:webdav-config:v1", JSON.stringify({
      provider: "jianguoyun", remotePath: "/Swell/", serverUrl: "https://dav.jianguoyun.com/dav/", username: "e2e@example.com",
    })))
    await page.reload()
    await page.goto("/#/settings/storage")
    await expect(page.getByText("本机版本历史不包含在 ZIP 内", { exact: false })).toBeVisible()
    const archive = createVaultBackup({
      attachments: [{ data: new Uint8Array([1, 2, 3]), path: "attachments/picture.png" }],
      label: "测试备份",
      notes: [
        { content: "# 旧正文", path: "测试/第一篇.md" },
        { content: "# 恢复正文", path: "测试/恢复笔记.md" },
      ],
    })
    const chooseBackup = () => page.locator('input[type="file"][accept*=".swell.zip"]').setInputFiles({
      buffer: Buffer.from(archive), mimeType: "application/zip", name: "test.swell.zip",
    })
    await chooseBackup()
    const dialog = page.getByRole("dialog", { name: "预览整库恢复" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("备份不包含原设备的版本历史", { exact: false })).toBeVisible()
    await expect(dialog.getByText("测试/第一篇.md")).toBeVisible()
    await expect(dialog.getByText("已存在，跳过")).toBeVisible()
    await expect(dialog.getByText("测试/恢复笔记.md")).toBeVisible()
    await dialog.getByRole("button", { name: "取消" }).click()
    await expect(dialog).not.toBeVisible()

    await chooseBackup()
    await dialog.getByRole("button", { name: "确认恢复" }).click()
    await expect(dialog).not.toBeVisible()
    await page.goto("/#/notes")
    await expect(page.getByText("恢复笔记", { exact: true }).first()).toBeVisible()
  })

  test("标签编辑写回 Markdown 并在刷新后保留", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".desktop-workspace:visible")
    await expect(workspace.getByRole("button", { name: "编辑笔记标签" })).toBeVisible()
    await workspace.getByRole("button", { name: "编辑笔记标签" }).click()
    await page.getByRole("textbox", { name: "笔记标签" }).fill("#工作, 待办")
    await page.getByRole("button", { name: "保存标签" }).click()
    await expect(workspace.getByLabel("笔记标签").getByText("#工作")).toBeVisible()
    await expect(workspace.getByLabel("笔记标签").getByText("#待办")).toBeVisible()
    const readCachedContent = async () => page.evaluate(async () => {
      const request = indexedDB.open("swell-note-vault-cache", 3)
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const transaction = database.transaction("documents", "readonly")
      const documentRequest = transaction.objectStore("documents").get("e2e-vault\u0000webdav:/Swell/测试/第一篇.md")
      const content = await new Promise<string>((resolve, reject) => {
        documentRequest.onsuccess = () => resolve(documentRequest.result?.content ?? "")
        documentRequest.onerror = () => reject(documentRequest.error)
      })
      database.close()
      return content
    })
    await expect.poll(readCachedContent).toContain('tags: ["工作", "待办"]')
    await page.reload()
    await expect(workspace.getByLabel("笔记标签").getByText("#工作")).toBeVisible()
    const saved = await readCachedContent()
    expect(saved).toContain('tags: ["工作", "待办"]')
    expect(saved).toContain("# 第一篇")
  })

  test("桌面端统一画布锁定、解锁、刷新保持和版本历史入口", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".desktop-workspace:visible")

    await expect(workspace.getByText("第一篇", { exact: true }).first()).toBeVisible()
    await workspace.getByText("第二篇", { exact: true }).first().click()
    await expect(page).toHaveURL(/#\/notes\/webdav/)
    await expect(workspace.getByRole("article").getByText("正文 B", { exact: true })).toBeVisible()

    await expect(workspace.locator(".note-editor")).toHaveAttribute("data-view-mode", "unified")
    await lockUnifiedCanvas(page)
    await workspace.getByText("第一篇", { exact: true }).first().click()
    await expect(workspace.locator(".note-editor")).toHaveAttribute("data-view-mode", "locked")
    await page.reload()
    await expect(workspace.locator(".note-editor")).toHaveAttribute("data-view-mode", "locked")
    await useUnifiedCanvas(page)

    await page.getByRole("button", { name: "更多操作" }).click()
    await page.getByRole("menuitem", { name: /本地版本历史/ }).click()
    await expect(page.getByRole("heading", { name: "本地版本历史" })).toBeVisible()
    await expect(page.getByText("编辑并保存后，这里会出现修改前的版本。")).toBeVisible()

    await page.goto("/#/settings/storage")
    await expect(page.getByRole("heading", { name: "本机数据状态" })).toBeVisible()
    await expect(page.getByRole("button", { name: /备份 ZIP/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /恢复 ZIP/ })).toBeVisible()
  })

  test("兼容阅读下新建笔记直接进入统一画布，且不改写显式阅读偏好", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    await page.evaluate(() => {
      localStorage.setItem("swell-note:webdav-config:v1", JSON.stringify({
        provider: "jianguoyun",
        remotePath: "/Swell/",
        serverUrl: "https://dav.jianguoyun.com/dav/",
        username: "e2e@example.com",
      }))
    })
    await page.reload()
    const workspace = page.locator(".desktop-workspace:visible")

    await useCompatibilityPreview(page)
    await expect(workspace.getByText("当前使用兼容阅读视图")).toBeVisible()
    await workspace.getByRole("button", { name: "新建笔记" }).click()
    await expect(workspace.locator(".note-editor")).toHaveAttribute("data-view-mode", "unified")
    await expect(workspace.locator(".cm-content")).toBeVisible()

    // 只切当前视图：本次新建不会覆盖用户显式选择的兼容阅读偏好。
    const storedViewMode = await page.evaluate(() => {
      const raw = localStorage.getItem("swell-note:ui-preferences:v1")
      return raw ? (JSON.parse(raw) as { noteViewMode?: string }).noteViewMode ?? null : null
    })
    expect(storedViewMode).toBe("preview")
  })

  test("桌面端右键笔记与文件夹弹出自定义菜单并接上后续对话框", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".desktop-workspace:visible")

    // 云端笔记的正文缓存下来之后才允许改名/移动/删除，先打开一次再右键。
    await workspace.getByText("第二篇", { exact: true }).first().click()
    await expect(workspace.getByRole("article").getByText("正文 B", { exact: true })).toBeVisible()
    await workspace.getByText("第二篇", { exact: true }).first().click({ button: "right" })
    const noteMenu = page.getByRole("menu")
    await expect(noteMenu.getByRole("menuitem", { name: "打开笔记" })).toBeVisible()
    await expect(noteMenu.getByRole("menuitem", { name: "收藏" })).toBeVisible()
    await expect(noteMenu.getByRole("menuitem", { name: "删除笔记" })).toBeVisible()

    // 移动目标来自当前笔记库目录，子菜单里能选到根目录与已有文件夹。
    await noteMenu.getByRole("menuitem", { name: "移动到文件夹" }).hover()
    await expect(page.getByRole("menuitem", { name: "根目录" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "测试", exact: true })).toBeVisible()

    await noteMenu.getByRole("menuitem", { name: "重命名…" }).click()
    const renameDialog = page.getByRole("dialog")
    await expect(renameDialog.getByRole("heading", { name: "重命名笔记" })).toBeVisible()
    await expect(renameDialog.getByRole("textbox", { name: "新笔记标题" })).toHaveValue("第二篇")
    await renameDialog.getByRole("button", { name: "取消" }).click()

    // 侧栏文件夹右键给的是目录级操作。
    await workspace.locator(".library-row").filter({ hasText: "测试" }).first().click({ button: "right" })
    const folderMenu = page.getByRole("menu")
    await expect(folderMenu.getByRole("menuitem", { name: "在此新建笔记" })).toBeVisible()
    await expect(folderMenu.getByRole("menuitem", { name: "新建子文件夹…" })).toBeVisible()
    await folderMenu.getByRole("menuitem", { name: "删除文件夹" }).click()
    const deleteDialog = page.getByRole("dialog")
    await expect(deleteDialog.getByRole("heading", { name: "删除“测试”" })).toBeVisible()
    await deleteDialog.getByRole("button", { name: "取消" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("桌面端右键删除笔记会经确认后从列表移除", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".desktop-workspace:visible")

    await workspace.getByText("第二篇", { exact: true }).first().click()
    await expect(workspace.getByRole("article").getByText("正文 B", { exact: true })).toBeVisible()
    await workspace.getByText("第二篇", { exact: true }).first().click({ button: "right" })
    await page.getByRole("menuitem", { name: "删除笔记" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "删除“第二篇”" })).toBeVisible()
    await dialog.getByRole("button", { name: "删除笔记" }).click()

    await expect(workspace.locator(".note-list-panel").getByText("第二篇", { exact: true })).toHaveCount(0)
    await expect(workspace.locator(".note-list-panel").getByText("第一篇", { exact: true }).first()).toBeVisible()
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
    // 从恢复页打开已有笔记并保留统一画布；标题控件应绑定到新路由对应的笔记。
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

  test("移动端侧滑返回不会误打开手指下方的笔记", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    await workspace.getByText("测试", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "notes")
    // 记录手势全程出现过的页面：松手补发的 click 会打开手指下方的笔记，
    // 而手势的路由交接要等到 170ms 后，最终页面仍是正确的，只能靠中途的快照抓到这次误触。
    await page.evaluate(() => {
      const target = document.querySelector(".mobile-workspace") as HTMLElement
      const visited = new Set<string>([target.dataset.screen ?? ""])
      const observer = new MutationObserver(() => visited.add(target.dataset.screen ?? ""))
      observer.observe(target, { attributeFilter: ["data-screen"] })
      Object.assign(window, { __swipeObserver: observer, __visitedScreens: visited })
    })

    // 等页面入场动画落位，否则量到的行位置还带着动画偏移，起手点会落到行外面
    await page.waitForTimeout(400)
    // 起手高度取自真实的笔记行：手指必须压在可点击的行上，才能复现松手补发的那次 click
    const row = workspace.locator(".note-list-row").first()
    const rowBox = await row.boundingBox()
    const swipeY = Math.round((rowBox?.y ?? 360) + (rowBox?.height ?? 0) / 2)
    await page.mouse.move(6, swipeY)
    await page.mouse.down()
    // 逐帧推进，贴近真实滑动的节奏；一次性拖到位时事件会被合并，复现不出这次误触
    for (const x of [20, 45, 80, 120, 165, 210]) {
      await page.mouse.move(x, swipeY + 2, { steps: 2 })
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
    await expect(workspace).toHaveAttribute("data-screen", "library", { timeout: 1_000 })

    const visitedScreens = await page.evaluate(() => {
      const { __swipeObserver: observer, __visitedScreens: visited } = window as unknown as {
        __swipeObserver: MutationObserver
        __visitedScreens: Set<string>
      }
      observer.disconnect()
      return [...visited]
    })
    expect(visitedScreens).not.toContain("editor")
  })

  test("移动端路由返回复用真实列表 DOM 并保留筛选与取消现场", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    await workspace.getByText("测试", { exact: true }).first().click()
    const listEntry = workspace.locator(".mobile-edge-swipe-current")
    const search = listEntry.getByRole("textbox", { name: "搜索笔记" })
    await search.fill("第一篇")
    await search.press("Enter")
    await listEntry.evaluate((element) => { element.setAttribute("data-e2e-entry-identity", "kept-list") })
    await listEntry.getByText("第一篇", { exact: true }).first().click()

    const previous = workspace.locator(".mobile-edge-swipe-previous")
    await expect(previous).toHaveAttribute("data-e2e-entry-identity", "kept-list")
    await expect(previous.locator('input[aria-label="搜索笔记"]')).toHaveValue("第一篇")

    // 未过阈值的拖动只回弹，location 与底层 entry 都不能改变。
    const detailUrl = page.url()
    await page.mouse.move(6, 360)
    await page.mouse.down()
    await page.mouse.move(20, 361, { steps: 3 })
    await page.mouse.up()
    await expect(page).toHaveURL(detailUrl)
    await expect(previous).toHaveAttribute("data-e2e-entry-identity", "kept-list")

    await page.mouse.move(6, 360)
    await page.mouse.down()
    await page.mouse.move(120, 361, { steps: 6 })
    await page.mouse.up()
    const restored = workspace.locator(".mobile-edge-swipe-current")
    await expect(restored).toHaveAttribute("data-e2e-entry-identity", "kept-list")
    await expect(restored.getByRole("textbox", { name: "搜索笔记" })).toHaveValue("第一篇")
  })

  test("移动端真实 TouchEvent 完成返回且多点触摸取消", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")
    const libraryEntry = workspace.locator(".mobile-edge-swipe-current")
    await libraryEntry.evaluate((element) => { element.setAttribute("data-e2e-touch-return", "library") })
    await workspace.getByText("测试", { exact: true }).first().click()

    await workspace.evaluate(async (target) => {
      const touch = (identifier: number, x: number) => new Touch({ clientX: x, clientY: 320, identifier, target })
      target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(7, 6)] }))
      await new Promise((resolve) => setTimeout(resolve, 20))
      target.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(7, 140)] }))
      target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, changedTouches: [touch(7, 140)], touches: [] }))
    })
    await expect(workspace).toHaveAttribute("data-screen", "library")
    await expect(workspace.locator(".mobile-edge-swipe-current")).toHaveAttribute("data-e2e-touch-return", "library")

    await workspace.getByText("测试", { exact: true }).first().click()
    const listUrl = page.url()
    await workspace.evaluate(async (target) => {
      const touch = (identifier: number, x: number) => new Touch({ clientX: x, clientY: 320, identifier, target })
      target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(7, 6)] }))
      target.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(7, 70)] }))
      target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(7, 70), touch(8, 12)] }))
      target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, changedTouches: [touch(7, 150)], touches: [] }))
      await new Promise((resolve) => setTimeout(resolve, 260))
    })
    await expect(page).toHaveURL(listUrl)
    await expect(workspace).toHaveAttribute("data-edge-swipe-state", "idle")
  })

  test("移动端详情重命名以 REPLACE 保留编辑器并更新路由", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await expect(workspace.locator(".mobile-edge-swipe-current .cm-content")).toBeVisible()

    const editorEntry = workspace.locator(".mobile-edge-swipe-current")
    await editorEntry.evaluate((element) => { element.setAttribute("data-e2e-editor-identity", "rename-session") })
    const title = editorEntry.getByRole("textbox", { name: "笔记标题" })
    await title.fill("重命名后")
    await title.press("Enter")

    await expect(page).toHaveURL(/#\/notes\/webdav.*%E9%87%8D%E5%91%BD%E5%90%8D%E5%90%8E/)
    await expect(workspace.locator(".mobile-edge-swipe-current")).toHaveAttribute("data-e2e-editor-identity", "rename-session")
    await expect(workspace.locator(".mobile-edge-swipe-current").getByRole("textbox", { name: "笔记标题" })).toHaveValue("重命名后")
  })

  test("移动端缓存页失活会关闭其 Portal 弹层", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()

    await workspace.getByRole("button", { name: "重命名文件夹 测试" }).click()
    await expect(page.getByRole("dialog").getByText("重命名文件夹")).toBeVisible()
    await page.goBack()
    await expect(workspace).toHaveAttribute("data-screen", "library")
    await expect(page.getByRole("dialog")).toHaveCount(0)

    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await workspace.locator(".mobile-edge-swipe-current").getByRole("button", { name: "更多操作" }).click()
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click()
    await expect(page.getByRole("dialog").getByText("重命名笔记")).toBeVisible()
    await page.goBack()
    await expect(workspace).toHaveAttribute("data-screen", "notes")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first()).toBeVisible()
  })

  test("移动端空白草稿清理后 POP 回原列表实例", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    await page.evaluate(() => {
      localStorage.setItem("swell-note:webdav-config:v1", JSON.stringify({
        provider: "jianguoyun",
        remotePath: "/Swell/",
        serverUrl: "https://dav.jianguoyun.com/dav/",
        username: "e2e@example.com",
      }))
    })
    await page.reload()
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    // 点击完成只代表事件处理结束；先等待路由提交，避免把身份标记误贴到仍在退场的笔记库页。
    await expect(workspace).toHaveAttribute("data-screen", "notes")
    const listEntry = workspace.locator(".mobile-edge-swipe-current")
    await listEntry.evaluate((element) => { element.setAttribute("data-e2e-draft-return", "original-list") })
    await workspace.getByRole("button", { name: "在测试中新建笔记" }).click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")

    await workspace.getByRole("button", { name: "返回测试" }).click()
    await expect(workspace).toHaveAttribute("data-screen", "notes")
    await expect(workspace.locator(".mobile-edge-swipe-current")).toHaveAttribute("data-e2e-draft-return", "original-list")
    await expect(workspace.getByText("未命名笔记", { exact: true })).toHaveCount(0)
  })

  test("移动端从编辑器侧滑返回不会被编辑器抢走焦点", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".note-list-row").first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await expect(workspace.locator(".note-editor")).toHaveAttribute("data-view-mode", "unified")
    await expect(workspace.locator(".cm-content")).toBeVisible()
    await page.waitForTimeout(400)

    await page.evaluate(() => {
      const focused: string[] = []
      const onFocusIn = (event: FocusEvent) => {
        const target = event.target
        if (target instanceof Element) focused.push(target.className.toString())
      }
      document.addEventListener("focusin", onFocusIn, true)
      Object.assign(window, { __focusedDuringSwipe: focused, __removeFocusProbe: () => document.removeEventListener("focusin", onFocusIn, true) })
    })

    // 起手落在编辑器容器的留白上：浏览器会把光标塞进这一片里最近的 contenteditable，
    // 手机上编辑器一聚焦就顶起输入辅助栏，手势走完焦点又消失，布局一缩一放就是闪动。
    const canvas = workspace.locator(".document-canvas")
    const canvasBox = await canvas.boundingBox()
    const swipeY = Math.round((canvasBox?.y ?? 400) + 120)
    await page.mouse.move(6, swipeY)
    await page.mouse.down()
    for (const x of [20, 45, 80, 120, 165, 210]) {
      await page.mouse.move(x, swipeY + 1, { steps: 2 })
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
    await expect(workspace).toHaveAttribute("data-screen", "notes", { timeout: 1_000 })

    const focusedDuringSwipe = await page.evaluate(() => {
      const { __focusedDuringSwipe: focused, __removeFocusProbe: remove } = window as unknown as {
        __focusedDuringSwipe: string[]
        __removeFocusProbe: () => void
      }
      remove()
      return focused
    })
    expect(focusedDuringSwipe.filter((name) => name.includes("cm-content"))).toEqual([])
  })

  test("移动端统一画布保留高频操作并从更多菜单打开大纲", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await expect(workspace.getByRole("button", { name: "同步坚果云笔记库" })).toBeVisible()
    await expect(workspace.getByRole("button", { name: "文档大纲" })).toHaveCount(0)
    await expect(workspace.getByRole("button", { name: "收藏" })).toHaveCount(0)

    await workspace.getByRole("button", { name: "更多操作" }).click()
    await expect(page.getByRole("menuitem", { name: "锁定为只读阅读" })).toBeVisible()
    await page.getByRole("menuitem", { name: "查找当前笔记" }).click()
    await workspace.getByRole("textbox", { name: "查找当前笔记" }).fill("正文")
    await expect(workspace.locator(".editor-find-field")).toContainText("1/1")
    const closeFind = workspace.getByRole("button", { name: "关闭查找" })
    expect((await closeFind.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await closeFind.click()
    await expect(workspace.getByRole("search")).toHaveCount(0)
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
      localStorage.setItem("swell-note:ui-preferences:v1", JSON.stringify({ colorMode: "dark", noteViewMode: "unified" }))
    })
    await page.reload()

    await expect(page.locator("html")).toHaveClass(/dark/)
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark")
    for (const selector of [".navigation-rail", ".note-list-panel", ".note-editor"]) {
      await expect(page.locator(selector)).not.toHaveCSS("background-color", "rgb(255, 255, 255)")
    }

    await expect(page.locator(".note-editor[data-view-mode='unified'] .editor-scroll"))
      .not.toHaveCSS("background-color", "rgb(255, 255, 255)")

    await page.goto("/#/settings/storage")
    await expect(page.locator(".settings-route-shell")).not.toHaveCSS("background-color", "rgb(255, 255, 255)")
    await expect(page.getByRole("heading", { name: "本机数据状态" })).toBeVisible()
  })
})
