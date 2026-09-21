import { expect, test, type Page } from "@playwright/test"

// 粘贴路径的界面验证：富文本转 Markdown 的转义收敛、纯文本入口、以及粘贴后能按原文搜索。
// 种子数据是独立的离线 vault，不触碰真实笔记。
async function seedNote(page: Page, content: string) {
  await page.goto("/#/notes")
  await page.evaluate(async (initial) => {
    const cacheId = "e2e-paste-vault"
    const note = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/粘贴.md",
      preview: "粘贴验证",
      readOnly: false,
      remotePath: "/Swell/测试/粘贴.md",
      revision: '"p1"',
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title: "粘贴",
      updatedAt: "刚刚",
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
      activeNoteId: note.id,
      directories: ["测试"],
      id: cacheId,
      label: "E2E 粘贴库",
      lastSyncedAt: Date.now(),
      notes: [note],
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    transaction.objectStore("documents").put({
      baseContent: initial,
      cacheId,
      content: initial,
      key: `${cacheId}\u0000${note.id}`,
      noteId: note.id,
      outgoingLinks: [],
      path: note.remotePath,
      tags: [],
      title: note.title,
    })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, content)
  await page.reload()
  await expect(page.locator(".cm-content")).toBeVisible()
}

// 读源码而不是读渲染文字：转义是否正确只有源码能说明，渲染后两者长得一样。
function documentText(page: Page) {
  return page.locator(".cm-content").innerText()
}

test.describe("粘贴", () => {
  test("富文本粘贴不再给数字与短横线塞反斜杠，粘贴后能按原文搜索", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedNote(page, "开始\n")
    await page.locator(".cm-content").click()
    await page.keyboard.press("Control+End")
    await page.keyboard.type("\n")

    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.setData("text/html", "<p>价格 100-200 元，版本 v1.2.3 发布</p>")
      transfer.setData("text/plain", "价格 100-200 元，版本 v1.2.3 发布")
      document.querySelector(".cm-content")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }))
    })

    await expect.poll(() => documentText(page)).toContain("价格 100-200 元")
    // 旧行为会落地成 `100\-200` 与 `v1\.2\.3`，⌘F 搜原文就搜不到了。
    expect(await documentText(page)).not.toContain("\\-")
    expect(await documentText(page)).not.toContain("\\.")

    // 查找栏只从右键菜单打开（⌘F 未绑定），所以经菜单进查找，再搜原文。
    const preview = page.locator(".cm-content")
    const box = (await preview.boundingBox())!
    await page.mouse.click(box.x + 8, box.y + 8, { button: "right" })
    await page.getByRole("menuitem", { name: "查找正文" }).click()
    await page.getByLabel("查找当前笔记").fill("100-200")
    await expect(page.getByText("1/1")).toBeVisible()
  })

  test("Cmd-Shift-V 走 paste 事件的 text/plain，不做 HTML 转 Markdown", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    // text/html 与 text/plain 是两份不同内容：默认粘贴读 HTML 转成「加粗内容」，
    // 纯文本粘贴必须原样落地 text/plain 的字面星号，一眼就能分辨走的哪条路。
    //
    // 关键：这里刻意不让剪贴板可读。旧实现在 keydown 里 preventDefault 后主动读
    // Clipboard API，一旦被拒就整个失败；新实现优先取 paste 事件里现成的文本，
    // 不碰权限，因此这条在剪贴板被拒时也必须通过。
    await page.addInitScript(() => {
      navigator.clipboard.read = () => Promise.reject(new DOMException("denied", "NotAllowedError"))
      navigator.clipboard.readText = () => Promise.reject(new DOMException("denied", "NotAllowedError"))
    })
    await seedNote(page, "开始\n")
    await page.locator(".cm-content").click()
    await page.keyboard.press("Control+End")
    await page.keyboard.type("\n")

    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.setData("text/html", "<p><strong>加粗内容</strong></p>")
      transfer.setData("text/plain", "原样**星号**文字")
      document.querySelector(".cm-content")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "v", ctrlKey: true, shiftKey: true }))
      document.querySelector(".cm-content")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }))
    })

    await expect.poll(() => documentText(page)).toContain("原样")
    const text = await documentText(page)
    // 即时预览会隐藏 `**` 只留文字，所以按可见文字断言：走的若是 HTML 路径，这里是「加粗内容」。
    expect(text).toContain("原样星号文字")
    expect(text).not.toContain("加粗内容")
  })

  test("没有 paste 事件时由 keyup 兜底读取剪贴板", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    // macOS 的 ⌘⇧V 不是系统粘贴命令，浏览器不会派发 paste 事件；
    // 只设标记会让快捷键彻底失效，因此必须有 keyup 兜底这条退路。
    await page.addInitScript(() => {
      navigator.clipboard.read = () => Promise.resolve([{
        getType: (type: string) => Promise.resolve(type === "text/html"
          ? new Blob(["<p><strong>加粗内容</strong></p>"], { type: "text/html" })
          : new Blob(["原样**星号**文字"], { type: "text/plain" })),
        types: ["text/html", "text/plain"],
      } as unknown as ClipboardItem])
    })
    await seedNote(page, "开始\n")
    await page.locator(".cm-content").click()
    await page.keyboard.press("Control+End")
    await page.keyboard.type("\n")

    // 只发 keydown + keyup，不发 paste：模拟浏览器压根不派发 paste 的情形。
    await page.evaluate(() => {
      const target = document.querySelector(".cm-content")!
      const options = { bubbles: true, cancelable: true, key: "v", ctrlKey: true, shiftKey: true }
      target.dispatchEvent(new KeyboardEvent("keydown", options))
      target.dispatchEvent(new KeyboardEvent("keyup", options))
    })

    await expect.poll(() => documentText(page)).toContain("原样")
    const text = await documentText(page)
    expect(text).toContain("原样星号文字")
    expect(text).not.toContain("加粗内容")
  })
})
