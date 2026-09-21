import { expect, test, type Page } from "@playwright/test"

import { useCompatibilityPreview } from "./note-view-mode"

// 复制文本的两条自定义路径（阅读态菜单、表格选区浮层）的界面验证。
// 种子数据是独立的离线 vault，不触碰真实笔记。
const NOTE_CONTENT = [
  "# 标题",
  "",
  "第一段正文。",
  "",
  "```js",
  "const a = 1",
  "```",
  "",
  "| 名称 | 状态 |",
  "| --- | --- |",
  "| 苹果 | 新鲜 |",
  "",
  "结尾段。",
].join("\n")

async function seedNote(page: Page) {
  await page.goto("/#/notes")
  await page.evaluate(async (content) => {
    const cacheId = "e2e-copy-vault"
    const note = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/复制.md",
      preview: "复制验证",
      readOnly: false,
      remotePath: "/Swell/测试/复制.md",
      revision: '"c1"',
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title: "复制",
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
      label: "E2E 复制库",
      lastSyncedAt: Date.now(),
      notes: [note],
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
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
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, NOTE_CONTENT)
  await page.reload()
  await expect(page.locator(".note-editor:visible")).toBeVisible()
}

// 拦截剪贴板写入而不是读系统剪贴板：读取需要额外授权，且时序不稳；
// 这里只关心「写进去了什么」，直接记录参数最准确。
async function captureClipboardWrites(page: Page) {
  await page.addInitScript(() => {
    const writes: string[] = []
    Object.defineProperty(window, "__clipboardWrites", { configurable: true, value: writes })
    navigator.clipboard.writeText = (text: string) => { writes.push(text); return Promise.resolve() }
  })
}

test.describe("复制选区文本", () => {
  test("阅读态右键复制只带走正文，不含界面文字且表格保留制表符", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await captureClipboardWrites(page)
    await seedNote(page)
    await useCompatibilityPreview(page)

    const preview = page.locator(".note-editor:visible .markdown-preview")
    // 全选正文后右键：右键点在被选中文字内部，原生右键不会清掉已有选区。
    const range = await preview.boundingBox()
    if (!range) throw new Error("阅读态没有渲染出正文")
    await page.evaluate(() => {
      const content = document.querySelector(".note-editor:not([hidden]) .markdown-preview") ?? document.querySelector(".markdown-preview")
      if (!content) throw new Error("没有 .markdown-preview")
      const all = document.createRange()
      all.selectNodeContents(content)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(all)
    })
    await page.mouse.click(range.x + 8, range.y + 8, { button: "right" })
    await page.getByRole("menuitem", { name: "复制", exact: true }).click()

    const writes = await page.evaluate(() => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites)
    expect(writes).toHaveLength(1)
    const copied = writes[0]
    // 代码块的 js 语言名与「复制」按钮、表格的「左右滑动」提示都是 user-select:none 的界面文字。
    expect(copied).not.toContain("js复制")
    expect(copied).not.toContain("左右滑动")
    expect(copied).toContain("const a = 1")
    // Range.toString() 会把单元格之间的制表符吞掉，Selection.toString() 保留。
    expect(copied).toContain("名称\t状态")
    expect(copied).toContain("结尾段。")
  })

  test("剪贴板被拒时表格浮层复制退回临时输入框，不静默失败", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    // 拒绝授权，逼出回退路径：表格多格选区是 CSS class 画的、没有 DOM Range，
    // 默认的 "selection" 回退读不到任何选区会直接放弃；"text" 回退把文本写进临时输入框。
    await stubExecCommand(page, true)
    await seedNote(page)
    await selectTableRange(page)

    const floatbar = page.locator(".cm-md-table-floatbar")
    await expect(floatbar).toBeVisible()
    await floatbar.locator('[data-float-action="copy"]').click()

    await expect.poll(() => copiedByExecCommand(page)).toBe("名称\t状态\n苹果\t新鲜")
    // 复制成功就不该出现失败提示。
    await expect(floatbar.locator("[data-float-notice]")).toHaveCount(0)
  })

  test("两条写入路径都失败时表格浮层给出可见提示", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await stubExecCommand(page, false)
    await seedNote(page)
    await selectTableRange(page)

    const floatbar = page.locator(".cm-md-table-floatbar")
    await expect(floatbar).toBeVisible()
    await floatbar.locator('[data-float-action="copy"]').click()

    // 没有提示的话用户会以为复制成功了，粘出来的却是上一次的旧内容。
    await expect(floatbar.locator("[data-float-notice]")).toHaveText("复制失败")
  })

  test("右键菜单复制的失败提示同样可见", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    // 浮层与右键菜单是两条独立入口，浮层那条有回归不代表这条也有。
    await stubExecCommand(page, false)
    await seedNote(page)
    await selectTableRange(page)

    // 在选区内的单元格上右键，表格专属菜单才会带着「复制选中区域」出现。
    // 但多格选区上会有浮层贴在选区上方，正好压住菜单第一项、指针点不到。
    // 先在表格上方的正文空白处点一下解除多格选区（浮层随之收起），再右键——
    // 复制的失败反馈路径不变，仍然是「表格菜单 → copySelection → 写入失败」。
    await page.locator(".cm-content .cm-line", { hasText: "第一段正文。" }).first().click()
    await expect(page.locator(".cm-md-table-floatbar")).toHaveCount(0)

    const cell = page.locator(".cm-md-table td", { hasText: "新鲜" }).first()
    const box = (await cell.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" })
    await page.getByRole("menuitem", { name: "复制", exact: true }).click()
    // 页面上另有同步状态等 role="status"，按文案定位这一个。
    await expect(page.getByText("复制失败，请使用 ⌘/Ctrl+C")).toBeVisible()
  })
})

// 记录 execCommand("copy") 时临时输入框里的内容，并按 outcome 决定这次复制是否成功。
async function stubExecCommand(page: Page, outcome: boolean) {
  await page.addInitScript((succeed: boolean) => {
    const state = { text: null as string | null }
    Object.defineProperty(window, "__execCommandCopy", { configurable: true, value: state })
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("denied", "NotAllowedError"))
    const original = document.execCommand.bind(document)
    document.execCommand = (command: string) => {
      if (command !== "copy") return original(command)
      // copyExactText 的临时输入框是页面上唯一 left:-9999px 的 textarea。
      const area = Array.from(document.querySelectorAll("textarea")).find((node) => node.style.left === "-9999px")
      state.text = area?.value ?? null
      return succeed
    }
  }, outcome)
}

function copiedByExecCommand(page: Page) {
  return page.evaluate(() => (window as unknown as { __execCommandCopy: { text: string | null } }).__execCommandCopy.text)
}

// 从表头「名称」对角拖到正文「新鲜」，拉出 2×2 的多格选区并唤出浮层。
async function selectTableRange(page: Page) {
  const from = page.locator(".cm-md-table th", { hasText: "名称" }).first()
  const to = page.locator(".cm-md-table td", { hasText: "新鲜" }).first()
  await from.hover()
  await page.waitForTimeout(220)
  const fromBox = (await from.boundingBox())!
  const toBox = (await to.boundingBox())!
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 12 })
  await page.mouse.up()
}
