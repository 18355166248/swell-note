import { expect, test, type Page } from "@playwright/test"

async function seedCachedVault(page: Page, noteContent?: string, readOnly = false) {
  await page.goto("/#/notes")
  await page.evaluate(async ({ noteContent, readOnly }) => {
    const cacheId = "e2e-vault"
    const noteA = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/第一篇.md",
      preview: "第一篇摘要",
      readOnly,
      remotePath: "/Swell/测试/第一篇.md",
      revision: '"a1"',
      source: readOnly ? "local" : "webdav",
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
    const contentA = noteContent ?? [
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
  }, { noteContent, readOnly })
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

test.describe("编辑细节", () => {
  test("右键菜单保留正文选区并支持格式、撤销与粘贴", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, "记录今天的想法")
    await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    const editor = page.locator(".cm-content")
    await editor.click()
    await editor.press("ControlOrMeta+a")
    await editor.click({ button: "right" })
    await page.getByRole("menuitem", { name: "加粗", exact: true }).click()
    await expect(editor).toHaveText("**记录今天的想法**")
    await editor.click({ button: "right" })
    await page.getByRole("menuitem", { name: "撤销", exact: true }).click()
    await expect(editor).toHaveText("记录今天的想法")
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => "新的正文", writeText: async () => {} } })
    })
    await editor.click()
    await editor.press("ControlOrMeta+a")
    await editor.click({ button: "right" })
    await page.getByRole("menuitem", { name: "粘贴", exact: true }).click()
    await expect(editor).toHaveText("新的正文")
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { sessionStorage.setItem("copied", text) } } })
    })
    await editor.press("ControlOrMeta+a")
    await editor.click({ button: "right" })
    await page.getByRole("menuitem", { name: "剪切", exact: true }).click()
    await expect(editor.locator(".cm-placeholder")).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem("copied"))).toBe("新的正文")
    await editor.click({ button: "right" })
    await page.getByRole("menuitem", { name: "粘贴", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "无法读取剪贴板" })).toBeVisible()
    await expect(editor.locator(".cm-placeholder")).toBeVisible()
  })

  test("右键只读正文禁止修改但保留复制", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, "只读正文", true)
    await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    const editor = page.locator(".cm-content")
    await editor.click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "粘贴", exact: true })).toBeDisabled()
    await expect(page.getByRole("menuitem", { name: "加粗", exact: true })).toBeDisabled()
    await page.getByRole("menuitem", { name: "全选正文", exact: true }).click()
    await editor.click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "复制", exact: true })).toBeEnabled()
    await expect(page.getByRole("menuitem", { name: "剪切", exact: true })).toBeDisabled()
  })

  test("右键输入框替换选区，表格菜单操作命中的行", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, "开头\n\n| 名称 | 数值 |\n| --- | --- |\n| 第一行 | 1 |\n| 第二行 | 2 |\n\n结尾")
    await page.getByRole("button", { name: "编辑模式", exact: true }).click()
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => "替换", writeText: async () => {} } })
    })
    const title = page.getByRole("textbox", { name: "笔记标题" })
    await title.focus()
    await title.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 1))
    await title.click({ button: "right" })
    await page.getByRole("menuitem", { name: "粘贴", exact: true }).click()
    await expect(title).toHaveValue("替换一篇")
    const table = page.locator(".cm-md-table-wrap")
    await table.locator("td").nth(2).click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "删除行", exact: true })).toBeEnabled()
    await page.getByRole("menuitem", { name: "删除行", exact: true }).click()
    await expect(table.locator("tbody tr")).toHaveCount(1)
    await expect(table.locator("tbody")).toContainText("第一行")
    await table.locator("th").first().click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "删除行", exact: true })).toBeDisabled()
    await page.keyboard.press("Escape")
    await table.locator("td").first().click()
    const input = table.locator("textarea")
    await input.press("ControlOrMeta+a")
    await input.click({ button: "right" })
    await page.getByRole("menuitem", { name: "粘贴", exact: true }).click()
    await expect(input).toHaveValue("替换")
    await input.press("Tab")
    await expect(table.locator("td").first()).toHaveText("替换")
  })

  test("右键列表空白与阅读正文显示各自操作", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, "用于阅读的正文")
    const viewport = page.locator(".note-list-scroll")
    const bounds = await viewport.boundingBox()
    await viewport.click({ button: "right", position: { x: 20, y: bounds!.height - 20 } })
    await expect(page.getByRole("menuitem", { name: "新建笔记", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await page.locator(".markdown-preview").click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "导出 Markdown 文件", exact: true })).toBeVisible()
    await page.getByRole("menuitem", { name: "全选正文", exact: true }).click()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("用于阅读的正文")
    await expect(page.getByRole("menu")).toHaveCount(0)
    const prevented = await page.locator(".editor-titlebar").evaluate((el) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
      el.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(prevented).toBe(true)
  })

  test("单元格默认续写，长表格工具条常驻并吸顶", async ({ page }, testInfo) => {
    const content = "开头\n\n| 名称 | 数值 |\n| --- | --- |\n"
      + Array.from({ length: 60 }, (_, i) => `| 项目${i + 1} | ${i + 1} |`).join("\n")
      + "\n\n表格后正文"
    await seedCachedVault(page, content)
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
    if (mobile) {
      await workspace.getByText("测试", { exact: true }).first().click()
      await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    }
    await workspace.getByRole("button", { name: "编辑模式" }).click()
    const table = workspace.locator(".cm-md-table-wrap")
    const toolbar = table.locator(".cm-md-table-toolbar")
    await expect(toolbar).toBeVisible()
    const cell = table.locator("td").first()
    await cell.click()
    const input = table.locator("textarea")
    await expect(input).toBeFocused()
    expect(await input.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([3, 3])
    await input.press("End")
    await input.press("X")
    await expect(input).toHaveValue("项目1X")
    await input.press("Tab")
    await expect(table.locator("td").first()).toHaveText("项目1X")
    // 在实际滚动容器中移到表格下半部，验证吸顶几何位置和菜单操作，而不只断言 CSS。
    await table.locator("tr").nth(45).scrollIntoViewIfNeeded()
    await expect(toolbar).toBeInViewport()
    const tableBox = await table.boundingBox()
    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox!.y).toBeGreaterThan(tableBox!.y + 100)
    await toolbar.getByLabel("行列操作").click()
    await expect(table.getByRole("button", { name: "添加行", exact: true })).toBeInViewport()
    await table.getByRole("button", { name: "添加行", exact: true }).click()
    await expect(table.locator("tbody tr")).toHaveCount(61)
  })

  test("标题中文确认不失焦，取消不重命名，回车进入正文", async ({ page }, testInfo) => {
    await seedCachedVault(page)
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
    if (mobile) {
      await workspace.getByText("测试", { exact: true }).first().click()
      await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    }
    await workspace.getByRole("button", { name: "编辑模式" }).click()
    const title = workspace.getByRole("textbox", { name: "笔记标题" })
    await title.fill("尚未确认的标题")
    await title.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true })
    await expect(title).toBeFocused()
    await title.press("Escape")
    await expect(title).toHaveValue("第一篇")
    await title.focus()
    await title.press("Enter")
    await expect(workspace.locator(".cm-content")).toBeFocused()
  })

  test("工具栏整行格式保持选区并支持再次取消", async ({ page }, testInfo) => {
    await seedCachedVault(page)
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
    if (mobile) {
      await workspace.getByText("测试", { exact: true }).first().click()
      await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    }
    await workspace.getByRole("button", { name: "编辑模式" }).click()
    const editor = workspace.locator(".cm-content")
    await editor.fill("记录今天的想法")
    await editor.press("ArrowLeft")
    const heading = workspace.getByRole("combobox", { name: "标题级别", exact: true })
    await heading.selectOption("##")
    await expect(editor).toHaveText("## 记录今天的想法")
    await expect(editor).toBeFocused()
    // 受控选择器重选同级不会触发 onChange，取消标题走「正文」选项。
    await heading.selectOption("")
    await expect(editor).toHaveText("记录今天的想法")
    await editor.press("X")
    await expect(editor).toHaveText("记录今天的想X法")
  })
})
