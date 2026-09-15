import { expect, test, type Page } from "@playwright/test"

// 独立测试数据：只写入 IndexedDB 缓存库 e2e-*-vault，不触碰任何真实笔记库。
type SeedFolder = { folder: string; noteId: string }
type SeedVault = {
  cacheId: string
  directories: string[]
  folders: SeedFolder[]
  label?: string
  // browser/tauri 模拟本地库离线缓存：没有 vaultSession，folderManagementMode 为 null。
  sourceKind?: "browser" | "tauri" | "webdav"
}

async function seedCachedVaults(page: Page, vaults: SeedVault[], activeCacheId: string) {
  await page.goto("/#/notes")
  await page.evaluate(async ({ activeCacheId, vaults }) => {
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
    for (const vault of vaults) {
      const sourceKind = vault.sourceKind ?? "webdav"
      const source = sourceKind === "webdav" ? "webdav" : "local"
      const notes = vault.folders.map(({ folder }, index) => ({
        content: "",
        contentCached: true,
        contentLoaded: false,
        folder,
        id: `${sourceKind}:/Swell/${index}.md`,
        preview: `摘要${index}`,
        readOnly: false,
        remotePath: `/Swell/${index}.md`,
        revision: `"r${index}"`,
        source,
        starred: false,
        syncStatus: "synced",
        title: `笔记${index}`,
        updatedAt: "刚刚",
      }))
      transaction.objectStore("vaults").put({
        activeNoteId: notes[0]?.id ?? "",
        directories: vault.directories,
        id: vault.cacheId,
        label: vault.label ?? "E2E 排序库",
        lastSyncedAt: Date.now(),
        notes,
        savedAt: Date.now(),
        sourceKind,
      })
    }
    transaction.objectStore("settings").put({ key: "last-cache", value: activeCacheId })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, { activeCacheId, vaults })
  await page.reload()
}

async function seedCachedVault(page: Page, options: SeedVault) {
  await seedCachedVaults(page, [options], options.cacheId)
}

// 双库场景：B 库包含与 A 同名的 Beta 目录，复现切库后旧拖动误提交的场景。
async function seedTwoVaults(page: Page) {
  await seedCachedVaults(page, [
    { cacheId: "e2e-vault-a", directories: baseDirectories, folders: baseFolders, label: "库A" },
    { cacheId: "e2e-vault-b", directories: ["Beta", "Delta"], folders: [
      { folder: "根目录", noteId: "b-root" },
      { folder: "Beta", noteId: "b-beta" },
      { folder: "Delta", noteId: "b-delta" },
    ], label: "库B" },
  ], "e2e-vault-a")
}

async function switchVault(page: Page, fromLabel: string, toLabel: string) {
  await page.getByRole("button", { name: `切换笔记库，当前为${fromLabel}` }).click()
  await page.getByRole("menuitem", { name: new RegExp(toLabel) }).click()
  await expect(page.getByRole("button", { name: `切换笔记库，当前为${toLabel}` })).toBeVisible()
}

async function readStoredOrder(page: Page, cacheId: string) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem("swell-note:folder-order:v1")
    return raw ? (JSON.parse(raw) as Record<string, string[]>)[key] ?? null : null
  }, cacheId)
}

// WebDAV 缓存库的排序事实来源是 IndexedDB 工作副本（folder-order-sync:v1:<cacheId>），
// 不再写 v1 localStorage；返回 null 表示没有有效排序落盘（未编辑或旧会话守卫拦截）。
async function readWorkingCopyOrder(page: Page, cacheId: string) {
  return page.evaluate(async (key) => {
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const record = await new Promise<{ localOrder?: string[] } | undefined>((resolve, reject) => {
      const get = database.transaction("settings", "readonly").objectStore("settings")
        .get(`folder-order-sync:v1:${key}`)
      get.onsuccess = () => resolve(get.result as { localOrder?: string[] } | undefined)
      get.onerror = () => reject(get.error)
    })
    database.close()
    return record && Array.isArray(record.localOrder) && record.localOrder.length > 0
      ? record.localOrder
      : null
  }, cacheId)
}

async function desktopHandleOrder(page: Page) {
  return page.locator(".library-folder-drag-handle").evaluateAll(
    (handles) => handles.map((handle) => handle.getAttribute("aria-label")),
  )
}

async function mobileHandleOrder(page: Page) {
  return page.locator(".mobile-folder-drag-handle").evaluateAll(
    (handles) => handles.map((handle) => handle.getAttribute("aria-label")),
  )
}

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 14) {
  // CDP 派发真实触摸输入，不是把视口缩小后用鼠标代替。
  const session = await page.context().newCDPSession(page)
  await session.send("Input.dispatchTouchEvent", { touchPoints: [{ id: 1, x: from.x, y: from.y }], type: "touchStart" })
  for (let index = 1; index <= steps; index += 1) {
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [{ id: 1, x: from.x + ((to.x - from.x) * index) / steps, y: from.y + ((to.y - from.y) * index) / steps }],
      type: "touchMove",
    })
    await page.waitForTimeout(20)
  }
  await session.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" })
}

// dnd-kit 在拖动结束后的约 50ms 内会在 document 捕获阶段拦截 click（吞掉拖动尾声的合成点击），
// 紧跟其后的真实点击也会被吞，等这个窗口过去再点击其他按钮。
async function waitAfterDragEnd(page: Page) {
  await page.waitForTimeout(150)
}

// KeyboardSensor 的 keydown 监听在拖动启动后的下一个宏任务才挂到 document，启动后稍等再按方向键。
async function waitForKeyboardSensor(page: Page) {
  await page.waitForTimeout(100)
}

const baseFolders: SeedFolder[] = [
  { folder: "根目录", noteId: "root" },
  { folder: "Alpha", noteId: "alpha" },
  { folder: "Alpha / 子一", noteId: "alpha-child" },
  { folder: "Beta", noteId: "beta" },
  { folder: "Gamma", noteId: "gamma" },
]
const baseDirectories = ["Alpha", "Alpha / 子一", "Beta", "Gamma"]

test.describe("文件夹排序", () => {
  test("桌面端鼠标拖动排序：子树跟随、根目录固定、刷新后恢复", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, { cacheId: "e2e-vault", directories: baseDirectories, folders: baseFolders })
    const panel = page.locator(".library-panel")
    await expect(panel.getByText("Alpha", { exact: true })).toBeVisible()

    // 先在普通模式展开 Alpha，确认子目录可见。
    await panel.getByRole("button", { name: "展开Alpha" }).click()
    await expect(panel.getByText("子一", { exact: true })).toBeVisible()

    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
    await expect(panel.getByText("子一", { exact: true })).toHaveCount(0)
    expect(await desktopHandleOrder(page)).toEqual(["拖动排序 Alpha", "拖动排序 Beta", "拖动排序 Gamma"])
    // 根目录钉在最前且无手柄。
    const firstRow = panel.locator(".library-row").first()
    await expect(firstRow).toContainText("根目录")
    await expect(firstRow.locator(".library-folder-drag-handle")).toHaveCount(0)

    // 把 Gamma 拖到 Alpha 的位置。
    const gammaHandle = panel.getByRole("button", { name: "拖动排序 Gamma" })
    const alphaRow = panel.locator(".library-folder-sortable").first()
    const handleBox = await gammaHandle.boundingBox()
    const targetBox = await alphaRow.boundingBox()
    expect(handleBox).not.toBeNull()
    expect(targetBox).not.toBeNull()
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 })
    await page.mouse.up()
    await waitAfterDragEnd(page)

    expect(await desktopHandleOrder(page)).toEqual(["拖动排序 Gamma", "拖动排序 Alpha", "拖动排序 Beta"])
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toEqual(["Gamma", "Alpha", "Beta"])
    // 拖动释放不会误触发行点击：仍然停留在全部笔记视图。
    await expect(page.getByRole("heading", { name: "全部笔记" })).toBeVisible()

    // 退出管理模式：子树随父目录整体移动，Alpha 的展开状态保留。
    await panel.getByRole("button", { name: "完成文件夹排序" }).click()
    const rowTexts = await panel.locator(".library-row").evaluateAll(
      (rows) => rows.map((row) => row.textContent?.replace(/[0-9]/g, "").trim()),
    )
    expect(rowTexts).toEqual(["根目录", "Gamma", "Alpha", "子一", "Beta"])

    // 刷新后顺序从本地存储恢复。
    await page.reload()
    await page.locator(".library-panel").getByRole("button", { name: "调整文件夹顺序" }).click()
    expect(await desktopHandleOrder(page)).toEqual(["拖动排序 Gamma", "拖动排序 Alpha", "拖动排序 Beta"])
  })

  test("桌面端键盘排序：确认保存、Esc 取消不落盘", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, { cacheId: "e2e-vault", directories: baseDirectories, folders: baseFolders })
    const panel = page.locator(".library-panel")
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()

    // 先取消一次：任何情况下都不写盘。
    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    // 方向键的碰撞结果异步生效，等屏幕阅读器播报出落点后再按确认/取消。
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")
    await page.keyboard.press("Escape")
    await waitAfterDragEnd(page)
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toBeNull()
    expect(await desktopHandleOrder(page)).toEqual(["拖动排序 Alpha", "拖动排序 Beta", "拖动排序 Gamma"])

    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")
    await page.keyboard.press("Space")
    await waitAfterDragEnd(page)

    expect(await desktopHandleOrder(page)).toEqual(["拖动排序 Beta", "拖动排序 Alpha", "拖动排序 Gamma"])
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toEqual(["Beta", "Alpha", "Gamma"])
    // 焦点回到发起拖动的手柄上。
    await expect(panel.getByRole("button", { name: "拖动排序 Beta" })).toBeFocused()
  })

  test("移动端真实触摸拖动排序，手柄热区至少 44×44", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page, { cacheId: "e2e-vault", directories: baseDirectories, folders: baseFolders })
    const library = page.locator(".mobile-library")
    await expect(library.getByText("Alpha", { exact: true })).toBeVisible()

    await library.getByRole("button", { name: "管理文件夹" }).click()
    const gammaHandle = library.getByRole("button", { name: "拖动排序 Gamma" })
    const handleBox = await gammaHandle.boundingBox()
    expect(handleBox).not.toBeNull()
    expect(handleBox!.width).toBeGreaterThanOrEqual(44)
    expect(handleBox!.height).toBeGreaterThanOrEqual(44)

    const mobileHandleOrder = () => library.locator(".mobile-folder-drag-handle").evaluateAll(
      (handles) => handles.map((handle) => handle.getAttribute("aria-label")),
    )
    expect(await mobileHandleOrder()).toEqual(["拖动排序 Alpha", "拖动排序 Beta", "拖动排序 Gamma"])

    // 用 CDP 真实触摸把 Gamma 拖到 Alpha 上方。
    const alphaRow = library.locator(".mobile-folder-sortable").first()
    const targetBox = await alphaRow.boundingBox()
    expect(targetBox).not.toBeNull()
    await touchDrag(
      page,
      { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 },
      { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 },
    )
    await waitAfterDragEnd(page)

    expect(await mobileHandleOrder()).toEqual(["拖动排序 Gamma", "拖动排序 Alpha", "拖动排序 Beta"])
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toEqual(["Gamma", "Alpha", "Beta"])
  })

  test("移动端非手柄区域正常滚动、长按菜单不回归", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    // 20 个顶层目录保证列表超出视口，可以验证滚动。
    const manyFolders: SeedFolder[] = [
      { folder: "根目录", noteId: "root" },
      ...Array.from({ length: 20 }, (_, index) => ({ folder: `目录${String(index + 1).padStart(2, "0")}`, noteId: `f${index}` })),
    ]
    await seedCachedVault(page, {
      cacheId: "e2e-scroll-vault",
      directories: manyFolders.filter(({ folder }) => folder !== "根目录").map(({ folder }) => folder),
      folders: manyFolders,
    })
    const library = page.locator(".mobile-library")
    await expect(library.getByText("目录01", { exact: true })).toBeVisible()

    // 管理模式下手柄之外的区域仍然可以滚动列表，顺序不变。
    await library.getByRole("button", { name: "管理文件夹" }).click()
    const viewport = library.locator("[data-slot='scroll-area-viewport']")
    const rowMain = library.locator(".mobile-folder-sortable .mobile-library-row-main").nth(3)
    const rowBox = await rowMain.boundingBox()
    expect(rowBox).not.toBeNull()
    const scrollBefore = await viewport.evaluate((element) => element.scrollTop)
    await touchDrag(
      page,
      { x: rowBox!.x + rowBox!.width / 2, y: rowBox!.y + rowBox!.height / 2 },
      { x: rowBox!.x + rowBox!.width / 2, y: rowBox!.y - 240 },
    )
    const scrollAfter = await viewport.evaluate((element) => element.scrollTop)
    expect(scrollAfter).toBeGreaterThan(scrollBefore)
    expect(await readWorkingCopyOrder(page, "e2e-scroll-vault")).toBeNull()

    // 退出管理模式，长按普通行仍弹出操作菜单（没有被拖动手势劫持）。
    await library.getByRole("button", { name: "完成文件夹管理" }).click()
    const folderRow = library.getByText("目录03", { exact: true })
    const folderBox = await folderRow.boundingBox()
    expect(folderBox).not.toBeNull()
    const session = await page.context().newCDPSession(page)
    const point = { id: 1, x: folderBox!.x + folderBox!.width / 2, y: folderBox!.y + folderBox!.height / 2 }
    await session.send("Input.dispatchTouchEvent", { touchPoints: [point], type: "touchStart" })
    await page.waitForTimeout(700)
    await session.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" })
    await expect(page.getByText("重命名", { exact: true }).first()).toBeVisible()
  })

  test("桌面端排序模式下普通点击目录行仍可导航", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, { cacheId: "e2e-vault", directories: baseDirectories, folders: baseFolders })
    const panel = page.locator(".library-panel")
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()

    await panel.locator(".library-folder-sortable").first().locator(".library-row-main").click()

    await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible()
    // 纯点击不产生任何排序写入。
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toBeNull()
  })

  test("桌面端抓起后切换笔记库：确认/取消都不写盘", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTwoVaults(page)
    const panel = page.locator(".library-panel")
    await expect(panel.getByText("Alpha", { exact: true })).toBeVisible()

    // 在 A 库用键盘抓起 Beta 并向上移动一步，拖动保持进行中。
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")

    // 拖动途中切到 B 库：旧拖动上下文整体卸载，B 库的可排序目录渲染出来。
    await switchVault(page, "库A", "库B")
    await expect(panel.getByRole("button", { name: "拖动排序 Delta" })).toBeVisible()

    // 把焦点挪到无交互元素，再按确认/取消键：即使旧传感器残留回调触发，也不能提交任何库。
    await panel.locator(".library-folder-title").click()
    await page.keyboard.press("Space")
    await waitAfterDragEnd(page)
    await page.keyboard.press("Escape")
    await waitAfterDragEnd(page)

    expect(await readWorkingCopyOrder(page, "e2e-vault-a")).toBeNull()
    expect(await readWorkingCopyOrder(page, "e2e-vault-b")).toBeNull()
    expect(await desktopHandleOrder(page)).toEqual(["拖动排序 Beta", "拖动排序 Delta"])
  })

  test("移动端本地只读缓存：无编辑权限也能拖动排序", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    // browser 来源的离线缓存没有 vaultSession，folderManagementMode 为 null：
    // 排序是本地展示偏好，不依赖文件写权限。
    await seedCachedVault(page, {
      cacheId: "e2e-local-vault",
      directories: baseDirectories,
      folders: baseFolders,
      label: "本地缓存库",
      sourceKind: "browser",
    })
    const library = page.locator(".mobile-library")
    await expect(library.getByText("Alpha", { exact: true })).toBeVisible()

    const manageButton = library.getByRole("button", { name: "管理文件夹" })
    await expect(manageButton).toBeEnabled()
    await manageButton.click()

    // 手柄在，重命名/删除入口不在。
    const betaHandle = library.getByRole("button", { name: "拖动排序 Beta" })
    await expect(betaHandle).toBeVisible()
    await expect(library.getByRole("button", { name: /更多文件夹操作/ })).toHaveCount(0)
    expect(await mobileHandleOrder(page)).toEqual(["拖动排序 Alpha", "拖动排序 Beta", "拖动排序 Gamma"])

    // CDP 真实触摸把 Beta 拖到 Alpha 上方。
    const handleBox = await betaHandle.boundingBox()
    const alphaRow = library.locator(".mobile-folder-sortable").first()
    const targetBox = await alphaRow.boundingBox()
    expect(handleBox).not.toBeNull()
    expect(targetBox).not.toBeNull()
    await touchDrag(
      page,
      { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 },
      { x: targetBox!.x + targetBox!.width / 2, y: targetBox!.y + targetBox!.height / 2 },
    )
    await waitAfterDragEnd(page)

    expect(await mobileHandleOrder(page)).toEqual(["拖动排序 Beta", "拖动排序 Alpha", "拖动排序 Gamma"])
    expect(await readStoredOrder(page, "e2e-local-vault")).toEqual(["Beta", "Alpha", "Gamma"])
  })

  // 拖动生命周期回归：进行中的拖动在退出管理模式 / 切库 / 布局切换时必须永久失效，
  // 旧传感器的确认键不能提交任何库，且清理后新拖动照常工作。
  test("桌面端退出管理模式后按确认键不写盘，重新进入后拖动正常", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, { cacheId: "e2e-vault", directories: baseDirectories, folders: baseFolders })
    const panel = page.locator(".library-panel")
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")

    // 拖动途中退出管理模式，再把焦点挪到无交互元素按确认键：旧拖动已永久失效。
    await panel.getByRole("button", { name: "完成文件夹排序" }).click()
    await panel.locator(".library-folder-title").click()
    await page.keyboard.press("Space")
    await waitAfterDragEnd(page)
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toBeNull()

    // 清理没有破坏后续会话：重新进入管理模式拖动正常提交。
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")
    await page.keyboard.press("Space")
    await waitAfterDragEnd(page)
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toEqual(["Beta", "Alpha", "Gamma"])
  })

  test("桌面端切库往返后旧拖动确认不写任何库", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTwoVaults(page)
    const panel = page.locator(".library-panel")
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")

    // A→B→A：往返后旧会话也不能复活（两个库的身份曾经重新相等）。
    await switchVault(page, "库A", "库B")
    await switchVault(page, "库B", "库A")
    await panel.locator(".library-folder-title").click()
    await page.keyboard.press("Space")
    await waitAfterDragEnd(page)

    expect(await readWorkingCopyOrder(page, "e2e-vault-a")).toBeNull()
    expect(await readWorkingCopyOrder(page, "e2e-vault-b")).toBeNull()
  })

  test("桌面端切库后直接开始新拖动：不写旧库，新拖动正常提交", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTwoVaults(page)
    const panel = page.locator(".library-panel")
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")

    // 切到 B 后不做任何按键清理，直接抓起 Delta 开始新拖动。
    await switchVault(page, "库A", "库B")
    await panel.getByRole("button", { name: "拖动排序 Delta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Beta")
    await page.keyboard.press("Space")
    await waitAfterDragEnd(page)

    // 旧拖动不写 A；B 的新拖动基于自己的目录正常提交。
    expect(await readWorkingCopyOrder(page, "e2e-vault-a")).toBeNull()
    expect(await readWorkingCopyOrder(page, "e2e-vault-b")).toEqual(["Delta", "Beta"])
  })

  test("桌面端拖动途中切到移动布局：旧拖动失效，回到桌面后新拖动正常", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, { cacheId: "e2e-vault", directories: baseDirectories, folders: baseFolders })
    const panel = page.locator(".library-panel")
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")

    // 缩到移动断点：桌面工作区整体卸载，进行中的拖动被永久终止。
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator(".mobile-library")).toBeVisible()
    await page.keyboard.press("Space")
    await waitAfterDragEnd(page)
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toBeNull()

    // 回到桌面布局后重新拖动正常提交。
    await page.setViewportSize({ width: 1280, height: 720 })
    await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
    await panel.getByRole("button", { name: "拖动排序 Beta" }).focus()
    await page.keyboard.press("Space")
    await waitForKeyboardSensor(page)
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator("[role='status']")).toContainText("当前位于 Alpha")
    await page.keyboard.press("Space")
    await waitAfterDragEnd(page)
    expect(await readWorkingCopyOrder(page, "e2e-vault")).toEqual(["Beta", "Alpha", "Gamma"])
  })
})
