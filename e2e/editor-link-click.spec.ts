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
  test("桌面端按平台键位点击笔记链接与外链", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedCachedVault(page)
    const workspace = page.locator(".desktop-workspace:visible")
    await expect(workspace.getByText("第一篇", { exact: true }).first()).toBeVisible()

    const editor = page.locator(".cm-content")
    await expect(editor).toBeVisible()
    const modifiers: Array<"Meta"> = process.platform === "darwin" ? ["Meta"] : []
    // 点走编辑器，确保链接行不处于光标激活态。
    await page.mouse.click(20, 20)

    // Mac 编辑态 Cmd 点击；其他桌面平台保留既有点击行为。
    await editor.getByText("第二篇", { exact: true }).first().click({ modifiers })
    await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)

    // wiki 双链：同样按平台键位打开。
    await workspace.getByText("第一篇", { exact: true }).first().click()
    await page.mouse.click(20, 20)
    await page.locator(".cm-content .cm-md-link-actionable[data-wiki-target]").first().click({ modifiers })
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
    await page.locator(".cm-content .cm-md-link-actionable[data-md-href]").first().click({ modifiers })
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __openCalls: string[] }).__openCalls))
      .toEqual(["https://example.com/page"])
  })

  test("Mac 编辑链接单击和拖选保留当前位置", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome" || process.platform !== "darwin")
    await seedCachedVault(page)
    const editor = page.locator(".cm-content")
    const link = editor.locator("[data-md-note-target]").first()
    const currentUrl = page.url()
    await link.click()
    await expect(page).toHaveURL(currentUrl)
    await expect(editor).toBeFocused()
    const rect = await link.boundingBox()
    expect(rect).not.toBeNull()
    await page.mouse.move(rect!.x + 2, rect!.y + rect!.height / 2)
    await page.mouse.down()
    await page.mouse.move(rect!.x + rect!.width - 2, rect!.y + rect!.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(page).toHaveURL(currentUrl)
    expect(await page.evaluate(() => document.getSelection()?.toString())).toContain("第二篇")
    await page.screenshot({ path: testInfo.outputPath("mac-link-selection.png") })
  })

  test("Mac Option 上下按段落导航和扩选而不改正文", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome" || process.platform !== "darwin")
    const content = "第一段文字\n第二段文字\n第三段文字"
    await seedCachedVault(page, content)
    const editor = page.locator(".cm-content")
    await expect(editor.locator(".cm-line")).toHaveText(content.split("\n"))
    const selection = async (reset = false) => editor.evaluate(async (element, reset) => {
      // Read the same CodeMirror view used by the running app, via its public DOM lookup API.
      const modulePath = "/node_modules/.vite/deps/@codemirror_view.js"
      const { EditorView } = await import(/* @vite-ignore */ modulePath)
      const view = EditorView.findFromDOM(element)
      if (reset) { view.dispatch({ selection: { anchor: 8 } }); view.focus() }
      const { anchor, head } = view.state.selection.main
      return { anchor, head, content: view.state.doc.toString() }
    }, reset)
    for (const [key, anchor, head] of [
      ["Alt+ArrowUp", 6, 6], ["Alt+ArrowDown", 11, 11],
      ["Shift+Alt+ArrowUp", 8, 6], ["Shift+Alt+ArrowDown", 8, 11],
    ] as const) {
      await selection(true)
      await editor.press(key)
      expect(await selection()).toEqual({ anchor, head, content })
    }
    await page.screenshot({ path: testInfo.outputPath("mac-option-selection.png") })
  })

  test("Mac 完整编辑器 Cmd Enter 打开链接且不产生正文事务", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome" || process.platform !== "darwin")
    for (const source of ["[[第二篇]]", "[第二篇](./第二篇.md)", "https://example.com/page"]) {
      await seedCachedVault(page, `正文\n\n${source}`)
      const editor = page.locator(".cm-content")
      await expect(editor.locator(".cm-md-link-actionable")).toBeVisible()
      await editor.evaluate(async (element, source) => {
        const viewModule = "/node_modules/.vite/deps/@codemirror_view.js"
        const stateModule = "/node_modules/.vite/deps/@codemirror_state.js"
        const { EditorView } = await import(/* @vite-ignore */ viewModule)
        const { StateEffect } = await import(/* @vite-ignore */ stateModule)
        const view = EditorView.findFromDOM(element)
        const log: string[] = []
        const opened: string[] = []
        Object.assign(window, { __keyboardLinkChanges: log, __keyboardLinkOpened: opened })
        window.open = (url) => { opened.push(String(url)); return null }
        view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of((update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => {
          if (update.docChanged) log.push(update.state.doc.toString())
        })), selection: { anchor: view.state.doc.toString().indexOf(source.startsWith("http") ? "https" : "第二篇") + 1 } })
        view.focus()
      }, source)
      await editor.press("Meta+Enter")
      if (source.startsWith("http")) {
        await expect.poll(() => page.evaluate(() => (window as unknown as { __keyboardLinkOpened: string[] }).__keyboardLinkOpened)).toEqual(["https://example.com/page"])
      } else {
        await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)
      }
      expect(await page.evaluate(() => (window as unknown as { __keyboardLinkChanges: string[] }).__keyboardLinkChanges)).toEqual([])
    }
  })

  test("Mac Cmd Enter 从目的地址和邻接边界打开并保留撤销", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome" || process.platform !== "darwin")
    const cases = [
      { marked: "[示例站](https://example.com/a\\>¦)", target: "https://example.com/a>" },
      { marked: "[示例站](https://example.com/a(b)¦)", target: "https://example.com/a(b)" },
      { marked: "[示例站](https://example.com/a\\(b\\)¦)", target: "https://example.com/a(b)" },
      { marked: '[示例站](https://example.com/path "提¦示")', target: "https://example.com/path" },
      { marked: "[甲](https://a.example)¦[乙](https://b.example)", target: "https://b.example" },
      { marked: "普通段落\n\n".repeat(100000) + "[长文尾部](https://example.com/pa¦th)", target: "https://example.com/path" },
      { marked: "[第二篇](./第二篇.md¦)", target: "./第二篇.md" },
    ]
    for (const [index, { marked, target }] of cases.entries()) {
      const initial = "正文\n\n" + marked.replace("¦", "")
      const anchor = 4 + marked.indexOf("¦")
      await seedCachedVault(page, initial)
      const editor = page.locator(".desktop-workspace:visible .cm-content")
      await expect(editor).toBeVisible()
      const edited = await editor.evaluate(async (element, anchor) => {
        const viewModule = "/node_modules/.vite/deps/@codemirror_view.js"
        const stateModule = "/node_modules/.vite/deps/@codemirror_state.js"
        const commandsModule = "/node_modules/.vite/deps/@codemirror_commands.js"
        const { EditorView } = await import(/* @vite-ignore */ viewModule)
        const { StateEffect } = await import(/* @vite-ignore */ stateModule)
        const { undoDepth } = await import(/* @vite-ignore */ commandsModule)
        const view = EditorView.findFromDOM(element)
        view.dispatch({ changes: { from: 0, insert: "更新 " }, userEvent: "input.type" })
        const changes: string[] = []
        const opened: string[] = []
        Object.assign(window, { __keyboardBoundaryProbe: { view, changes, opened, beforeDepth: undoDepth(view.state) } })
        window.open = (url) => { opened.push(String(url)); return null }
        view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of((update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => {
          if (update.docChanged) changes.push(update.state.doc.toString())
        })), selection: { anchor: anchor + 3 }, scrollIntoView: true })
        view.focus()
        return view.state.doc.toString()
      }, anchor)
      await editor.press("Meta+Enter")
      if (target.startsWith("https:")) {
        await expect.poll(() => page.evaluate(() => (window as unknown as { __keyboardBoundaryProbe: { opened: string[] } }).__keyboardBoundaryProbe.opened)).toEqual([target])
        const inspect = async () => page.evaluate(async () => {
          const commandsModule = "/node_modules/.vite/deps/@codemirror_commands.js"
          const { undoDepth } = await import(/* @vite-ignore */ commandsModule)
          const probe = (window as unknown as { __keyboardBoundaryProbe: { view: { state: { doc: { toString: () => string } } }; beforeDepth: number; changes: string[] } }).__keyboardBoundaryProbe
          return { doc: probe.view.state.doc.toString(), depth: undoDepth(probe.view.state), beforeDepth: probe.beforeDepth, changes: probe.changes }
        })
        await expect.poll(inspect).toEqual({ doc: edited, depth: 1, beforeDepth: 1, changes: [] })
        if (index === 0) await page.screenshot({ path: testInfo.outputPath("mac-link-destination-tail.png") })
        await editor.press("Meta+z")
        await expect.poll(async () => (await inspect()).doc).toBe(initial)
        await expect.poll(async () => (await inspect()).depth).toBe(0)
      } else {
        await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)
        expect(await page.evaluate(() => (window as unknown as { __keyboardBoundaryProbe: { changes: string[] } }).__keyboardBoundaryProbe.changes)).toEqual([])
      }
    }
  })

  test("Mac Cmd Enter 在代码和图片伪链接保留默认换行", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome" || process.platform !== "darwin")
    for (const marked of ["\u0060[标签](https://example.com/pa¦th)\u0060", "![图](https://example.com/im¦age.png)", "普通¦段落"]) {
      const initial = marked.replace("¦", "")
      await seedCachedVault(page, initial)
      const editor = page.locator(".desktop-workspace:visible .cm-content")
      await expect(editor).toBeVisible()
      await editor.evaluate(async (element, anchor) => {
        const viewModule = "/node_modules/.vite/deps/@codemirror_view.js"
        const { EditorView } = await import(/* @vite-ignore */ viewModule)
        const view = EditorView.findFromDOM(element)
        const opened: string[] = []
        Object.assign(window, { __keyboardBoundaryDefault: { view, opened } })
        window.open = (url) => { opened.push(String(url)); return null }
        view.dispatch({ selection: { anchor } })
        view.focus()
      }, marked.indexOf("¦"))
      await editor.press("Meta+Enter")
      const result = await page.evaluate(() => {
        const probe = (window as unknown as { __keyboardBoundaryDefault: { view: { state: { doc: { toString: () => string } } }; opened: string[] } }).__keyboardBoundaryDefault
        return { doc: probe.view.state.doc.toString(), opened: probe.opened }
      })
      expect(result).toEqual({ doc: initial + "\n", opened: [] })
    }
  })

  test("Mac 表格链接普通点击编辑且 Cmd 点击打开", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome" || process.platform !== "darwin")
    for (const href of ["./第二篇.md", "https://example.com/page"]) {
      await seedCachedVault(page, `| 名称 |\n| --- |\n| [标签](${href}) |`)
      const editor = page.locator(".cm-content")
      const link = editor.locator(".cm-md-table-link")
      const url = page.url()
      await link.click()
      await expect(page).toHaveURL(url)
      const input = editor.locator(".cm-md-table-cell-input")
      await expect(input).toBeFocused()
      await expect(input).toHaveValue(`[标签](${href})`)
      await input.press("Escape")
      await expect(link).toBeVisible()
      await page.evaluate(() => {
        const calls: string[] = []
        Object.assign(window, { __tableLinkOpened: calls })
        window.open = (url) => { calls.push(String(url)); return null }
      })
      await link.click({ modifiers: ["Meta"] })
      if (href.startsWith("http")) {
        expect(await page.evaluate(() => (window as unknown as { __tableLinkOpened: string[] }).__tableLinkOpened)).toEqual([href])
      } else {
        await expect(page).toHaveURL(/#\/notes\/webdav.*%E7%AC%AC%E4%BA%8C%E7%AF%87/)
      }
    }
  })

  test("Mac 表格链接拖选尾随点击不跳转", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome" || process.platform !== "darwin")
    await seedCachedVault(page, "| 名称 |\n| --- |\n| [标签](https://example.com/page) |")
    const link = page.locator(".cm-md-table-link")
    await expect(link).toBeVisible()
    await page.evaluate(() => {
      const calls: string[] = []
      Object.assign(window, { __tableLinkOpened: calls })
      window.open = (url) => { calls.push(String(url)); return null }
    })
    const rect = await link.boundingBox()
    await page.keyboard.down("Meta")
    await page.mouse.move(rect!.x + 2, rect!.y + rect!.height / 2)
    await page.mouse.down()
    await page.mouse.move(rect!.x + rect!.width - 2, rect!.y + rect!.height / 2, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up("Meta")
    expect(await page.evaluate(() => (window as unknown as { __tableLinkOpened: string[] }).__tableLinkOpened)).toEqual([])
    await expect(page.locator(".cm-md-table-cell-input")).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("mac-table-link-selection.png") })
  })

  test("移动端选区更多菜单撤销保持编辑焦点", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page, "撤销测试")
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    const editor = workspace.locator(".mobile-edge-swipe-current .cm-content")
    await expect(editor).toHaveText("撤销测试")
    await editor.press("End")
    await page.waitForTimeout(550)
    await editor.press("X")
    await editor.press("ControlOrMeta+A")
    await workspace.getByRole("button", { name: "更多格式", exact: true }).tap()
    await expect(editor).toBeFocused()
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("撤销测试X")
    await page.screenshot({ path: testInfo.outputPath("mobile-selection-undo-menu.png") })
    await workspace.getByRole("menuitem", { name: "撤销", exact: true }).tap()
    await expect(editor).toHaveText("撤销测试")
    await expect(editor).toBeFocused()
  })

  test("移动端十轮侧滑取消保持焦点选区并能继续输入", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    await seedCachedVault(page, "中文输入与选区")
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    const editor = workspace.locator(".mobile-edge-swipe-current .cm-content")
    await expect(editor).toHaveText("中文输入与选区")
    await editor.press("ControlOrMeta+A")
    const initial = await editor.boundingBox()
    for (let round = 0; round < 10; round++) {
      await editor.evaluate((element) => {
        const send = (type: string, x: number, ended = false) => {
          const touch = new Touch({ identifier: 7, target: element, clientX: x, clientY: 180 })
          element.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
            touches: ended ? [] : [touch], changedTouches: [touch] }))
        }
        send("touchstart", 6)
        send("touchmove", 45)
        send("touchcancel", 45, true)
      })
      await expect(workspace).toHaveAttribute("data-edge-swipe-state", "idle")
      await expect(editor).toBeFocused()
      await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe("中文输入与选区")
      const rect = await editor.boundingBox()
      expect(Math.abs(rect!.y - initial!.y)).toBeLessThan(2)
    }
    await editor.press("ArrowRight")
    await editor.press("X")
    await expect(editor).toHaveText("中文输入与选区X")
    await page.screenshot({ path: testInfo.outputPath("mobile-cancelled-swipe.png") })
  })

  test("查找命中后一次关闭保留匹配选区并可继续输入", async ({ page }, testInfo) => {
    await seedCachedVault(page, "中文 猫")
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
    if (mobile) {
      await workspace.getByText("测试", { exact: true }).first().click()
      await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    }
    const editor = workspace.locator(".cm-content")
    await expect(editor).toHaveText("中文 猫")
    await editor.press("ControlOrMeta+f")
    await workspace.getByLabel("查找当前笔记").fill("猫")
    await expect(workspace.locator(".editor-find-field [aria-live]")).toHaveText("1/1")
    // 等真正的匹配选区建立，避免在查找的下一帧前点关闭而漏掉移动端 pointerup 守卫。
    if (mobile) await expect(workspace.locator('.formatting-toolbar[data-selection-mode="true"]')).toBeVisible()
    const close = workspace.getByRole("button", { name: "关闭查找", exact: true })
    if (mobile) await close.tap()
    else await close.click()
    await expect(workspace.locator(".editor-find-bar")).toHaveCount(0)
    await expect(editor).toHaveText("中文 猫")
    if (mobile) await expect(workspace.locator('.formatting-toolbar[data-selection-mode="true"]')).toBeVisible()
    await editor.focus()
    await page.keyboard.type("X")
    await expect(editor).toHaveText("中文 X")
    await page.screenshot({ path: testInfo.outputPath("find-close-first-tap.png") })
  })

  test("查找控件切换匹配和组合态回车保持正文选区", async ({ page }, testInfo) => {
    await seedCachedVault(page, "中文 猫 狗 猫")
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
    if (mobile) {
      await workspace.getByText("测试", { exact: true }).first().click()
      await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    }
    const editor = workspace.locator(".cm-content")
    await editor.press("ControlOrMeta+f")
    const query = workspace.getByLabel("查找当前笔记")
    const result = workspace.locator(".editor-find-field [aria-live]")
    await query.fill("猫")
    await expect(result).toHaveText("1/2")
    await query.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true })
    await expect(result).toHaveText("1/2")
    await query.press("Enter")
    await expect(result).toHaveText("2/2")
    const previous = workspace.getByRole("button", { name: "上一个匹配项", exact: true })
    if (mobile) await previous.tap()
    else await previous.click()
    await expect(result).toHaveText("1/2")
    await workspace.getByLabel("替换为", { exact: true }).fill("狐")
    const replace = workspace.getByRole("button", { name: "替换", exact: true })
    if (mobile) await replace.tap()
    else await replace.click()
    await expect(editor).toHaveText("中文 狐 狗 猫")
    await expect(result).toHaveText("1/1")
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
    // 吸顶后只保留抓手；先显式展开，避免下挂工具条遮住可见单元格。
    if (mobile) await toolbar.tap()
    else await toolbar.click()
    await expect(toolbar.getByLabel("行列操作")).toBeVisible()
    await toolbar.getByLabel("行列操作").click()
    // 菜单挂到 body 避免滚动祖先裁切，操作按钮不再属于表格 DOM 子树。
    const addRow = page.getByRole("button", { name: "添加行", exact: true })
    await expect(addRow).toBeInViewport()
    await addRow.click()
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
    await seedCachedVault(page, "记录今天的想法")
    const mobile = testInfo.project.name === "mobile-chrome"
    const workspace = page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
    if (mobile) {
      await workspace.getByText("测试", { exact: true }).first().click()
      await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    }
    const editor = workspace.locator(".cm-content")
    await expect(editor).toHaveText("记录今天的想法")
    const readCachedContent = async () => page.evaluate(async () => {
      const request = indexedDB.open("swell-note-vault-cache", 3)
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const documentRequest = database.transaction("documents", "readonly").objectStore("documents")
        .get("e2e-vault\u0000webdav:/Swell/测试/第一篇.md")
      const content = await new Promise<string>((resolve, reject) => {
        documentRequest.onsuccess = () => resolve(documentRequest.result?.content ?? "")
        documentRequest.onerror = () => reject(documentRequest.error)
      })
      database.close()
      return content
    })
    await editor.press("End")
    await editor.press("ArrowLeft")
    const heading = workspace.getByRole("combobox", { name: "标题级别", exact: true })
    await heading.click()
    await page.getByRole("option", { name: "二级标题", exact: true }).click()
    await expect(editor).toBeFocused()
    // 标题正文里的光标不展开 # 标记，验证实际标题样式和已保存 Markdown。
    await expect(editor.locator(".cm-md-h2")).toHaveText("记录今天的想法")
    await expect.poll(readCachedContent).toBe("## 记录今天的想法")
    // 受控选择器重选同级不会触发 onChange，取消标题走「正文」选项。
    await heading.click()
    await page.getByRole("option", { name: "正文", exact: true }).click()
    await expect(editor).toHaveText("记录今天的想法")
    await editor.press("X")
    await expect(editor).toHaveText("记录今天的想X法")
    await expect.poll(readCachedContent).toBe("记录今天的想X法")
    await heading.click()
    await page.keyboard.press("Escape")
    await expect(heading).toBeFocused()
    await expect(editor).toHaveText("记录今天的想X法")
    await page.screenshot({ path: testInfo.outputPath("heading-format-and-cancel.png") })
  })
})

test.describe("移动待办触区与侧滑", () => {
  test.beforeEach(async ({ page }) => { await page.route("**/api/webdav/**", (route) => route.abort()) })
  const taskDoc = "# 任务检查\n\n- [ ] 未完成任务\n- [x] 已完成任务\n\n末段用于选区检查"
  async function openTaskFixture(page: Page, doc = taskDoc) {
    await seedCachedVault(page, doc)
    const workspace = page.locator(".mobile-workspace:visible")
    await workspace.getByText("测试", { exact: true }).first().click()
    await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    const editor = workspace.locator(".mobile-edge-swipe-current .cm-content")
    await expect(editor).toBeVisible()
    await editor.evaluate(async (element) => {
      const viewModule = "/node_modules/.vite/deps/@codemirror_view.js"
      const stateModule = "/node_modules/.vite/deps/@codemirror_state.js"
      const { EditorView } = await import(/* @vite-ignore */ viewModule)
      const { StateEffect } = await import(/* @vite-ignore */ stateModule)
      const view = EditorView.findFromDOM(element)
      const changes: string[] = []
      Object.assign(window, { __taskToggleProbe: { view, changes } })
      view.dispatch({ selection: { anchor: view.state.doc.length - 4, head: view.state.doc.length }, effects: StateEffect.appendConfig.of(EditorView.updateListener.of((update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => {
        if (update.docChanged) changes.push(update.state.doc.toString())
      })) })
    })
    return { workspace, editor }
  }
  const inspectTasks = (page: Page) => page.evaluate(() => {
    const probe = (window as unknown as { __taskToggleProbe: { view: { hasFocus: boolean; state: { doc: { toString: () => string }; selection: { toJSON: () => unknown } } }; changes: string[] } }).__taskToggleProbe
    return { doc: probe.view.state.doc.toString(), selection: probe.view.state.selection.toJSON(), changes: probe.changes, focused: probe.view.hasFocus }
  })

  test("中心与32px边界可勾选取消且保持焦点选区", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    test.setTimeout(60_000)
    for (const focused of [false, true]) for (const x of [27.5, 31, 32, 33, 34]) {
      const { editor } = await openTaskFixture(page)
      await editor.evaluate((element, focused) => focused ? (element as HTMLElement).focus() : (element as HTMLElement).blur(), focused)
      const before = await inspectTasks(page)
      const box = editor.locator(".cm-md-task-checkbox").first()
      const rect = (await box.boundingBox())!
      await page.touchscreen.tap(x, rect.y + rect.height / 2)
      await expect(box).toBeChecked()
      let state = await inspectTasks(page)
      expect(state.doc).toBe(taskDoc.replace("- [ ] 未完成", "- [x] 未完成"))
      expect(state.changes).toHaveLength(1)
      expect(state.selection).toEqual(before.selection)
      expect(state.focused).toBe(focused)
      await page.touchscreen.tap(x, rect.y + rect.height / 2)
      await expect(box).not.toBeChecked()
      state = await inspectTasks(page)
      expect(state.doc).toBe(taskDoc)
      expect(state.changes).toHaveLength(2)
      expect(state.selection).toEqual(before.selection)
      if (focused && x === 27.5) await page.screenshot({ path: testInfo.outputPath("task-center-focus-selection.png") })
    }
  })

  test("扩展触区保持图标行距并独立命中相邻任务", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    const { editor } = await openTaskFixture(page)
    const boxes = editor.locator(".cm-md-task-checkbox")
    const first = (await boxes.nth(0).boundingBox())!
    const second = (await boxes.nth(1).boundingBox())!
    expect(first.width).toBe(15)
    expect(first.height).toBe(15)
    expect(second.y - first.y).toBeGreaterThan(28)
    expect(second.y - first.y).toBeLessThan(30)
    await page.touchscreen.tap(first.x - 6, first.y + first.height / 2)
    await expect(boxes.nth(0)).toBeChecked()
    await expect(boxes.nth(1)).toBeChecked()
    await page.touchscreen.tap(second.x + second.width / 2, second.y + second.height / 2 + 11)
    await expect(boxes.nth(1)).not.toBeChecked()
    await expect(boxes.nth(0)).toBeChecked()
    expect((await inspectTasks(page)).changes).toHaveLength(2)
    const gapY = (first.y + second.y) / 2 + first.height / 2
    await page.touchscreen.tap(first.x + first.width / 2, gapY)
    expect((await inspectTasks(page)).changes).toHaveLength(2)
    await page.screenshot({ path: testInfo.outputPath("task-expanded-area-neighbors.png") })
  })

  test("微移动单次更新而任务起手拖动不勾选不返回", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    const { workspace, editor } = await openTaskFixture(page)
    const session = await context.newCDPSession(page)
    const rect = (await editor.locator(".cm-md-task-checkbox").first().boundingBox())!
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    const send = (type: string, atX = x, atY = y) => session.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: atX, y: atY }] })
    const beforeUrl = page.url()
    await send("touchStart"); await send("touchMove", x + 4, y + 2); await send("touchEnd")
    await expect(editor.locator(".cm-md-task-checkbox").first()).toBeChecked()
    expect((await inspectTasks(page)).changes).toHaveLength(1)
    await send("touchStart"); await send("touchMove", x + 80); await send("touchMove", x); await send("touchEnd")
    await page.waitForTimeout(250)
    expect((await inspectTasks(page)).changes).toHaveLength(1)
    expect(page.url()).toBe(beforeUrl)
    await expect(workspace).toHaveAttribute("data-screen", "editor")
    await expect(editor.locator(".cm-md-task-checkbox").first()).toBeChecked()
  })

  test("快速连点与嵌套待办只切换目标并保留正文选择", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    const doc = "# 嵌套待办\n\n- [ ] 根任务\n  - [ ] 子任务\n\n末段"
    const { editor } = await openTaskFixture(page, doc)
    const box = editor.locator(".cm-md-task-checkbox").nth(1)
    const rect = (await box.boundingBox())!
    await page.touchscreen.tap(rect.x + 7.5, rect.y + 7.5)
    await page.touchscreen.tap(rect.x + 7.5, rect.y + 7.5)
    await expect(box).not.toBeChecked()
    expect((await inspectTasks(page)).doc).toBe(doc)
    expect((await inspectTasks(page)).changes).toHaveLength(2)
    const textRect = await editor.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const index = walker.currentNode.textContent?.indexOf("根任务") ?? -1
        if (index < 0) continue
        const range = document.createRange()
        range.setStart(walker.currentNode, index); range.setEnd(walker.currentNode, index + 3)
        const rect = range.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      throw new Error("未找到任务正文")
    })
    await page.mouse.move(textRect.x + 3, textRect.y + textRect.height / 2)
    await page.mouse.down()
    await page.mouse.move(textRect.x + textRect.width - 2, textRect.y + textRect.height / 2, { steps: 5 })
    await page.mouse.up()
    const selected = await inspectTasks(page)
    expect(selected.doc).toBe(doc)
    expect(selected.changes).toHaveLength(2)
    expect(selected.selection).not.toEqual({ ranges: [{ anchor: doc.length - 4, head: doc.length }], main: 0 })
  })

  test("中心勾选可撤销并在离线缓存重载后保留", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    const { editor } = await openTaskFixture(page)
    await editor.focus()
    const box = editor.locator(".cm-md-task-checkbox").first()
    await box.tap()
    await expect(box).toBeChecked()
    await page.keyboard.press("Meta+z")
    await expect(box).not.toBeChecked()
    expect((await inspectTasks(page)).doc).toBe(taskDoc)
    await box.tap()
    await expect(box).toBeChecked()
    await expect.poll(() => page.evaluate(async () => {
      const request = indexedDB.open("swell-note-vault-cache", 3)
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const read = db.transaction("documents", "readonly").objectStore("documents").get("e2e-vault\u0000webdav:/Swell/测试/第一篇.md")
      const entry = await new Promise<{ content?: string } | undefined>((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error) })
      db.close(); return entry?.content
    })).toContain("- [x] 未完成任务")
    await page.reload()
    await expect(page.locator(".note-editor:visible .cm-md-task-checkbox").first()).toBeChecked()
  })

  test("锁定阅读保持禁用且兼容阅读仍可勾选", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome")
    const { workspace } = await openTaskFixture(page)
    await workspace.getByRole("button", { name: "更多操作" }).click()
    await page.getByRole("menuitem", { name: "锁定为只读阅读", exact: true }).click()
    const locked = workspace.locator(".cm-md-task-checkbox").first()
    await expect(locked).toBeDisabled()
    const rect = (await locked.boundingBox())!
    await page.touchscreen.tap(rect.x + 7.5, rect.y + 7.5)
    await expect(locked).not.toBeChecked()
    expect((await inspectTasks(page)).doc).toBe(taskDoc)
    await useCompatibilityPreview(page)
    const preview = workspace.locator(".markdown-preview .task-checkbox").first()
    await preview.tap()
    await expect(preview).toBeChecked()
  })
})

test.describe("编辑会话连续性回归", () => {
  test.beforeEach(async ({ context }) => {
    await context.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname
      return ["127.0.0.1", "localhost"].includes(host) ? route.continue() : route.abort()
    })
  })
  const noteA = "第一篇正文"
  const noteB = "第二篇正文"
  const workspaceFor = (page: Page, mobile: boolean) => page.locator(mobile ? ".mobile-workspace:visible" : ".desktop-workspace:visible")
  const editorFor = (page: Page, mobile: boolean) => workspaceFor(page, mobile).locator(mobile ? ".mobile-edge-swipe-current .cm-content" : ".cm-content")

  async function openFixture(page: Page, mobile: boolean, content = noteA) {
    await seedCachedVault(page, content, false, noteB)
    if (mobile) {
      const workspace = workspaceFor(page, mobile)
      await workspace.getByText("测试", { exact: true }).first().click()
      await workspace.locator(".mobile-edge-swipe-current").getByText("第一篇", { exact: true }).first().click()
    }
    await expect(editorFor(page, mobile)).toBeVisible()
  }
  async function selectNote(page: Page, mobile: boolean, title: string) {
    if (mobile) {
      // 刷新详情页后返回上下文为全部笔记；两个入口都必须真正返回列表再点笔记。
      const back = page.getByRole("button", { name: /^返回(?:测试|全部笔记)$/ })
      if (await back.isVisible()) await back.click()
      await page.locator(".mobile-edge-swipe-current").getByText(title, { exact: true }).first().click()
    } else await page.locator(".note-list-panel").getByText(title, { exact: true }).first().click()
  }
  async function savedNote(page: Page, title = "第一篇") {
    return page.evaluate(async (title) => {
      const request = indexedDB.open("swell-note-vault-cache", 3)
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const read = db.transaction("documents", "readonly").objectStore("documents").get(`e2e-vault\u0000webdav:/Swell/测试/${title}.md`)
      const entry = await new Promise<{ content?: string } | undefined>((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error) })
      db.close(); return entry?.content
    }, title)
  }

  test("表格格式撤销重做后真实输入仍保存到原单元格", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome"
    const doc = "| 名称 | 备注 |\n| --- | --- |\n| 原文 | 说明 |\n\n后续正文"
    await openFixture(page, mobile, doc)
    const workspace = workspaceFor(page, mobile)
    const input = workspace.locator(".cm-md-table-cell-input:visible")
    await workspace.locator(".cm-md-table tbody td").first().click()
    await expect(input).toBeFocused()
    await input.evaluate(element => element.setSelectionRange(0, 2))
    await workspace.getByRole("button", { name: "加粗（⌘/Ctrl+B）", exact: true }).click()
    await expect.poll(() => savedNote(page)).toBe(doc.replace("| 原文 |", "| **原文** |"))
    await workspace.getByRole("button", { name: "撤销（⌘/Ctrl+Z）", exact: true }).click()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue("原文")
    await expect.poll(() => savedNote(page)).toBe(doc)
    if (mobile) {
      await workspace.getByRole("button", { name: "更多格式", exact: true }).click()
      await workspace.getByRole("menuitem", { name: "重做", exact: true }).click()
    } else await workspace.getByRole("button", { name: "重做（⌘/Ctrl+Shift+Z）", exact: true }).click()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue("**原文**")
    await workspace.getByRole("button", { name: "撤销（⌘/Ctrl+Z）", exact: true }).click()
    await expect(input).toBeFocused()
    expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([0, 2])
    await page.keyboard.type("x")
    await expect(input).toHaveValue("x")
    await page.keyboard.press("Tab")
    await expect(input).toBeFocused()
    await expect(input).toHaveValue("说明")
    await expect.poll(() => savedNote(page)).toBe(doc.replace("| 原文 |", "| x |"))
    await page.screenshot({ path: testInfo.outputPath("table-history-continued-input.png") })
  })

  test("缓存笔记真实返回与前进关闭旧标题菜单且新菜单正常格式化", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome"
    await openFixture(page, mobile)
    await selectNote(page, mobile, "第二篇")
    await expect(editorFor(page, mobile)).toHaveText(noteB)
    await selectNote(page, mobile, "第一篇")
    const heading = workspaceFor(page, mobile).getByRole("combobox", { name: "标题级别", exact: true })
    await heading.click()
    await expect(page.getByRole("option", { name: "二级标题", exact: true })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole("option", { name: "二级标题", exact: true })).toHaveCount(0)
    if (!mobile) await expect(editorFor(page, mobile)).toHaveText(noteB)
    await page.goForward()
    await expect(editorFor(page, mobile)).toHaveText(noteA)
    await heading.click()
    await page.getByRole("option", { name: "二级标题", exact: true }).click()
    await expect(editorFor(page, mobile)).toBeFocused()
    await expect.poll(() => savedNote(page)).toBe(`## ${noteA}`)
    expect(await savedNote(page, "第二篇")).toBe(noteB)
    await page.screenshot({ path: testInfo.outputPath("heading-history-owner.png") })
  })

  test("未缓存正文的历史目标关闭旧标题菜单且不改写任何正文", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome"
    await openFixture(page, mobile)
    await page.evaluate(async () => {
      const request = indexedDB.open("swell-note-vault-cache", 3)
      const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const tx = db.transaction(["documents", "vaults"], "readwrite")
      tx.objectStore("documents").delete("e2e-vault\u0000webdav:/Swell/测试/第二篇.md")
      const read = tx.objectStore("vaults").get("e2e-vault")
      read.onsuccess = () => {
        const vault = read.result
        vault.notes = vault.notes.map((note: { title: string; contentCached: boolean }) => note.title === "第二篇" ? { ...note, contentCached: false } : note)
        tx.objectStore("vaults").put(vault)
      }
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
      db.close()
    })
    await page.reload()
    await expect(editorFor(page, mobile)).toHaveText(noteA)
    await selectNote(page, mobile, "第二篇")
    await expect(workspaceFor(page, mobile).getByText("正文没有加载成功", { exact: true })).toBeVisible()
    await selectNote(page, mobile, "第一篇")
    await expect(editorFor(page, mobile)).toHaveText(noteA)
    await workspaceFor(page, mobile).getByRole("combobox", { name: "标题级别", exact: true }).click()
    await page.goBack()
    await expect(page.getByRole("option", { name: "二级标题", exact: true })).toHaveCount(0)
    if (mobile) await selectNote(page, mobile, "第二篇")
    await expect(workspaceFor(page, mobile).getByText("正文没有加载成功", { exact: true })).toBeVisible()
    expect(await savedNote(page)).toBe(noteA)
    expect(await savedNote(page, "第二篇")).toBeUndefined()
  })

  test("锁定只读关闭标题菜单且解锁后新菜单可用", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome"
    await openFixture(page, mobile)
    const workspace = workspaceFor(page, mobile)
    const heading = workspace.getByRole("combobox", { name: "标题级别", exact: true })
    await heading.click()
    await page.keyboard.press("Escape")
    await expect(heading).toBeFocused()
    await workspace.getByRole("button", { name: "更多操作", exact: true }).click()
    await page.getByRole("menuitem", { name: "锁定为只读阅读", exact: true }).click()
    await expect(heading).toHaveCount(0)
    await expect(editorFor(page, mobile)).toHaveAttribute("contenteditable", "false")
    expect(await savedNote(page)).toBe(noteA)
    await workspace.getByRole("button", { name: "更多操作", exact: true }).click()
    await page.getByRole("menuitem", { name: "解除锁定，继续编辑", exact: true }).click()
    await heading.click()
    await page.getByRole("option", { name: "二级标题", exact: true }).click()
    await expect.poll(() => savedNote(page)).toBe(`## ${noteA}`)
  })

  for (const target of ["cell", "control"] as const) {
    test(`格式重绘后新${target === "cell" ? "单元格" : "表格控件"}焦点不会被旧恢复抢回`, async ({ page }, testInfo) => {
      const mobile = testInfo.project.name === "mobile-chrome"
      const doc = "前文\n\n| H | J |\n| --- | --- |\n| abcdef | 说明 |\n| 第二项 | 其他 |\n\n后文"
      await openFixture(page, mobile, doc)
      const workspace = workspaceFor(page, mobile)
      const editor = editorFor(page, mobile)
      const input = workspace.locator(".cm-md-table-cell-input:visible")
      await workspace.locator(".cm-md-table tbody td").first().click()
      await input.evaluate(element => element.setSelectionRange(0, 6))
      // 精确放在新表格已绘制、旧 setTimeout 恢复尚未执行的窗口。
      await editor.evaluate((element, target) => {
        const probe: { acquired: boolean; observer?: MutationObserver } = { acquired: false }
        Object.assign(window, { __pendingTableFocusProbe: probe })
        probe.observer = new MutationObserver(() => {
          if (probe.acquired || !element.querySelector(".cm-md-table tbody tr")?.children[0].querySelector("strong")) return
          const cell = element.querySelectorAll(".cm-md-table tbody tr")[1]?.children[1]
          const control = element.querySelector<HTMLButtonElement>(".cm-md-table-width-toggle")
          if (target === "cell" && cell instanceof HTMLElement) {
            cell.click()
            probe.acquired = cell.contains(document.activeElement)
          } else if (target === "control" && control) {
            // 触屏工具条默认收起，先使用现有 grip 点击入口展开，确保实际取得焦点。
            element.querySelector<HTMLElement>(".cm-md-table-toolbar")?.click()
            control.focus()
            probe.acquired = document.activeElement === control
          }
        })
        probe.observer.observe(element, { subtree: true, childList: true })
      }, target)
      await workspace.getByRole("button", { name: "加粗（⌘/Ctrl+B）", exact: true }).click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { __pendingTableFocusProbe: { acquired: boolean } }).__pendingTableFocusProbe.acquired)).toBe(true)
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await page.evaluate(() => (window as unknown as { __pendingTableFocusProbe: { observer: MutationObserver } }).__pendingTableFocusProbe.observer.disconnect())
      if (target === "cell") {
        await expect(input).toBeFocused()
        await expect(input).toHaveValue("其他")
        await page.keyboard.type("Z")
        await page.keyboard.press("Tab")
        // 最后一格 Tab 的既有行为是新增空行；正文只在新目标格增加 Z。
        const expected = doc.replace("abcdef", "**abcdef**").replace("| 第二项 | 其他 |", "| 第二项 | 其他Z |\n|  |  |")
        await expect.poll(() => savedNote(page)).toBe(expected)
      } else {
        await expect(workspace.locator(".cm-md-table-width-toggle")).toBeFocused()
        await expect(input).toHaveCount(0)
        await page.keyboard.type("Z")
        await expect.poll(() => savedNote(page)).toBe(doc.replace("abcdef", "**abcdef**"))
      }
      await page.screenshot({ path: testInfo.outputPath(`new-${target}-focus-owner.png`) })
    })
  }
})
