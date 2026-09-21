import { expect, test, type Page } from "@playwright/test"

// 覆盖「默认不进入全部笔记」：
//   - 打开着笔记时侧栏与列表都跟随它所在的目录，而不是切到全库；
//   - 「全部笔记」只有显式点选才进入；
//   - 确实没有目录上下文时（库里有目录但还没有笔记）才落回空态引导。
//
// 独立测试数据：只写入 IndexedDB 缓存库 e2e-default-selection，不触碰任何真实笔记库。

type SeedNote = { folder: string; title: string }

async function seedVault(page: Page, options: { activeNoteId?: string; directories: string[]; notes: SeedNote[] }) {
  await page.goto("/#/notes")
  await page.evaluate(async ({ activeNoteId, directories, notes }) => {
    const cacheId = "e2e-default-selection"
    const stored = notes.map(({ folder, title }, index) => ({
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder,
      id: `webdav:/Swell/${folder}/${title}.md`,
      preview: `${title}摘要`,
      readOnly: false,
      remotePath: `/Swell/${folder}/${title}.md`,
      revision: `"r${index}"`,
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title,
      updatedAt: "刚刚",
    }))
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
    const transaction = database.transaction(["vaults", "settings"], "readwrite")
    transaction.objectStore("vaults").put({
      activeNoteId: activeNoteId ?? stored[0]?.id ?? "",
      directories,
      id: cacheId,
      label: "E2E 默认选中库",
      lastSyncedAt: Date.now(),
      notes: stored,
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, { activeNoteId: options.activeNoteId ?? null, directories: options.directories, notes: options.notes })
  await page.reload()
}

const twoFolders = [
  { folder: "Alpha", title: "甲一" },
  { folder: "Alpha", title: "甲二" },
  { folder: "Beta", title: "乙一" },
]

test.describe("笔记库默认选中", () => {
  test("启动落在 /notes 时跟随打开的笔记目录，不进入全部笔记", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedVault(page, { activeNoteId: "webdav:/Swell/Beta/乙一.md", directories: ["Alpha", "Beta"], notes: twoFolders })

    const workspace = page.locator(".desktop-workspace:visible")
    // 路由停在笔记库首页，没有被改写成全部笔记视图。
    await expect(page).toHaveURL(/#\/notes$/)
    // 侧栏跟随打开的那篇笔记所在的目录。
    await expect(workspace.getByRole("button", { name: /当前浏览：Beta/ })).toBeVisible()
    await expect(workspace.locator(".library-row[data-active='true']")).toContainText("Beta")
    // 列表收窄到该目录，全库里的另一篇不出现。
    await expect(workspace.locator(".note-list-row").filter({ hasText: "乙一" })).toBeVisible()
    await expect(workspace.locator(".note-list-row").filter({ hasText: "甲一" })).toHaveCount(0)

    // 「全部笔记」不是当前视图，因此不打勾。
    await workspace.getByRole("button", { name: /当前浏览/ }).click()
    // 菜单 portal 到 body，不在 workspace 内。
    const allItem = page.getByRole("menuitem", { name: /全部笔记/ })
    await expect(allItem.locator("svg.lucide-check")).toHaveCount(0)
  })

  test("显式选择全部笔记后才展示全库", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedVault(page, { directories: ["Alpha", "Beta"], notes: twoFolders })

    const workspace = page.locator(".desktop-workspace:visible")
    await workspace.getByRole("button", { name: /当前浏览/ }).click()
    await page.getByRole("menuitem", { name: /全部笔记/ }).click()

    await expect(page).toHaveURL(/#\/notes\/view\/all$/)
    await expect(workspace.locator(".note-list-row").filter({ hasText: "甲一" })).toBeVisible()
    await expect(workspace.locator(".note-list-row").filter({ hasText: "乙一" })).toBeVisible()
  })

  test("打开另一篇笔记后侧栏与列表跟随它所在的目录", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedVault(page, { directories: ["Alpha", "Beta"], notes: twoFolders })

    const workspace = page.locator(".desktop-workspace:visible")
    // 先显式进入全库，再从全库里打开一篇属于 Alpha 的笔记。
    await workspace.getByRole("button", { name: /当前浏览/ }).click()
    await page.getByRole("menuitem", { name: /全部笔记/ }).click()
    await workspace.locator(".note-list-row").filter({ hasText: "甲二" }).click()
    await expect(page).toHaveURL(/#\/notes\/webdav/)

    await expect(workspace.getByRole("button", { name: /当前浏览：Alpha/ })).toBeVisible()
    await expect(workspace.locator(".note-list-row").filter({ hasText: "甲一" })).toBeVisible()
    await expect(workspace.locator(".note-list-row").filter({ hasText: "乙一" })).toHaveCount(0)
  })

  test("跟随态下点侧栏目录仍然生效", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedVault(page, { directories: ["Alpha", "Beta"], notes: twoFolders })

    const workspace = page.locator(".desktop-workspace:visible")
    await workspace.getByRole("button", { name: /当前浏览/ }).click()
    await page.getByRole("menuitem", { name: /全部笔记/ }).click()
    await workspace.locator(".note-list-row").filter({ hasText: "甲二" }).click()
    await expect(page).toHaveURL(/#\/notes\/webdav/)

    // 跟随是派生的，不能把用户显式点击侧栏的结果盖回去。
    await workspace.locator(".library-row", { hasText: "Beta" }).click()
    await expect(page).toHaveURL(/\/notes\/folder\/Beta/)
    await expect(workspace.locator(".note-list-row").filter({ hasText: "乙一" })).toBeVisible()
    await expect(workspace.locator(".note-list-row").filter({ hasText: "甲一" })).toHaveCount(0)
  })

  test("没有可跟随的笔记时展示空态引导，而不是默认铺开全库", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    // 目录已建、笔记还没同步下来的库：有目录树可点，但没有笔记可跟随。
    await seedVault(page, { directories: ["Alpha", "Beta"], notes: [] })

    const workspace = page.locator(".desktop-workspace:visible")
    await expect(workspace.getByText("从左侧选择目录")).toBeVisible()
    await expect(workspace.locator(".note-list-row")).toHaveCount(0)
    await expect(page).toHaveURL(/#\/notes$/)
    // 侧栏目录树照常渲染——空态的全部意义就是引导用户去点它。
    await expect(workspace.locator(".library-row", { hasText: "Alpha" })).toBeVisible()
    // 空态自带出口：窄桌面窗口下侧栏整个被隐藏，没有它就走不出去。
    await expect(workspace.getByRole("button", { name: "浏览全部笔记" })).toBeVisible()

    await workspace.locator(".library-row", { hasText: "Alpha" }).click()
    await expect(page).toHaveURL(/\/notes\/folder\/Alpha/)
  })
})
