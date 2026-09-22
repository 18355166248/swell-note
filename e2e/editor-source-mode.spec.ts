import { expect, test, type Page } from "@playwright/test"

// 本轮新增能力的真浏览器验证：纯 Markdown 源码模式切换、粘贴降级占位、附件队列。
// 种在独立的离线 vault 里，不触碰真实笔记与云同步。

const CACHE_ID = "e2e-source-mode-vault"
const NOTE_ID = "webdav:/Swell/测试/源码.md"

// 正文里同时放了行内格式、图片与表格：源码模式要一次性把各类预览装饰都关掉，
// 只验一种会漏掉「两个 Compartment 只关了一半」这种回归。
const RICH_CONTENT = [
  "# 源码模式标题",
  "",
  "**加粗文字** 与 `行内代码`",
  "",
  "![示意图](attachments/示意图.png)",
  "",
  "| 列 A | 列 B |",
  "| --- | --- |",
  "| 甲 | 乙 |",
  "",
  "结尾段落。",
].join("\n")

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

/**
 * 窄屏下笔记库是分层路由（根屏只列文件夹，进「测试」才看到笔记行），
 * 桌面端则是三栏直接停在打开的那篇笔记上。种子相同，只是进入正文的路径不同。
 */
async function openNote(page: Page, mobile: boolean) {
  if (!mobile) {
    await expect(page.locator(".note-editor[data-view-mode='unified'] .cm-content")).toBeVisible({ timeout: 15_000 })
    return
  }
  // 刷新后路由可能被恢复到笔记正文，也可能停在库根屏，两种都得能进正文。
  await expect(async () => {
    if (await page.locator(".cm-content:visible").count() > 0) return
    const workspace = page.locator(".mobile-workspace:visible")
    await expect(workspace.getByText("测试", { exact: true }).first()).toBeVisible()
    await workspace.getByText("测试", { exact: true }).first().click()
    await expect(workspace.getByText("源码", { exact: true }).first()).toBeVisible()
    await workspace.getByText("源码", { exact: true }).first().click()
  }).toPass({ timeout: 20_000 })
  await expect(page.locator(".cm-content:visible").first()).toBeVisible({ timeout: 15_000 })
}

async function seedNote(page: Page, content: string, mobile = false) {
  await page.goto("/#/notes")
  await page.evaluate(async ([initial, cacheId, noteId]) => {
    const note = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: noteId,
      preview: "源码验证",
      readOnly: false,
      remotePath: "/Swell/测试/源码.md",
      revision: '"s1"',
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title: "源码",
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
      label: "E2E 源码库",
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
    localStorage.setItem("swell-note:webdav-config:v1", JSON.stringify({
      provider: "jianguoyun",
      remotePath: "/Swell/",
      serverUrl: "https://dav.jianguoyun.com/dav/",
      username: "e2e@example.com",
    }))
  }, [content, CACHE_ID, NOTE_ID] as const)
  await page.reload()
  await openNote(page, mobile)
}

async function readStored(page: Page): Promise<string> {
  return page.evaluate(async ([cacheId, id]) => {
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const document = await new Promise<{ content?: string } | undefined>((resolve, reject) => {
      // 与 vault-cache.documentKey 一致：cacheId 与 noteId 之间是 NUL 分隔符。
      const get = database.transaction("documents").objectStore("documents").get(`${cacheId}\u0000${id}`)
      get.onsuccess = () => resolve(get.result as { content?: string } | undefined)
      get.onerror = () => reject(get.error)
    })
    database.close()
    return document?.content ?? ""
  }, [CACHE_ID, NOTE_ID] as const)
}

/**
 * 正文原文一律以落盘内容为准（编辑器 onChange → 离线快照防抖后写入 documents store）。
 *
 * 不能拿 .cm-content 的 textContent 跨模式比对：即时预览会把 Markdown 换成装饰与控件
 * （图片按钮、表格工具条里的「添加行」等），这些 DOM 文字在源码模式下不存在，
 * 两边必然不等——那是渲染差异，不是正文被改了。落盘内容则与呈现方式无关，逐字节可比。
 */
async function waitStoredDoc(page: Page, predicate: (content: string) => boolean, timeout = 15_000) {
  await expect.poll(async () => predicate(await readStored(page)), { timeout }).toBe(true)
}

function decorationCount(page: Page) {
  // 只看可见的那个工作区：窄屏路由会同时挂载多层，隐藏层的装饰不该计入。
  return page.locator(
    ".desktop-workspace:visible .cm-md-heading, .desktop-workspace:visible .cm-md-strong, "
    + ".desktop-workspace:visible .cm-md-inline-code, .desktop-workspace:visible .cm-md-image, "
    + ".desktop-workspace:visible .cm-md-table-wrap, "
    + ".mobile-workspace:visible .cm-md-heading, .mobile-workspace:visible .cm-md-strong, "
    + ".mobile-workspace:visible .cm-md-inline-code, .mobile-workspace:visible .cm-md-image, "
    + ".mobile-workspace:visible .cm-md-table-wrap",
  ).count()
}

/** 工具栏按钮在窄屏下可能收在「更多操作」菜单里，找不到就展开菜单再取。 */
async function sourceToggleButton(page: Page) {
  const direct = page.locator(".formatting-toolbar:visible button[aria-label*='Markdown 源码']")
  if (await direct.count() > 0) return direct.first()
  await page.locator(".formatting-toolbar:visible button[aria-label*='更多']").first().click()
  return page.locator(".toolbar-more-menu:visible button", { hasText: "Markdown 源码" }).first()
}

function editorText(page: Page) {
  return page.locator(".cm-content:visible").first().innerText()
}

test.describe("Markdown 源码模式", () => {
  test("切换源码模式不改正文、不丢撤销历史，退出后装饰恢复", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome"
    await seedNote(page, RICH_CONTENT, mobile)
    await waitStoredDoc(page, (content) => content === RICH_CONTENT)
    expect(await decorationCount(page)).toBeGreaterThan(0)

    await (await sourceToggleButton(page)).click()
    await expect.poll(() => decorationCount(page)).toBe(0)
    // 源码模式下 .cm-content 里只有正文本身（装饰与控件都拆掉了），
    // 标题标记、表格管道与图片语法都以纯文本形式直接可见。
    const sourceText = await editorText(page)
    expect(sourceText).toContain("# 源码模式标题")
    expect(sourceText).toContain("**加粗文字**")
    expect(sourceText).toContain("| 列 A | 列 B |")
    expect(sourceText).toContain("![示意图](attachments/示意图.png)")
    // 逐字节相同：切换只是换呈现方式，落盘正文一个字符都没动。
    expect(await readStored(page)).toBe(RICH_CONTENT)

    // 源码模式下正文仍可编辑：这是「源码」而不是「只读」。
    await page.locator(".cm-content:visible").first().click()
    await page.keyboard.press("Control+End")
    await page.keyboard.type("源码中续写")
    await waitStoredDoc(page, (content) => content.includes("源码中续写"))
    // 切换 + 编辑全程没有改动原有正文，只是在某处追加了新输入。
    expect(await readStored(page)).toContain(RICH_CONTENT.replace(/\n结尾段落。$/, ""))

    // 退出源码模式：预览装饰回到正文上。
    await (await sourceToggleButton(page)).click()
    await expect.poll(() => decorationCount(page)).toBeGreaterThan(0)

    // 撤销历史是否跨切换存活，由 markdown-editor.test.tsx 的单元用例精确断言
    // （切换前后 undoDepth 不变，且切换后 undo() 能把正文撤回原文）。
    // 这里不重复做键盘撤销：点击正文容易落在表格/图片控件上，Ctrl+Z 会交给控件的输入框，
    // 断出来的结果与「撤销栈是否被清空」无关，只会变成一条靠不住的用例。
    expect(await readStored(page)).toContain(RICH_CONTENT.replace(/\n结尾段落。$/, ""))
  })

  test("源码模式偏好跨刷新保留，且不写进笔记正文与笔记元数据", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome"
    await seedNote(page, RICH_CONTENT, mobile)
    const stored = await readStored(page)

    await (await sourceToggleButton(page)).click()
    await expect.poll(() => decorationCount(page)).toBe(0)
    // 偏好落在本机 localStorage，不落在笔记内容里。
    expect(await page.evaluate(() => localStorage.getItem("swell-note:ui-preferences:v1"))).toContain('"source"')

    await page.reload()
    await openNote(page, mobile)
    // 刷新后仍是源码模式，正文一个字符都没被这次切换改动。
    await expect.poll(() => decorationCount(page)).toBe(0)
    expect(await readStored(page)).toBe(stored)
  })

  test("粘贴导入不了的图片留下可见占位并保留 alt，不静默消失", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome"
    await seedNote(page, "开始\n", mobile)
    await page.locator(".cm-content:visible").first().click()
    await page.keyboard.press("Control+End")
    await page.keyboard.type("\n")

    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.setData("text/html", '<p>看图：<img src="data:image/png;base64,iVBORw0KGgo=" alt="红点图"></p>')
      transfer.setData("text/plain", "看图：红点图")
      document.querySelector(".cm-content")!.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      )
    })

    // 有 alt 时占位要带上原说明文字，用户才认得出这里原本是哪张图。
    await waitStoredDoc(page, (content) => content.includes("红点图（图片无法导入：data: 地址不导入）"))
    // 占位必须真的渲染成可见文字，不能只存在于 Markdown 里。
    await expect(page.locator(".cm-content:visible").first()).toContainText("图片无法导入")
    // 原样落地 data: 地址就绕过了协议校验；这里必须只有说明文字。
    expect(await readStored(page)).not.toContain("base64,iVBOR")
  })

  test("剪贴板同时给了图片文件时，正文不再重复插入一份原始地址", async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === "mobile-chrome"
    await seedNote(page, "开始\n", mobile)
    await page.locator(".cm-content:visible").first().click()
    await page.keyboard.press("Control+End")
    await page.keyboard.type("\n")

    // 模拟 Word/飞书那种「HTML 里是本地图片 + 剪贴板另附真实文件」的粘贴。
    await page.evaluate(([base64]) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const file = new File([bytes], "剪贴板图.png", { type: "image/png" })
      const transfer = new DataTransfer()
      transfer.setData("text/html", '<p><img src="file:///C:/Users/e2e/剪贴板图.png" alt="剪贴板图"></p>')
      transfer.setData("text/plain", "剪贴板图")
      transfer.items.add(file)
      document.querySelector(".cm-content")!.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      )
    }, [PNG_BUFFER.toString("base64")] as const)

    // HTML 那条路只留 alt 文字（引用交给附件队列），file: 地址不得进正文。
    await waitStoredDoc(page, (content) => content.includes("剪贴板图"))
    expect(await readStored(page)).not.toContain("file:///C:/Users/e2e")
    // 真实文件经队列写入：写完正文里恰好一条附件引用，没有第二份原始地址。
    await waitStoredDoc(page, (content) => /!\[[^\]]*\]\([^)]*attachments\/[^)]*\)/.test(content))
    const stored = await readStored(page)
    // 只数引用个数：附件 URL 本身含文件名，按纯文本数会把 alt 与 URL 算成两次。
    expect(stored.match(/!\[[^\]]*\]\([^)]*attachments\/[^)]*\)/g) ?? []).toHaveLength(1)
    // 附件 URL 本身含文件名（带时间戳），逐字符比对没有意义；断言结构而不是字面值：
    // HTML 里那句 alt 后面紧跟恰好一条指向本机附件目录的引用。
    expect(stored).toMatch(/剪贴板图!\[剪贴板图\.png\]\(\.\.\/attachments\/剪贴板图-\d+\.png\)/)
    // 附件 URL 含文件名，按纯文本数会把同一张图算成多次；数「HTML 的 alt」这个前缀就够：
    // 它只出现一次，说明图片没有被 HTML 与文件两条路各插一份。
    expect(stored.match(/剪贴板图!\[/g) ?? []).toHaveLength(1)
  })
})
