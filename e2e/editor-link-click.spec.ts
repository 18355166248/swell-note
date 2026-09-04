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
    const contentA = [
      "# 第一篇",
      "",
      "标准笔记链接：[第二篇](./%E7%AC%AC%E4%BA%8C%E7%AF%87.md)",
      "",
      "双链：[[第二篇]]",
      "",
      "裸 URL：https://example.com/page",
      "",
      "外部链接：[示例站](https://example.com)",
      "",
    ].join("\n")
    for (const [note, content] of [[noteA, contentA], [noteB, "# 第二篇\n\n正文 B"]] as const) {
      transaction.objectStore("documents").put({
        baseContent: content,
        cacheId,
        content,
        key: `${cacheId} ${note.id}`,
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

test.describe("编辑态链接点击跳转", () => {
  test("桌面端点击笔记链接与外链", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".desktop-workspace:visible")
    await expect(workspace.getByText("第一篇", { exact: true }).first()).toBeVisible()

    await page.getByRole("button", { name: "编辑模式" }).click()
    const editor = page.locator(".cm-content")
    await expect(editor).toBeVisible()
    // 点走编辑器，确保链接行不处于光标激活态。
    await page.mouse.click(20, 20)

    // 标准 Markdown 笔记链接：点击文字直接跳转。
    await editor.getByText("第二篇", { exact: true }).first().click()
    await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)

    // wiki 双链：同样单击跳转。
    await workspace.getByText("第一篇", { exact: true }).first().click()
    await page.getByRole("button", { name: "编辑模式" }).click()
    await page.mouse.click(20, 20)
    await page.locator(".cm-content .cm-md-link-actionable[data-wiki-target]").first().click()
    await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)

    // 外链：mousedown 与 click 去重后恰好打开一次。
    await workspace.getByText("第一篇", { exact: true }).first().click()
    await page.getByRole("button", { name: "编辑模式" }).click()
    await page.mouse.click(20, 20)
    await page.evaluate(() => {
      (window as unknown as { __openCalls: string[] }).__openCalls = []
      window.open = (...args: unknown[]) => {
        (window as unknown as { __openCalls: string[] }).__openCalls.push(String(args[0]))
        return null
      }
    })
    await page.locator(".cm-content .cm-md-link-actionable[data-md-href]").first().click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __openCalls: string[] }).__openCalls))
      .toEqual(["https://example.com/page"])
  })

  test("移动端触屏点按笔记链接", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")

    await workspace.getByRole("button", { name: "编辑模式" }).click()
    await expect(page.locator(".cm-content")).toBeVisible()

    // iOS WebView 的点按不一定合成 mousedown，靠 click 兜底也要能跳转。
    await page.locator(".cm-content .cm-md-link-actionable[data-md-note-target]").first().tap()
    await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)
  })
})
