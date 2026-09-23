import { expect, test, type Locator, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { strFromU8, unzipSync } from "fflate"

import { useCompatibilityPreview } from "./note-view-mode"

// 右键 → 点某一项，两步之间必须等上一轮菜单从 DOM 里消失。
// 关闭的浮层在退场动画（约 100ms）期间仍挂在 body 上，此时右键的 pointerup 会被
// 它或刚展开的新菜单的菜单项接走（Radix 在 pointerdown 落在别处时，pointerup 会补发该项的 click），
// 于是一次右键就误触发了别的操作。人手右键不可能快到这个窗口里，只有测试会。
function awaitContextMenuOpener(page: Page, target: Locator) {
  return async (itemName: string) => {
    await expect(page.getByRole("menuitem")).toHaveCount(0)
    await target.click({ button: "right" })
    await page.getByRole("menuitem", { name: itemName, exact: true }).click()
  }
}

async function seedCachedVault(page: Page, noteContent?: string, readOnly = false, secondNoteContent = "# 第二篇\n\n正文 B", firstTitle = "第一篇") {
  await page.goto("/#/notes")
  await page.evaluate(async ({ noteContent, readOnly, secondNoteContent, firstTitle }) => {
    const cacheId = "e2e-vault"
    const noteA = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/第一篇.md",
      preview: `${firstTitle}摘要`,
      readOnly,
      remotePath: "/Swell/测试/第一篇.md",
      revision: '"a1"',
      source: readOnly ? "local" : "webdav",
      starred: false,
      syncStatus: "synced",
      title: firstTitle,
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
    for (const [note, content] of [[noteA, contentA], [noteB, secondNoteContent]] as const) {
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
  }, { noteContent, readOnly, secondNoteContent, firstTitle })
  await page.reload()
}

test.describe("编辑态链接点击跳转", () => {
  test("桌面端点击笔记链接与外链", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".desktop-workspace:visible")
    await expect(workspace.getByText("第一篇", { exact: true }).first()).toBeVisible()

    const editor = page.locator(".cm-content")
    await expect(editor).toBeVisible()
    // 点走编辑器，确保链接行不处于光标激活态。
    await page.mouse.click(20, 20)

    // 标准 Markdown 笔记链接：点击文字直接跳转。
    await editor.getByText("第二篇", { exact: true }).first().click()
    await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)

    // wiki 双链：同样单击跳转。
    await workspace.getByText("第一篇", { exact: true }).first().click()
    await page.mouse.click(20, 20)
    await page.locator(".cm-content .cm-md-link-actionable[data-wiki-target]").first().click()
    await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)

    // 外链：mousedown 与 click 去重后恰好打开一次。
    await workspace.getByText("第一篇", { exact: true }).first().click()
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

  test("移动端触屏点按笔记链接先弹出操作菜单", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")

    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")

    await expect(page.locator(".cm-content")).toBeVisible()

    // 移动端点按 [文字](地址) 链接不再直接跳转，先给「打开 / 编辑 / 移除」菜单。
    await page.locator(".cm-content .cm-md-link-actionable[data-md-note-target]").first().tap()
    const sheet = page.locator(".mobile-action-sheet")
    await expect(sheet.getByRole("button", { name: "打开链接" })).toBeVisible()
    await expect(sheet.getByRole("button", { name: "编辑链接" })).toBeVisible()
    await expect(sheet.getByRole("button", { name: "移除链接" })).toBeVisible()
    await sheet.getByRole("button", { name: "打开链接" }).tap()
    await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)
  })

  test("移动端 A 到 B 保活原编辑器且更新始终写入 B", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await expect(workspace.locator(".mobile-edge-swipe-current .cm-content")).toBeVisible()
    const entryA = workspace.locator(".mobile-edge-swipe-current")
    await entryA.evaluate((element) => { element.setAttribute("data-e2e-editor-identity", "editor-a") })

    await entryA.locator(".cm-md-link-actionable[data-md-note-target]").first().tap()
    await page.locator(".mobile-action-sheet").getByRole("button", { name: "打开链接" }).tap()
    await expect(workspace.getByRole("button", { name: "返回第一篇" })).toBeVisible()
    await expect(workspace.locator(".mobile-edge-swipe-previous")).toHaveAttribute("data-e2e-editor-identity", "editor-a")

    const editorB = workspace.locator(".mobile-edge-swipe-current .cm-content")
    await editorB.click()
    await page.keyboard.press("ControlOrMeta+End")
    await page.keyboard.type("\n只属于 B")
    await expect(editorB).toContainText("只属于 B")
    await page.goBack()

    const restoredA = workspace.locator(".mobile-edge-swipe-current")
    await expect(restoredA).toHaveAttribute("data-e2e-editor-identity", "editor-a")
    await expect(restoredA.locator(".cm-content")).not.toContainText("只属于 B")
  })

  test("移动端 Wiki 锚点只滚动当前路由层的同名标题", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page, "# 同名标题\n\n[[第二篇#同名标题]]", false, "# 同名标题\n\n正文 B")
    await page.evaluate(() => {
      const calls: boolean[] = []
      Object.defineProperty(window, "__anchorScrollCalls", { configurable: true, value: calls })
      Element.prototype.scrollIntoView = function scrollIntoView() {
        calls.push(Boolean(this.closest("[inert]")))
      }
    })
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await useCompatibilityPreview(page)
    await workspace.locator(".mobile-edge-swipe-current .markdown-preview").getByRole("button", { name: "第二篇", exact: true }).tap()
    await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)

    await expect.poll(() => page.evaluate(() => (window as unknown as { __anchorScrollCalls: boolean[] }).__anchorScrollCalls)).toContain(false)
    expect(await page.evaluate(() => (window as unknown as { __anchorScrollCalls: boolean[] }).__anchorScrollCalls)).not.toContain(true)
  })

  async function openMobileEditor(page: Page, noteContent?: string) {
    await seedCachedVault(page, noteContent)
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await expect(page.locator(".cm-content")).toBeVisible()
    return workspace
  }

  test("移动端编辑已有链接：改地址并保留正文其他内容", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await openMobileEditor(page)

    await page.locator(".cm-content .cm-md-link-actionable[data-md-href='https://example.com']").first().tap()
    const sheet = page.locator(".mobile-action-sheet")
    await sheet.getByRole("button", { name: "编辑链接" }).tap()
    // 预填原有文字与地址，避免手机上重新输入。
    await expect(sheet.getByLabel("显示文字")).toHaveValue("示例站")
    await expect(sheet.getByLabel("链接地址")).toHaveValue("https://example.com")
    await sheet.getByLabel("链接地址").fill("https://example.com/新地址")
    await sheet.getByRole("button", { name: "保存" }).tap()

    await expect(page.locator(".cm-content .cm-md-link-actionable[data-md-href='https://example.com/新地址']")).toBeVisible()
  })

  test("移动端移除链接后保留链接文字", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await openMobileEditor(page)

    await page.locator(".cm-content .cm-md-link-actionable[data-md-href='https://example.com']").first().tap()
    const sheet = page.locator(".mobile-action-sheet")
    await sheet.getByRole("button", { name: "移除链接" }).tap()

    await expect(page.locator(".cm-content .cm-md-link-actionable[data-md-href='https://example.com']")).toHaveCount(0)
    await expect(page.locator(".cm-content")).toContainText("示例站")
  })

  test("移动端工具栏新增链接：选中文字自动带入显示文字", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await openMobileEditor(page, "给这句话加链接")

    const editor = page.locator(".cm-content")
    await editor.tap()
    await page.keyboard.press("ControlOrMeta+a")
    await page.getByRole("button", { name: "更多格式" }).tap()
    await page.getByRole("menuitem", { name: "链接" }).tap()

    const sheet = page.locator(".mobile-action-sheet")
    await expect(sheet.getByLabel("显示文字")).toHaveValue("给这句话加链接")
    await sheet.getByLabel("链接地址").fill("https://example.com/toolbar")
    await sheet.getByRole("button", { name: "保存" }).tap()

    await expect(page.locator(".cm-content .cm-md-link-actionable[data-md-href='https://example.com/toolbar']")).toHaveText("给这句话加链接")
  })

  test("移动端链接面板取消后正文与选区不变", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await openMobileEditor(page, "给这句话加链接")

    const editor = page.locator(".cm-content")
    await editor.tap()
    await page.keyboard.press("ControlOrMeta+a")
    await page.getByRole("button", { name: "更多格式" }).tap()
    await page.getByRole("menuitem", { name: "链接" }).tap()

    const sheet = page.locator(".mobile-action-sheet")
    await sheet.getByRole("button", { name: "取消" }).tap()
    await expect(sheet).toHaveCount(0)
    await expect(editor).toHaveText("给这句话加链接")
    // 取消不改动正文，选区映射仍在原文上（格式栏仍处于选区模式）。
    await expect(page.getByRole("button", { name: "更多格式" })).toBeVisible()
  })

  test("移动端单元格内新增链接写进单元格而不是正文旧光标", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await openMobileEditor(page, "| 名称 | 链接 |\n| --- | --- |\n| 项目 | 点这里 |")

    const table = page.locator(".cm-md-table-wrap")
    await table.locator("td").nth(1).click()
    const input = table.locator("textarea")
    await expect(input).toBeFocused()
    await input.press("ControlOrMeta+a")

    await page.getByRole("button", { name: "更多格式" }).tap()
    await page.getByRole("menuitem", { name: "链接" }).tap()
    const sheet = page.locator(".mobile-action-sheet")
    // 选中的单元格文字自动带入显示文字。
    await expect(sheet.getByLabel("显示文字")).toHaveValue("点这里")
    await sheet.getByLabel("链接地址").fill("https://cell.example.com")
    await sheet.getByRole("button", { name: "保存" }).tap()

    // 保存后留在原单元格继续编辑，链接落在单元格内容里。
    await expect(table.locator("textarea")).toHaveValue("[点这里](https://cell.example.com)")
  })

  test("移动端单元格内编辑已有链接：预填并原位改写", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await openMobileEditor(page, "| 名称 | 链接 |\n| --- | --- |\n| 项目 | [旧站](https://old.example.com) |")

    const table = page.locator(".cm-md-table-wrap")
    await table.locator("td").nth(1).click()
    const input = table.locator("textarea")
    await expect(input).toBeFocused()
    await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 2))

    await page.getByRole("button", { name: "更多格式" }).tap()
    await page.getByRole("menuitem", { name: "链接" }).tap()
    const sheet = page.locator(".mobile-action-sheet")
    await expect(sheet.getByLabel("显示文字")).toHaveValue("旧站")
    await expect(sheet.getByLabel("链接地址")).toHaveValue("https://old.example.com")
    await sheet.getByLabel("链接地址").fill("https://new.example.com")
    await sheet.getByRole("button", { name: "保存" }).tap()

    await expect(table.locator("textarea")).toHaveValue("[旧站](https://new.example.com)")
  })

  test("移动端单元格链接面板取消后焦点与未保存内容留在单元格", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await openMobileEditor(page, "| 名称 | 链接 |\n| --- | --- |\n| 项目 | 点这里 |")

    const table = page.locator(".cm-md-table-wrap")
    await table.locator("td").nth(1).click()
    const input = table.locator("textarea")
    await expect(input).toBeFocused()
    await input.press("ControlOrMeta+a")

    await page.getByRole("button", { name: "更多格式" }).tap()
    await page.getByRole("menuitem", { name: "链接" }).tap()
    const sheet = page.locator(".mobile-action-sheet")
    await sheet.getByRole("button", { name: "取消" }).tap()
    await expect(sheet).toHaveCount(0)

    // 取消不把单元格提交掉：焦点还给 textarea，选区与内容保持打开面板前的样子。
    await expect(table.locator("textarea")).toBeFocused()
    await expect(table.locator("textarea")).toHaveValue("点这里")
  })
})

test.describe("编辑细节", () => {
  test("移动端列表回车续写时新行仍显示圆点与勾选框", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page, "- 要点一\n- [ ] 待办")
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    const editor = page.locator(".cm-content")
    await expect(editor).toBeVisible()

    // 光标落在列表项文字上：标记不还原成源码，圆点与勾选框保持渲染。
    await editor.getByText("要点一").tap()
    await expect(editor.locator(".cm-md-bullet")).toHaveCount(1)
    await expect(editor.locator(".cm-md-task-checkbox")).toHaveCount(1)

    // 行尾回车续写：新行同样直接显示圆点，不再露出 `- ` 源码。
    await page.keyboard.press("End")
    await page.keyboard.press("Enter")
    await expect(editor.locator(".cm-md-bullet")).toHaveCount(2)
    expect(await editor.evaluate((element) => element.textContent)).not.toContain("-")
  })

  test("右键菜单保留正文选区并支持格式、撤销与粘贴", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, "记录今天的想法")
    const editor = page.locator(".cm-content")
    const openMenu = awaitContextMenuOpener(page, editor)
    await editor.click()
    await editor.press("ControlOrMeta+a")
    await openMenu("加粗")
    // 实时预览把 `**` 星号渲染隐藏了，DOM 文本在加粗前后都是「记录今天的想法」，
    // 不能拿它断言格式是否生效——必须数加粗标记节点，否则加粗没生效这条也会通过。
    await expect(editor.locator(".cm-md-strong")).toHaveCount(1)
    await openMenu("撤销")
    await expect(editor.locator(".cm-md-strong")).toHaveCount(0)
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => "新的正文", writeText: async () => {} } })
    })
    await editor.click()
    await editor.press("ControlOrMeta+a")
    await openMenu("粘贴")
    await expect(editor).toHaveText("新的正文")
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { sessionStorage.setItem("copied", text) } } })
    })
    await editor.press("ControlOrMeta+a")
    await openMenu("剪切")
    await expect(editor.locator(".cm-placeholder")).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem("copied"))).toBe("新的正文")
    await openMenu("粘贴")
    await expect(page.getByRole("status").filter({ hasText: "无法读取剪贴板" })).toBeVisible()
    await expect(editor.locator(".cm-placeholder")).toBeVisible()
  })

  test("右键只读正文禁止修改但保留复制", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, "只读正文", true)
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
    // 默认视图是一体化编辑画布，`.markdown-preview` 只在兼容阅读视图里存在，
    // 不先切过去就永远等不到那个元素。
    await useCompatibilityPreview(page)
    const viewport = page.locator(".note-list-scroll")
    const bounds = await viewport.boundingBox()
    await viewport.click({ button: "right", position: { x: 20, y: bounds!.height - 20 } })
    await expect(page.getByRole("menuitem", { name: "新建笔记", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await page.locator(".markdown-preview").click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "导出笔记与附件包", exact: true })).toBeVisible()
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

  test("单篇导出包包含离线附件，并列明外链和缺失项", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page, "[报告](../attachments/report.pdf)\n![缺图](../attachments/lost.png)\n[官网](https://example.com)")
    await page.evaluate(async () => {
      const request = indexedDB.open("swell-note-vault-cache", 3)
      const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const path = "/Swell/attachments/report.pdf"
      const transaction = database.transaction("attachments", "readwrite")
      transaction.objectStore("attachments").put({
        cacheId: "e2e-vault", createdAt: Date.now(), data: new Uint8Array([1, 2, 3]).buffer,
        key: `e2e-vault\u0000${path}`, noteId: "webdav:/Swell/测试/第一篇.md", path, status: "synced",
      })
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
      database.close()
    })
    await page.getByRole("button", { name: "更多操作", exact: true }).click()
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: "导出笔记与附件包", exact: true }).click()
    const download = await downloadPromise
    const archive = unzipSync(new Uint8Array(await readFile(await download.path())))
    expect(download.suggestedFilename()).toBe("第一篇.zip")
    expect(strFromU8(archive["Swell/测试/第一篇.md"])).toContain("https://example.com")
    expect([...archive["Swell/attachments/report.pdf"]]).toEqual([1, 2, 3])
    expect(strFromU8(archive["导出清单.txt"])).toContain("https://example.com")
    expect(strFromU8(archive["导出清单.txt"])).toContain("lost.png（未找到附件）")
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

  test("长标题在列表和编辑器中换行显示", async ({ page }, testInfo) => {
    const longTitle = "这是一篇标题很长的笔记用来确认移动端和桌面端都能自动换行而不需要横向滑动查看全文".repeat(2)
    await seedCachedVault(page, undefined, false, undefined, longTitle)
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
    if (mobile) await workspace.getByText("测试", { exact: true }).first().click()

    const row = workspace.locator(".note-list-row").filter({ hasText: longTitle })
    await expect(row).toBeVisible()
    await expect.poll(() => row.locator(".note-row-heading strong").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(20)
    await row.click()

    const title = workspace.getByRole("textbox", { name: "笔记标题" })
    await expect(title).toHaveValue(longTitle)
    await expect.poll(() => title.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(40)
    expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await title.fill("第一行\n第二行")
    await expect(title).toHaveValue("第一行 第二行")
  })

  test("工具栏整行格式保持选区并支持再次取消", async ({ page }, testInfo) => {
    await seedCachedVault(page)
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
    if (mobile) {
      await workspace.getByText("测试", { exact: true }).first().click()
      await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    }
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
