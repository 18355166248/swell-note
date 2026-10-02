import { MockWebDavServer, SERVER_URL, REMOTE_ROOT, FOLDER_ORDER_PATH, USERNAME, PASSWORD, connectMockWebDav as connectViaSettings } from "./mock-webdav-server"
import { createHash } from "node:crypto"

import { devices, expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test"

// 双设备排序同步 e2e：两个独立浏览器上下文（各自 IndexedDB/localStorage）模拟两台设备，
// page.route 拦截虚构主机 https://webdav.e2e.test，两个上下文共用本进程内的同一个
// 内存 WebDAV 服务（强 ETag、If-Match/If-None-Match 条件写入），不访问任何真实网盘。
// 所有数据只写入 e2e 上下文的隔离存储，不触碰真实笔记库。

// 预置远端笔记库：三篇子目录笔记 + 一篇根目录笔记；目录自然顺序 Alpha/Beta/Gamma。
function seedRemoteLibrary(server: MockWebDavServer) {
  server.addDirectory(REMOTE_ROOT)
  server.addFile("/Swell/root.md", "# 根目录笔记\n")
  server.addFile("/Swell/Alpha/a.md", "# Alpha 笔记\n")
  server.addFile("/Swell/Beta/b.md", "# Beta 笔记\n")
  server.addFile("/Swell/Gamma/g.md", "# Gamma 笔记\n")
}

type Device = { context: BrowserContext; page: Page }

async function newDevice(browser: Browser, server: MockWebDavServer, testInfo: TestInfo): Promise<Device> {
  const baseURL = testInfo.project.use.baseURL ?? "http://127.0.0.1:4173"
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.route(`${SERVER_URL}**`, server.handler)
  return { context, page }
}

// 跨设备测试中的“手机”：同一项目（desktop-chrome）内另起一个 Pixel 7 视口的隔离上下文，
// 让应用走移动端布局（管理文件夹/拖动排序手柄），与桌面上下文共用同一个内存 WebDAV 服务。
async function newMobileDevice(browser: Browser, server: MockWebDavServer, testInfo: TestInfo): Promise<Device> {
  const baseURL = testInfo.project.use.baseURL ?? "http://127.0.0.1:4173"
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL })
  const page = await context.newPage()
  await page.route(`${SERVER_URL}**`, server.handler)
  return { context, page }
}

// 首次连接走设置页完整表单（真实用户路径），连接成功后回到笔记页并出现“同步”按钮。

async function enterSortMode(page: Page) {
  const panel = page.locator(".library-panel")
  await panel.getByRole("button", { name: "调整文件夹顺序" }).click()
  await expect(panel.getByRole("button", { name: "完成文件夹排序" })).toBeVisible()
  return panel
}

async function exitSortMode(page: Page) {
  await page.locator(".library-panel").getByRole("button", { name: "完成文件夹排序" }).click()
}

async function desktopHandleOrder(page: Page) {
  return page.locator(".library-folder-drag-handle").evaluateAll(
    (handles) => handles.map((handle) => handle.getAttribute("aria-label")),
  )
}

async function desktopRowOrder(page: Page) {
  return page.locator(".library-panel").locator(".library-row").evaluateAll(
    (rows) => rows.map((row) => row.textContent?.replace(/[0-9]/g, "").trim()),
  )
}

// KeyboardSensor 的 keydown 监听在拖动启动后的下一个宏任务才挂到 document。
async function keyboardMoveUp(page: Page, folderName: string) {
  const panel = page.locator(".library-panel")
  await panel.getByRole("button", { name: `拖动排序 ${folderName}` }).focus()
  await page.keyboard.press("Space")
  await page.waitForTimeout(100)
  await page.keyboard.press("ArrowUp")
  await expect(panel.locator("[role='status']")).toContainText("当前位于")
  await page.keyboard.press("Space")
  await page.waitForTimeout(150)
}

// 移动端排序入口：文件夹区块的“管理文件夹”开关，排序态按钮文案变为“完成文件夹管理”。
async function enterMobileSortMode(page: Page) {
  const library = page.locator(".mobile-library")
  await library.getByRole("button", { name: "管理文件夹" }).click()
  await expect(library.getByRole("button", { name: "完成文件夹管理" })).toBeVisible()
  return library
}

async function exitMobileSortMode(page: Page) {
  await page.locator(".mobile-library").getByRole("button", { name: "完成文件夹管理" }).click()
}

async function mobileHandleOrder(page: Page) {
  return page.locator(".mobile-library").locator(".mobile-folder-drag-handle").evaluateAll(
    (handles) => handles.map((handle) => handle.getAttribute("aria-label")),
  )
}

// 移动端同样走 KeyboardSensor： announcements 的 role=status 在页面级（DndContext 内）。
async function keyboardMoveUpMobile(page: Page, folderName: string) {
  const library = page.locator(".mobile-library")
  await library.getByRole("button", { name: `拖动排序 ${folderName}` }).focus()
  await page.keyboard.press("Space")
  await page.waitForTimeout(100)
  await page.keyboard.press("ArrowUp")
  await expect(page.locator("[role='status']").filter({ hasText: "当前位于" })).toBeVisible()
  await page.keyboard.press("Space")
  await page.waitForTimeout(150)
}

async function manualSync(page: Page) {
  await page.getByRole("button", { name: "同步当前笔记库" }).click()
}

function webDavCacheId(username: string) {
  return createHash("sha256").update(`webdav:${SERVER_URL}:${username}:${REMOTE_ROOT}`).digest("hex")
}

test("笔记置顶跨端同步：桌面上传、手机离线取消并重启恢复、桌面拉回", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome")
  test.setTimeout(60_000)
  const server = new MockWebDavServer()
  seedRemoteLibrary(server)
  const desktop = await newDevice(browser, server, testInfo)
  const mobile = await newMobileDevice(browser, server, testInfo)
  const showAll = async (page: Page) => {
    await page.evaluate(() => { window.location.hash = "/notes/view/all" })
    await expect(page.locator(".note-list-row:visible")).toHaveCount(4)
  }
  try {
    await connectViaSettings(desktop.page)
    await showAll(desktop.page)
    await desktop.page.locator(".note-list-row:visible").filter({ hasText: "g" }).click({ button: "right" })
    await desktop.page.getByRole("menuitem", { name: "置顶笔记", exact: true }).click()
    await expect(desktop.page.locator(".note-list-row:visible").first().getByLabel("已置顶")).toBeVisible()
    // 手动模式下只入队；置顶不触发正文 PUT，也不在后台擅自上传配置。
    expect(server.readNotePins()).toBeNull()
    await manualSync(desktop.page)
    await expect.poll(() => server.readNotePins()).toEqual(["Gamma/g.md"])

    await connectViaSettings(mobile.page)
    await showAll(mobile.page)
    const row = mobile.page.locator(".note-list-row:visible").first()
    await expect(row.getByLabel("已置顶")).toBeVisible()
    await expect(row.locator("strong")).toHaveText("g")
    await mobile.context.setOffline(true)
    const box = await row.boundingBox()
    if (!box) throw new Error("置顶行不可见")
    const session = await mobile.context.newCDPSession(mobile.page)
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
    await expect(mobile.page.getByRole("dialog")).toBeVisible()
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await session.detach()
    await mobile.page.getByRole("button", { name: "取消置顶", exact: true }).click()
    await expect(mobile.page.locator(".note-list-row:visible").getByLabel("已置顶")).toHaveCount(0)
    // 等待离线快照落盘后恢复网络并重启，重新连接应上传取消意图，不能被云端旧置顶覆盖。
    await expect.poll(async () => mobile.page.evaluate(async () => {
      const request = indexedDB.open("swell-note-vault-cache", 3)
      const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result) })
      const pending = await new Promise<boolean>((resolve) => {
        const get = db.transaction("vaults", "readonly").objectStore("vaults").getAll()
        get.onsuccess = () => resolve(get.result.some((cache) => cache.notes.some((note: { pinPending?: boolean; pinned?: boolean }) => note.pinPending && !note.pinned)))
      })
      db.close()
      return pending
    })).toBe(true)
    await mobile.context.setOffline(false)
    await connectViaSettings(mobile.page)
    await expect.poll(() => server.readNotePins()).toEqual([])
    await manualSync(desktop.page)
    await expect(desktop.page.locator(".note-list-row:visible").getByLabel("已置顶")).toHaveCount(0)
    expect(server.putCount("/Swell/Gamma/g.md")).toBe(0)
  } finally {
    await desktop.context.close()
    await mobile.context.close()
  }
})

test.describe("文件夹排序 WebDAV 双设备同步", () => {
  test("A 排序手动同步上传，B 连接即见；B 反向排序，A 拉回", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    const server = new MockWebDavServer()
    seedRemoteLibrary(server)
    const deviceA = await newDevice(browser, server, testInfo)
    const deviceB = await newDevice(browser, server, testInfo)
    try {
      await connectViaSettings(deviceA.page)

      // A：Gamma 两次上移 → [Gamma, Alpha, Beta]
      await enterSortMode(deviceA.page)
      await keyboardMoveUp(deviceA.page, "Gamma")
      await keyboardMoveUp(deviceA.page, "Gamma")
      expect(await desktopHandleOrder(deviceA.page)).toEqual(["拖动排序 Gamma", "拖动排序 Alpha", "拖动排序 Beta"])
      await exitSortMode(deviceA.page)

      // 手动模式（默认）：排序意图只进本机工作副本，任何自动路径都不能写远端。
      await deviceA.page.waitForTimeout(5_000)
      expect(server.readFolderOrder()).toBeNull()
      expect(server.putCount(FOLDER_ORDER_PATH)).toBe(0)

      // A 主动同步：条件创建排序文档。
      await manualSync(deviceA.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Gamma", "Alpha", "Beta"])

      // B 首次连接同一远端：直接采用云端顺序。
      await connectViaSettings(deviceB.page)
      await enterSortMode(deviceB.page)
      expect(await desktopHandleOrder(deviceB.page)).toEqual(["拖动排序 Gamma", "拖动排序 Alpha", "拖动排序 Beta"])

      // B 反向排序：Beta 两次上移 → [Beta, Gamma, Alpha]，主动同步条件更新。
      await keyboardMoveUp(deviceB.page, "Beta")
      await keyboardMoveUp(deviceB.page, "Beta")
      expect(await desktopHandleOrder(deviceB.page)).toEqual(["拖动排序 Beta", "拖动排序 Gamma", "拖动排序 Alpha"])
      await exitSortMode(deviceB.page)
      await manualSync(deviceB.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Beta", "Gamma", "Alpha"])

      // A 再同步：拉回远端顺序并应用到本机侧栏。
      await manualSync(deviceA.page)
      await expect.poll(() => desktopRowOrder(deviceA.page), { timeout: 15_000 })
        .toEqual(["根目录", "Beta", "Gamma", "Alpha"])
      await enterSortMode(deviceA.page)
      expect(await desktopHandleOrder(deviceA.page)).toEqual(["拖动排序 Beta", "拖动排序 Gamma", "拖动排序 Alpha"])
    } finally {
      await deviceA.context.close()
      await deviceB.context.close()
    }
  })

  test("双端各改排序：同步判定冲突，双方候选保留，选择本机后经条件写覆盖", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    const server = new MockWebDavServer()
    seedRemoteLibrary(server)
    const deviceA = await newDevice(browser, server, testInfo)
    const deviceB = await newDevice(browser, server, testInfo)
    try {
      // A 连接并上传 v1 = [Gamma, Alpha, Beta]。
      await connectViaSettings(deviceA.page)
      await enterSortMode(deviceA.page)
      await keyboardMoveUp(deviceA.page, "Gamma")
      await keyboardMoveUp(deviceA.page, "Gamma")
      await exitSortMode(deviceA.page)
      await manualSync(deviceA.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Gamma", "Alpha", "Beta"])

      // B 连接（base = v1），本机拖成 [Alpha, Gamma, Beta]，先不同步。
      await connectViaSettings(deviceB.page)
      await enterSortMode(deviceB.page)
      await keyboardMoveUp(deviceB.page, "Alpha")
      expect(await desktopHandleOrder(deviceB.page)).toEqual(["拖动排序 Alpha", "拖动排序 Gamma", "拖动排序 Beta"])
      await exitSortMode(deviceB.page)

      // A 把 Beta 提到中间 → v2 = [Gamma, Beta, Alpha]，先上传。
      await enterSortMode(deviceA.page)
      await keyboardMoveUp(deviceA.page, "Beta")
      expect(await desktopHandleOrder(deviceA.page)).toEqual(["拖动排序 Gamma", "拖动排序 Beta", "拖动排序 Alpha"])
      await exitSortMode(deviceA.page)
      await manualSync(deviceA.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Gamma", "Beta", "Alpha"])

      // B 同步：base(v1)/本机/云端(v2) 三方皆不同 → 冲突对话框，云端不被覆盖。
      await manualSync(deviceB.page)
      const dialog = deviceB.page.getByRole("dialog")
      await expect(dialog.getByRole("heading", { name: "文件夹排序存在冲突" })).toBeVisible({ timeout: 15_000 })
      await expect(dialog.getByText("本机顺序")).toBeVisible()
      await expect(dialog.getByText("云端顺序")).toBeVisible()
      expect(server.readFolderOrder()?.order).toEqual(["Gamma", "Beta", "Alpha"])

      // B 选“使用本机”：以最新云端 ETag 条件写覆盖，远端变为 B 的顺序。
      await dialog.getByRole("button", { name: "使用本机" }).click()
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Alpha", "Gamma", "Beta"])
      await expect(dialog).toHaveCount(0)

      // A 拉回后看到 B 的顺序。
      await manualSync(deviceA.page)
      await expect.poll(() => desktopRowOrder(deviceA.page), { timeout: 15_000 })
        .toEqual(["根目录", "Alpha", "Gamma", "Beta"])
    } finally {
      await deviceA.context.close()
      await deviceB.context.close()
    }
  })

  test("判定后远端被改写（412）：一次读回重判定转冲突，本机意图保留，可选云端", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    const server = new MockWebDavServer()
    seedRemoteLibrary(server)
    const deviceA = await newDevice(browser, server, testInfo)
    const deviceB = await newDevice(browser, server, testInfo)
    try {
      // A 上传 v1 = [Gamma, Alpha, Beta]；B 连接后 base = v1。
      await connectViaSettings(deviceA.page)
      await enterSortMode(deviceA.page)
      await keyboardMoveUp(deviceA.page, "Gamma")
      await keyboardMoveUp(deviceA.page, "Gamma")
      await exitSortMode(deviceA.page)
      await manualSync(deviceA.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Gamma", "Alpha", "Beta"])

      await connectViaSettings(deviceB.page)
      // B 本机拖成 [Beta, Gamma, Alpha]。
      await enterSortMode(deviceB.page)
      await keyboardMoveUp(deviceB.page, "Beta")
      await keyboardMoveUp(deviceB.page, "Beta")
      await exitSortMode(deviceB.page)

      // A 再上传 v2 = [Gamma, Beta, Alpha]。
      await enterSortMode(deviceA.page)
      await keyboardMoveUp(deviceA.page, "Beta")
      await exitSortMode(deviceA.page)
      await manualSync(deviceA.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Gamma", "Beta", "Alpha"])

      // B 同步时第一次 GET 被 mock 回放成 v1（与 B 的 base 一致）→ 判定为上传；
      // PUT If-Match(v1 ETag) 被真实远端 412 → 一次读回重判定 → 冲突，本机意图不丢。
      server.staleNextFolderOrderRead()
      await manualSync(deviceB.page)
      const dialog = deviceB.page.getByRole("dialog")
      await expect(dialog.getByRole("heading", { name: "文件夹排序存在冲突" })).toBeVisible({ timeout: 15_000 })
      expect(server.readFolderOrder()?.order).toEqual(["Gamma", "Beta", "Alpha"])

      // B 选“使用云端”：本机顺序被云端 v2 替换，冲突关闭。
      await dialog.getByRole("button", { name: "使用云端" }).click()
      await expect(dialog).toHaveCount(0, { timeout: 15_000 })
      await expect.poll(() => desktopRowOrder(deviceB.page), { timeout: 15_000 })
        .toEqual(["根目录", "Gamma", "Beta", "Alpha"])
      expect(server.readFolderOrder()?.order).toEqual(["Gamma", "Beta", "Alpha"])
    } finally {
      await deviceA.context.close()
      await deviceB.context.close()
    }
  })

  test("后台自动同步模式：拖动落本机后无需点击，自动完成条件上传", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    const server = new MockWebDavServer()
    seedRemoteLibrary(server)
    const deviceA = await newDevice(browser, server, testInfo)
    try {
      await deviceA.page.addInitScript(() => {
        window.localStorage.setItem("swell-note:sync-preferences:v1", JSON.stringify({ autoSyncMode: "background" }))
      })
      await connectViaSettings(deviceA.page)

      await enterSortMode(deviceA.page)
      await keyboardMoveUp(deviceA.page, "Gamma")
      await keyboardMoveUp(deviceA.page, "Gamma")
      expect(await desktopHandleOrder(deviceA.page)).toEqual(["拖动排序 Gamma", "拖动排序 Alpha", "拖动排序 Beta"])
      await exitSortMode(deviceA.page)

      // 不点同步：后台模式约 4 秒后自动走完整同步链路，远端出现排序文档。
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 20_000 })
        .toEqual(["Gamma", "Alpha", "Beta"])
    } finally {
      await deviceA.context.close()
    }
  })

  test("v1 旧排序一次性迁移：快速连接后作为本机意图上传到空远端", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    const server = new MockWebDavServer()
    seedRemoteLibrary(server)
    const device = await newDevice(browser, server, testInfo)
    try {
      const cacheId = webDavCacheId(USERNAME)
      const { page } = device
      await page.goto("/#/notes")
      // 隔离缓存库：notes 的路径/版本与 mock 远端一致，重连按 synced 合并不产生笔记写入。
      await page.evaluate(async ({ cacheId, etags, username }) => {
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
        const folders = [
          { folder: "根目录", remotePath: "/Swell/root.md" },
          { folder: "Alpha", remotePath: "/Swell/Alpha/a.md" },
          { folder: "Beta", remotePath: "/Swell/Beta/b.md" },
          { folder: "Gamma", remotePath: "/Swell/Gamma/g.md" },
        ]
        const transaction = database.transaction(["vaults", "settings"], "readwrite")
        transaction.objectStore("vaults").put({
          activeNoteId: `webdav:${folders[0].remotePath}`,
          directories: ["Alpha", "Beta", "Gamma"],
          id: cacheId,
          label: "E2E 迁移库",
          lastSyncedAt: Date.now(),
          notes: folders.map(({ folder, remotePath }) => ({
            content: "",
            contentCached: true,
            contentLoaded: false,
            folder,
            id: `webdav:${remotePath}`,
            preview: "摘要",
            readOnly: false,
            remotePath,
            revision: etags[remotePath],
            source: "webdav",
            starred: false,
            syncStatus: "synced",
            title: remotePath.split("/").pop() ?? "",
            updatedAt: "刚刚",
          })),
          savedAt: Date.now(),
          sourceKind: "webdav",
        })
        transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
        })
        database.close()
        window.localStorage.setItem("swell-note:webdav-config:v1", JSON.stringify({
          provider: "jianguoyun",
          remotePath: "/Swell/",
          serverUrl: "https://webdav.e2e.test/dav/",
          username,
        }))
        // v1 旧排序：连接建立工作副本时作为一次性迁移输入。
        window.localStorage.setItem("swell-note:folder-order:v1", JSON.stringify({
          [cacheId]: ["Beta", "Alpha", "Gamma"],
        }))
      }, {
        cacheId,
        etags: {
          "/Swell/root.md": server.etagOf("/Swell/root.md"),
          "/Swell/Alpha/a.md": server.etagOf("/Swell/Alpha/a.md"),
          "/Swell/Beta/b.md": server.etagOf("/Swell/Beta/b.md"),
          "/Swell/Gamma/g.md": server.etagOf("/Swell/Gamma/g.md"),
        },
        username: USERNAME,
      })
      await page.reload()

      // 未连接时排序意图只进本机工作副本；点“连接”弹出快速连接对话框补密码。
      await page.getByRole("button", { name: "重新连接并更新" }).click()
      const dialog = page.getByRole("dialog")
      await expect(dialog.getByRole("heading", { name: "快速连接坚果云" })).toBeVisible()
      await dialog.locator("#quick-webdav-password").fill(PASSWORD)
      await dialog.getByRole("button", { name: "连接并同步" }).click()

      // 远端原本没有排序文档：迁移意图经条件创建上传。
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Beta", "Alpha", "Gamma"])
    } finally {
      await device.context.close()
    }
  })

  test("本机未扫描到的成员保留槽位：可见子集重排后上传不丢远端成员", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    const server = new MockWebDavServer()
    seedRemoteLibrary(server)
    // 远端排序文档记录了“远端目录X”：另一设备建过、本机库中不存在对应目录。
    server.addDirectory("/Swell/.swell/")
    server.addFile(FOLDER_ORDER_PATH, JSON.stringify({
      changeId: "00000000-0000-4000-8000-000000000001",
      order: ["Alpha", "远端目录X", "Beta"],
      schemaVersion: 1,
    }))
    const deviceA = await newDevice(browser, server, testInfo)
    const deviceB = await newDevice(browser, server, testInfo)
    try {
      // A 连接后采用云端顺序；管理模式下可见本机真实目录（X 无对应目录不显示，
      // 不在远端顺序里的 Gamma 排在顺序成员之后）。
      await connectViaSettings(deviceA.page)
      await enterSortMode(deviceA.page)
      await expect.poll(() => desktopHandleOrder(deviceA.page), { timeout: 15_000 })
        .toEqual(["拖动排序 Alpha", "拖动排序 Beta", "拖动排序 Gamma"])

      // 把 Beta 移到 Alpha 前：可见子集 [Beta, Alpha, Gamma]，未扫描成员保留在原槽位。
      await keyboardMoveUp(deviceA.page, "Beta")
      expect(await desktopHandleOrder(deviceA.page)).toEqual(["拖动排序 Beta", "拖动排序 Alpha", "拖动排序 Gamma"])
      await exitSortMode(deviceA.page)
      await manualSync(deviceA.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Beta", "远端目录X", "Alpha", "Gamma"])

      // B 首次连接：完整顺序（含 X）落到工作副本，可见顺序为 [Beta, Alpha, Gamma]。
      await connectViaSettings(deviceB.page)
      await enterSortMode(deviceB.page)
      await expect.poll(() => desktopHandleOrder(deviceB.page), { timeout: 15_000 })
        .toEqual(["拖动排序 Beta", "拖动排序 Alpha", "拖动排序 Gamma"])
    } finally {
      await deviceA.context.close()
      await deviceB.context.close()
    }
  })

  test("桌面↔移动跨设备：桌面排序上传移动连接即见，移动反向排序桌面拉回", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    const server = new MockWebDavServer()
    seedRemoteLibrary(server)
    const desktop = await newDevice(browser, server, testInfo)
    const mobile = await newMobileDevice(browser, server, testInfo)
    try {
      // 桌面：Gamma 两次上移 → [Gamma, Alpha, Beta]，手动同步上传。
      await connectViaSettings(desktop.page)
      await enterSortMode(desktop.page)
      await keyboardMoveUp(desktop.page, "Gamma")
      await keyboardMoveUp(desktop.page, "Gamma")
      await exitSortMode(desktop.page)
      await manualSync(desktop.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Gamma", "Alpha", "Beta"])

      // 手机首次连接同一远端：移动端布局直接采用云端顺序。
      await connectViaSettings(mobile.page)
      await enterMobileSortMode(mobile.page)
      await expect.poll(() => mobileHandleOrder(mobile.page), { timeout: 15_000 })
        .toEqual(["拖动排序 Gamma", "拖动排序 Alpha", "拖动排序 Beta"])

      // 手机反向排序：Beta 两次上移 → [Beta, Gamma, Alpha]，手动同步条件更新。
      await keyboardMoveUpMobile(mobile.page, "Beta")
      await keyboardMoveUpMobile(mobile.page, "Beta")
      expect(await mobileHandleOrder(mobile.page)).toEqual(["拖动排序 Beta", "拖动排序 Gamma", "拖动排序 Alpha"])
      await exitMobileSortMode(mobile.page)
      await manualSync(mobile.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Beta", "Gamma", "Alpha"])

      // 桌面再同步：拉回手机写入的顺序并应用到侧栏。
      await manualSync(desktop.page)
      await expect.poll(() => desktopRowOrder(desktop.page), { timeout: 15_000 })
        .toEqual(["根目录", "Beta", "Gamma", "Alpha"])
      await enterSortMode(desktop.page)
      expect(await desktopHandleOrder(desktop.page)).toEqual(["拖动排序 Beta", "拖动排序 Gamma", "拖动排序 Alpha"])
    } finally {
      await desktop.context.close()
      await mobile.context.close()
    }
  })

  test("桌面↔移动双端各改：手机端冲突对话框选本机条件写覆盖，桌面拉回", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    const server = new MockWebDavServer()
    seedRemoteLibrary(server)
    const desktop = await newDevice(browser, server, testInfo)
    const mobile = await newMobileDevice(browser, server, testInfo)
    try {
      // 桌面连接并上传 v1 = [Gamma, Alpha, Beta]。
      await connectViaSettings(desktop.page)
      await enterSortMode(desktop.page)
      await keyboardMoveUp(desktop.page, "Gamma")
      await keyboardMoveUp(desktop.page, "Gamma")
      await exitSortMode(desktop.page)
      await manualSync(desktop.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Gamma", "Alpha", "Beta"])

      // 手机连接（base = v1），本机拖成 [Alpha, Gamma, Beta]，先不同步。
      await connectViaSettings(mobile.page)
      await enterMobileSortMode(mobile.page)
      await keyboardMoveUpMobile(mobile.page, "Alpha")
      expect(await mobileHandleOrder(mobile.page)).toEqual(["拖动排序 Alpha", "拖动排序 Gamma", "拖动排序 Beta"])
      await exitMobileSortMode(mobile.page)

      // 桌面把 Beta 提到中间 → v2 = [Gamma, Beta, Alpha]，先上传。
      await enterSortMode(desktop.page)
      await keyboardMoveUp(desktop.page, "Beta")
      await exitSortMode(desktop.page)
      await manualSync(desktop.page)
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Gamma", "Beta", "Alpha"])

      // 手机同步：三方皆不同 → 冲突对话框，云端不被覆盖。
      await manualSync(mobile.page)
      const dialog = mobile.page.getByRole("dialog")
      await expect(dialog.getByRole("heading", { name: "文件夹排序存在冲突" })).toBeVisible({ timeout: 15_000 })
      await expect(dialog.getByText("本机顺序")).toBeVisible()
      await expect(dialog.getByText("云端顺序")).toBeVisible()
      expect(server.readFolderOrder()?.order).toEqual(["Gamma", "Beta", "Alpha"])

      // 手机选“使用本机”：以最新云端 ETag 条件写覆盖，远端变为手机端顺序。
      await dialog.getByRole("button", { name: "使用本机" }).click()
      await expect.poll(() => server.readFolderOrder()?.order ?? null, { timeout: 15_000 })
        .toEqual(["Alpha", "Gamma", "Beta"])
      await expect(dialog).toHaveCount(0)

      // 桌面拉回后看到手机端的顺序。
      await manualSync(desktop.page)
      await expect.poll(() => desktopRowOrder(desktop.page), { timeout: 15_000 })
        .toEqual(["根目录", "Alpha", "Gamma", "Beta"])
    } finally {
      await desktop.context.close()
      await mobile.context.close()
    }
  })
})
