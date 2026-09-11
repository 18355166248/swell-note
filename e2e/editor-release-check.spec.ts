import { expect, test, type Page } from "@playwright/test"

// 编辑器三批修复（行内格式 / 表格 / 图片附件）的收尾验收：组合流程与异步边界。
// 种子是独立的离线 vault（IndexedDB），附件只写入本机附件队列，不触碰真实笔记与云同步。
// 「写入进行中」窗口用 File.prototype.arrayBuffer 的可控延迟制造，不用固定延时猜竞态。

const CACHE_ID = "e2e-release-vault"
const NOTE_A_ID = "webdav:/Swell/测试/验收甲.md"
const NOTE_B_ID = "webdav:/Swell/测试/验收乙.md"

const NOTE_A_CONTENT = [
  "# 验收甲",
  "",
  "开头段落。",
  "",
  "| 名称 | 状态 |",
  "| --- | --- |",
  "| 苹果 | 新鲜 |",
  "| 香蕉 | 一般 |",
  "",
  "结尾段落。",
].join("\n")
const NOTE_B_CONTENT = ["# 验收乙", "", "另一篇正文。"].join("\n")

// 1×1 PNG，附件内容本身不参与断言。
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

async function seedReleaseVault(page: Page) {
  // 附件写入延迟开关：>0 时每个文件的 arrayBuffer() 额外等待，模拟远端写入耗时。
  await page.addInitScript(() => {
    ;(window as unknown as { __attachmentDelay: number }).__attachmentDelay = 0
    const original = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = function () {
      const buffer = original.call(this)
      const delay = (window as unknown as { __attachmentDelay: number }).__attachmentDelay
      return delay > 0
        ? buffer.then((data) => new Promise<ArrayBuffer>((resolve) => setTimeout(() => resolve(data), delay)))
        : buffer
    }
  })
  await page.goto("/#/notes")
  await page.evaluate(async ([cacheId, noteAId, noteBId, contentA, contentB]) => {
    const noteA = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: noteAId,
      preview: "验收甲摘要",
      readOnly: false,
      remotePath: "/Swell/测试/验收甲.md",
      revision: '"a1"',
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title: "验收甲",
      updatedAt: "刚刚",
    }
    const noteB = {
      ...noteA,
      id: noteBId,
      preview: "验收乙摘要",
      remotePath: "/Swell/测试/验收乙.md",
      revision: '"b1"',
      title: "验收乙",
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
      label: "E2E 验收库",
      lastSyncedAt: Date.now(),
      notes: [noteA, noteB],
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    for (const [note, content] of [[noteA, contentA], [noteB, contentB]] as const) {
      transaction.objectStore("documents").put({
        baseContent: content,
        cacheId,
        content,
        // 与 vault-cache.documentKey 一致：cacheId 与 noteId 之间是 NUL 分隔符。
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
    localStorage.setItem("swell-note:webdav-config:v1", JSON.stringify({
      provider: "jianguoyun",
      remotePath: "/Swell/",
      serverUrl: "https://dav.jianguoyun.com/dav/",
      username: "e2e@example.com",
    }))
  }, [CACHE_ID, NOTE_A_ID, NOTE_B_ID, NOTE_A_CONTENT, NOTE_B_CONTENT])
  await page.reload()
  // 默认阅读模式打开活动笔记；进入编辑由各用例显式点击「编辑模式」。
  await expect(page.getByRole("button", { name: "编辑模式" })).toBeVisible({ timeout: 15_000 })
}

async function setAttachmentDelay(page: Page, ms: number) {
  await page.evaluate((value) => {
    ;(window as unknown as { __attachmentDelay: number }).__attachmentDelay = value
  }, ms)
}

// 正文的唯一权威来源：编辑器 onChange → 离线快照防抖（450ms）后落入 documents store。
async function readStored(page: Page, noteId: string): Promise<string> {
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
  }, [CACHE_ID, noteId])
}

async function waitStored(page: Page, noteId: string, predicate: (content: string) => boolean, timeout = 10_000) {
  await expect.poll(async () => predicate(await readStored(page, noteId)), { timeout }).toBe(true)
}

async function insertImages(page: Page, names: string[]) {
  // 导入 Markdown 的输入框与附件输入框共用同一个样式类，必须限定在格式工具栏内。
  await page.locator(".formatting-toolbar input.attachment-file-input").first().setInputFiles(
    names.map((name) => ({ buffer: PNG_BUFFER, mimeType: "image/png", name })),
  )
}

function imageRefPattern(name: string) {
  return new RegExp(`!\\[${name.replace(".", "\\.")}\\]\\([^)]*attachments/[^)]*\\)`)
}

// 附件 URL 本身包含文件名，按纯文本出现次数会把同一引用的 alt 与 URL 算成两次；
// 判断「插入几次」必须数引用个数。
function countImageRefsOf(content: string, name: string) {
  return (content.match(new RegExp(imageRefPattern(name).source, "g")) ?? []).length
}

function countImageRefs(content: string) {
  return (content.match(/!\[[^\]]*\]\([^)]*attachments\/[^)]*\)/g) ?? []).length
}

async function clickLine(page: Page, text: string) {
  await page.locator(".cm-line", { hasText: text }).first().click()
}

function cellDisplay(page: Page, text: string) {
  return page.locator(".cm-md-table td", { hasText: text }).first()
}

async function openNoteFromList(page: Page, title: string) {
  await page.locator(".note-list-panel").getByText(title, { exact: true }).first().click()
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 15_000 })
}

test.describe("编辑器三批修复收尾验收", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "本轮验收只声明桌面端覆盖")

  test("流程1：输入→加粗/斜体→插表格→填单元格→插图，逐步撤销与重做", async ({ page }) => {
    test.setTimeout(120_000)
    await seedReleaseVault(page)
    await page.getByRole("button", { name: "编辑模式" }).click()

    const snapshots: string[] = [await readStored(page, NOTE_A_ID)]
    // 有意义的用户操作（输入/格式/表格/单元格/图片）必须在撤销链上逐站经过；
    // 纯空白的中间态只登记为已知状态，历史分组的粗细允许跳过它们。
    const required = new Set<number>([0])
    const capture = async (predicate: (content: string) => boolean, meaningful = true) => {
      await waitStored(page, NOTE_A_ID, predicate)
      snapshots.push(await readStored(page, NOTE_A_ID))
      if (meaningful) required.add(snapshots.length - 1)
    }

    // 1) 正文输入（换行的历史分组粗细由编辑器决定，空白中间态登记为非必需快照）
    await clickLine(page, "结尾段落。")
    await page.keyboard.press("End")
    await page.keyboard.press("Enter")
    await capture((content) => content === `${snapshots[snapshots.length - 1]}\n`, false)
    await page.keyboard.press("Enter")
    await capture((content) => content === `${snapshots[snapshots.length - 1]}\n`, false)
    await page.keyboard.type("新增一句")
    await capture((content) => content.includes("新增一句"))

    // 2) 加粗 → 斜体（选区保留，第二次格式仍作用于原文字）
    await page.keyboard.press("Shift+Home")
    await page.getByRole("button", { name: "加粗（⌘/Ctrl+B）" }).click()
    await capture((content) => content.includes("**新增一句**"))
    await page.getByRole("button", { name: "斜体（⌘/Ctrl+I）" }).click()
    await capture((content) => content.includes("***新增一句***"))

    // 3) 插入表格（光标先到行尾并空出段落）
    await page.keyboard.press("End")
    await page.keyboard.press("Enter")
    await capture((content) => content === `${snapshots[snapshots.length - 1]}\n`, false)
    await page.keyboard.press("Enter")
    await capture((content) => content === `${snapshots[snapshots.length - 1]}\n`, false)
    await page.getByRole("button", { name: "表格", exact: true }).click()
    await capture((content) => content.includes("| 列 1 | 列 2 |"))

    // 4) 填写单元格（Tab 提交，避免末行 Enter 自动补行干扰快照）
    const newTable = page.locator(".cm-md-table-wrap", { hasText: "列 1" })
    await newTable.locator("td", { hasText: "内容" }).first().click()
    await page.keyboard.press("ControlOrMeta+a")
    await page.keyboard.type("单元值")
    await page.keyboard.press("Tab")
    await capture((content) => content.includes("单元值"))

    // 5) 插入图片（单元格编辑中：先提交单元格，图片落在表格之后）
    await insertImages(page, ["流程一.png"])
    await capture((content) => imageRefPattern("流程一.png").test(content))

    // 逐步撤销：每次点击必须落在一个已知快照上且严格后退（不跳变、不丢内容），
    // 直到回到初始快照；有意义的操作一站都不能少，纯空白中间态允许被历史分组跳过。
    const visitedRequired = new Set<number>()
    const undoButton = page.getByRole("button", { name: "撤销（⌘/Ctrl+Z）" })
    let index = snapshots.length - 1
    if (required.has(index)) visitedRequired.add(index)
    while (index > 0) {
      const before = await readStored(page, NOTE_A_ID)
      await undoButton.click()
      await waitStored(page, NOTE_A_ID, (content) => content !== before)
      const current = await readStored(page, NOTE_A_ID)
      const landed = snapshots.indexOf(current)
      expect(landed, `撤销后必须落在已知快照上，得到：${JSON.stringify(current)}`).toBeGreaterThanOrEqual(0)
      expect(landed, "撤销必须严格后退，不能跳到更晚的状态").toBeLessThan(index)
      index = landed
      if (required.has(index)) visitedRequired.add(index)
    }
    expect(visitedRequired, "每个有意义的操作都必须出现在撤销链上").toEqual(required)

    // 逐步重做：同样严格前进，最终回到最后一个快照。
    visitedRequired.clear()
    const redoButton = page.getByRole("button", { name: "重做（⌘/Ctrl+Shift+Z）" })
    while (index < snapshots.length - 1) {
      const before = await readStored(page, NOTE_A_ID)
      await redoButton.click()
      await waitStored(page, NOTE_A_ID, (content) => content !== before)
      const current = await readStored(page, NOTE_A_ID)
      const landed = snapshots.indexOf(current)
      expect(landed, `重做后必须落在已知快照上，得到：${JSON.stringify(current)}`).toBeGreaterThanOrEqual(0)
      expect(landed, "重做必须严格前进，不能退回更早的状态").toBeGreaterThan(index)
      index = landed
      if (required.has(index)) visitedRequired.add(index)
    }
    expect(visitedRequired, "每个有意义的操作都必须出现在重做链上").toEqual(new Set([...required].filter((i) => i > 0)))
  })

  test("流程2：单元格编辑→多格粘贴→正文续写→插附件→返回表格继续编辑", async ({ page }) => {
    test.setTimeout(60_000)
    await seedReleaseVault(page)
    await page.getByRole("button", { name: "编辑模式" }).click()

    // 单元格编辑：苹果 → 苹果大
    await cellDisplay(page, "苹果").click()
    await page.keyboard.press("End")
    await page.keyboard.type("大")
    await page.keyboard.press("Enter")
    await waitStored(page, NOTE_A_ID, (content) => content.includes("苹果大"))

    // 多格粘贴：拖选 2×2 选区后粘 TSV（选区持焦，焦点在表格 wrapper）
    const fromCell = cellDisplay(page, "苹果大")
    await fromCell.hover()
    await page.waitForTimeout(220)
    const from = (await fromCell.boundingBox())!
    const to = (await cellDisplay(page, "一般").boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect(page.locator(".cm-md-table-cell-in-range")).toHaveCount(4)
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData("text/plain", "虎\t狮\n狼\t豹")
      document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }))
    })
    await waitStored(page, NOTE_A_ID, (content) =>
      content.includes("| 虎 | 狮 |") && content.includes("| 狼 | 豹 |"))

    // 正文续写
    await clickLine(page, "结尾段落。")
    await page.keyboard.press("End")
    await page.keyboard.type("续写")
    await waitStored(page, NOTE_A_ID, (content) => content.includes("结尾段落。续写"))

    // 插入附件（非图片也走同一写入链路；这里仍用图片名便于渲染检查）
    await insertImages(page, ["流程二.png"])
    await waitStored(page, NOTE_A_ID, (content) => imageRefPattern("流程二.png").test(content))

    // 返回表格继续编辑：此前粘贴的数据仍可改、提交生效
    await cellDisplay(page, "虎").click()
    await page.keyboard.press("End")
    await page.keyboard.type("王")
    await page.keyboard.press("Enter")
    await waitStored(page, NOTE_A_ID, (content) => content.includes("虎王"))

    const final = await readStored(page, NOTE_A_ID)
    expect(final).toContain("| 虎王 | 狮 |")
    expect(final).toContain("| 狼 | 豹 |")
    expect(final).toContain("结尾段落。续写")
    expect(countImageRefs(final)).toBe(1)
  })

  test("流程3：附件写入中移动光标续写，完成时不抢焦点与选区", async ({ page }) => {
    test.setTimeout(60_000)
    await seedReleaseVault(page)
    await page.getByRole("button", { name: "编辑模式" }).click()

    await setAttachmentDelay(page, 900)
    await clickLine(page, "开头段落。")
    await page.keyboard.press("End")
    await insertImages(page, ["流程三.png"])

    // 写入进行中：把光标移到别的段落继续写作。
    await clickLine(page, "结尾段落。")
    await page.keyboard.press("End")
    await page.keyboard.type("续写ABC")

    // 写入完成后立刻继续输入：焦点若被抢回插入点，DEF 会落在图片后面。
    await waitStored(page, NOTE_A_ID, (content) => imageRefPattern("流程三.png").test(content))
    await page.keyboard.type("DEF")
    await waitStored(page, NOTE_A_ID, (content) => content.includes("续写ABCDEF"))

    const final = await readStored(page, NOTE_A_ID)
    const imageIndex = final.search(imageRefPattern("流程三.png"))
    // 图片落在原插入点（开头段落之后、表格之前），不跟随光标跑。
    expect(imageIndex).toBeGreaterThan(final.indexOf("开头段落。"))
    expect(imageIndex).toBeLessThan(final.indexOf("| 名称 | 状态 |"))
    // 续写文字在结尾段落上连续，证明完成瞬间没有移动选区。
    expect(final).toContain("结尾段落。续写ABCDEF")
    expect(countImageRefs(final)).toBe(1)
  })

  test("流程4：附件写入中切到另一篇笔记，回退追加归属原笔记且有反馈", async ({ page }) => {
    test.setTimeout(60_000)
    await seedReleaseVault(page)
    await page.getByRole("button", { name: "编辑模式" }).click()

    await setAttachmentDelay(page, 900)
    await clickLine(page, "开头段落。")
    await page.keyboard.press("End")
    await insertImages(page, ["流程四.png"])

    // 写入进行中切到验收乙。
    await openNoteFromList(page, "验收乙")
    await setAttachmentDelay(page, 0)

    // 回退追加有明确反馈，不伪装成在原位成功；提示挂在跨笔记切换存活的库级横幅上。
    await expect(page.locator("p.vault-error")).toContainText("末尾", { timeout: 15_000 })

    // 原笔记末尾追加（与正文之间有空行）；另一篇笔记零改动。
    await waitStored(page, NOTE_A_ID, (content) => imageRefPattern("流程四.png").test(content))
    const contentA = await readStored(page, NOTE_A_ID)
    expect(contentA.startsWith(NOTE_A_CONTENT)).toBe(true)
    expect(contentA).toMatch(/结尾段落。\n\n!\[流程四\.png\]/)
    expect(await readStored(page, NOTE_B_ID)).toBe(NOTE_B_CONTENT)

    // 回到原笔记：内容一致，追加不进入撤销栈（撤销按钮不可用，不会撤掉别的东西）。
    await openNoteFromList(page, "验收甲")
    await page.getByRole("button", { name: "编辑模式" }).click()
    await expect(page.getByRole("button", { name: "撤销（⌘/Ctrl+Z）" })).toBeDisabled()
    expect(countImageRefs(await readStored(page, NOTE_A_ID))).toBe(1)
  })

  test("流程5：附件写入中切阅读模式，回退追加后编辑/阅读内容一致", async ({ page }) => {
    test.setTimeout(60_000)
    await seedReleaseVault(page)
    await page.getByRole("button", { name: "编辑模式" }).click()

    await setAttachmentDelay(page, 900)
    await clickLine(page, "开头段落。")
    await page.keyboard.press("End")
    await insertImages(page, ["流程五.png"])

    // 写入进行中切阅读模式：编辑器卸载，落笔回退为追加到末尾。
    await page.getByRole("button", { name: "阅读模式" }).click()
    await expect(page.locator(".markdown-preview")).toBeVisible()
    await setAttachmentDelay(page, 0)

    await expect(page.locator("p.vault-error")).toContainText("末尾", { timeout: 15_000 })
    await waitStored(page, NOTE_A_ID, (content) => imageRefPattern("流程五.png").test(content))
    const stored = await readStored(page, NOTE_A_ID)
    expect(stored).toMatch(/结尾段落。\n\n!\[流程五\.png\]/)

    // 阅读态渲染与编辑态内容一致：引用在末尾，图片可从本机附件队列解析显示。
    // img 是替换元素，alt 不进入 textContent，顺序断言以存储内容为准、渲染以 img 元素为准。
    const preview = page.locator(".markdown-preview")
    await expect(preview.locator("img").last()).toBeVisible()
    await expect(preview.locator("img").last()).toHaveAttribute("alt", "流程五.png")

    // 切回编辑：内容不变，编辑/阅读两态一致。
    await page.getByRole("button", { name: "编辑模式" }).click()
    await expect(page.locator(".cm-content")).toBeVisible()
    expect(await readStored(page, NOTE_A_ID)).toBe(stored)
  })

  test("流程6：附件写入中删除插入位置所在段落，完成后内容不丢不重", async ({ page }) => {
    test.setTimeout(60_000)
    await seedReleaseVault(page)
    await page.getByRole("button", { name: "编辑模式" }).click()

    await setAttachmentDelay(page, 900)
    await clickLine(page, "开头段落。")
    await page.keyboard.press("End")
    await insertImages(page, ["流程六.png"])

    // 写入进行中：删掉插入点所在的段落文字（书签随事务映射到删除点）。
    await clickLine(page, "开头段落。")
    await page.keyboard.press("Home")
    await page.keyboard.press("Shift+End")
    await page.keyboard.press("Backspace")

    await waitStored(page, NOTE_A_ID, (content) => imageRefPattern("流程六.png").test(content))
    const final = await readStored(page, NOTE_A_ID)
    // 用户主动删除的段落文字不回填；其余内容与表格结构完整；图片只插一次。
    expect(final).not.toContain("开头段落。")
    expect(final).toContain("| 苹果 | 新鲜 |")
    expect(final).toContain("结尾段落。")
    expect(countImageRefs(final)).toBe(1)
    // 图片落在删除点（表格之前），不会被并进表格。
    expect(final.search(imageRefPattern("流程六.png"))).toBeLessThan(final.indexOf("| 名称 | 状态 |"))
  })

  test("流程7：busy 守卫拒绝第二批并提示，第一批结束后可重试且不重复插入", async ({ page }) => {
    test.setTimeout(60_000)
    await seedReleaseVault(page)
    await page.getByRole("button", { name: "编辑模式" }).click()

    await setAttachmentDelay(page, 900)
    await clickLine(page, "结尾段落。")
    await page.keyboard.press("End")
    await insertImages(page, ["流程七甲.png"])
    // 写入进行中发起第二批：被守卫拒绝并给出提示。
    await insertImages(page, ["流程七乙.png"])
    await expect(page.locator("p.attachment-error")).toContainText("上一批附件仍在写入")

    // 第一批完成：只有第一批的引用，第二批没有被静默插入。
    await waitStored(page, NOTE_A_ID, (content) => imageRefPattern("流程七甲.png").test(content))
    let current = await readStored(page, NOTE_A_ID)
    expect(current).not.toContain("流程七乙")
    expect(countImageRefs(current)).toBe(1)

    // 结束后重试第二批：正常插入，两个引用各出现一次。
    await setAttachmentDelay(page, 0)
    await insertImages(page, ["流程七乙.png"])
    await waitStored(page, NOTE_A_ID, (content) => imageRefPattern("流程七乙.png").test(content))
    current = await readStored(page, NOTE_A_ID)
    expect(countImageRefs(current)).toBe(2)
    expect(countImageRefsOf(current, "流程七甲.png")).toBe(1)
    expect(countImageRefsOf(current, "流程七乙.png")).toBe(1)
  })

  test("流程8：正文、表格、图片修改保存后，刷新完整恢复内容与引用", async ({ page }) => {
    test.setTimeout(60_000)
    await seedReleaseVault(page)
    await page.getByRole("button", { name: "编辑模式" }).click()

    await clickLine(page, "结尾段落。")
    await page.keyboard.press("End")
    await page.keyboard.type("刷新前修改")
    await cellDisplay(page, "香蕉").click()
    await page.keyboard.press("End")
    await page.keyboard.type("甜")
    await page.keyboard.press("Enter")
    await insertImages(page, ["流程八.png"])

    // 等离线快照落盘（这就是本地保存），记录保存后的权威内容。
    await waitStored(page, NOTE_A_ID, (content) =>
      content.includes("刷新前修改")
      && content.includes("香蕉甜")
      && imageRefPattern("流程八.png").test(content))
    const saved = await readStored(page, NOTE_A_ID)

    await page.reload()
    // 显示模式是全局偏好，刷新后保持刷新前的编辑模式；这里显式切回阅读模式再断言。
    await page.getByRole("button", { name: "阅读模式" }).click()
    const preview = page.locator(".markdown-preview")
    await expect(preview).toBeVisible({ timeout: 15_000 })
    await expect(preview).toContainText("结尾段落。刷新前修改")
    await expect(preview.locator(".cm-md-table, table")).toContainText("香蕉甜")
    await expect(preview.locator("img").last()).toBeVisible()
    expect(await readStored(page, NOTE_A_ID)).toBe(saved)

    // 切回编辑模式：内容与保存时逐字符一致。
    await page.getByRole("button", { name: "编辑模式" }).click()
    await expect(page.locator(".cm-content")).toBeVisible()
    expect(await readStored(page, NOTE_A_ID)).toBe(saved)
  })
})
