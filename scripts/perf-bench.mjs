// 交互性能基准：量的是主线程阻塞（长任务），不是墙钟耗时。
//
// 用法：
//   pnpm build && pnpm preview --port 4173 --strictPort   # 另开一个终端
//   pnpm bench:interaction                                # 默认 6 倍 CPU 节流、400 篇笔记
//   CPU=1 NOTES=2000 pnpm bench:interaction               # 不节流、更大的库
//
// 几条踩过坑的前提，改动这个脚本前先读：
// - 必须跑生产构建。开发模式下 StrictMode 会双渲染，把每次按键放大到几十毫秒，结论会完全跑偏。
// - 必须是前台可见的浏览器窗口。后台标签页会把任务堆积成假的长任务，同一份代码能从 0 波动到 300ms 以上。
// - Mac 上不节流几乎测不出问题（全是 0）。这个项目主要跑在手机上，CPU=6 才接近真机手感。
import { chromium } from "@playwright/test"

const NOTE_COUNT = Number(process.env.NOTES ?? 400)
const CPU_THROTTLE = Number(process.env.CPU ?? 6)
const PORT = Number(process.env.PORT ?? 4173)
const TARGET = `http://localhost:${PORT}/#/notes`

// 第一篇故意造成长笔记，用来量长文档的编辑手感；其余带表格与代码块，覆盖装饰的主要分支。
function buildNotes(count) {
  const folders = ["产品", "产品/需求", "技术", "技术/前端", "随笔"]
  const kinds = ["会议纪要", "设计草稿", "接口约定", "问题排查", "读书笔记", "周报"]
  const filler = "内容填充，用于把正文撑到接近真实笔记的体量。".repeat(60)
  const notes = []
  for (let index = 0; index < count; index += 1) {
    const folder = folders[index % folders.length]
    const title = `笔记 ${String(index + 1).padStart(4, "0")} ${kinds[index % kinds.length]}`
    const path = `/Swell/${folder}/${title}.md`
    const content = index === 0
      ? `# ${title}\n\n${Array.from({ length: 600 }, (_, section) =>
          `## 小节 ${section + 1}\n\n这一段是第 ${section + 1} 段正文，包含 [一个链接](./其他笔记.md) 和一些说明文字。\n`,
        ).join("\n")}`
      : `# ${title}\n\n这是第 ${index + 1} 篇笔记的正文。\n\n- 要点一\n- 要点二\n- 要点三\n\n> 引用一段说明文字。\n\n| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n\n\`\`\`ts\nconst value = ${index}\nfunction demo(input: string) {\n  return input.repeat(2)\n}\n\`\`\`\n\n${filler}\n`
    notes.push({ content, folder, id: `webdav:${path}`, path, title })
  }
  return notes
}

async function seedVaultCache(page, notes) {
  await page.evaluate(async (notes) => {
    const separator = String.fromCharCode(0)
    const cacheId = "perf-vault"
    const cachedNotes = notes.map((note, index) => ({
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: note.folder,
      id: note.id,
      preview: `第 ${index + 1} 篇摘要`,
      readOnly: false,
      remotePath: note.path,
      revision: `"r${index}"`,
      searchText: note.content.toLocaleLowerCase(),
      source: "webdav",
      starred: index % 17 === 0,
      syncStatus: "synced",
      title: note.title,
      updatedAt: "刚刚",
    }))
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const database = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("vaults")) db.createObjectStore("vaults", { keyPath: "id" })
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" })
        if (!db.objectStoreNames.contains("attachments")) db.createObjectStore("attachments", { keyPath: "key" }).createIndex("cacheId", "cacheId")
        if (!db.objectStoreNames.contains("documents")) db.createObjectStore("documents", { keyPath: "key" }).createIndex("cacheId", "cacheId")
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(["vaults", "settings", "documents"], "readwrite")
    transaction.objectStore("documents").clear()
    transaction.objectStore("vaults").put({
      activeNoteId: cachedNotes[0].id,
      directories: [...new Set(notes.map((note) => note.folder))],
      id: cacheId,
      label: `性能压测库 ${notes.length} 篇`,
      lastSyncedAt: Date.now(),
      notes: cachedNotes,
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    for (const note of notes) {
      transaction.objectStore("documents").put({
        baseContent: note.content,
        cacheId,
        content: note.content,
        key: cacheId + separator + note.id,
        noteId: note.id,
        outgoingLinks: [],
        path: note.path,
        tags: [],
        title: note.title,
      })
    }
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, notes)
}

// 切换笔记、搜索、滚动三项都在页面里连续跑，每一步单独取一次长任务读数。
async function measureListInteractions(page) {
  return page.evaluate(async () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const settle = async (frames = 8) => { for (let index = 0; index < frames; index += 1) await nextFrame() }
    const blocked = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) blocked.push(Math.round(entry.duration))
    })
    observer.observe({ entryTypes: ["longtask"] })
    const take = () => { const value = blocked.reduce((sum, item) => sum + item, 0); blocked.length = 0; return value }

    const rows = [...document.querySelectorAll(".note-list-row")]
    rows[0].click()
    await settle(20)
    take()

    const switchBlocked = []
    for (let index = 1; index <= 10; index += 1) {
      take()
      rows[index % rows.length].click()
      await settle(14)
      switchBlocked.push(take())
    }

    await settle(10)
    take()
    const search = document.querySelector(".note-list-panel .note-search-wrap input")
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    const query = "笔记 0123"
    search.focus()
    const searchBlocked = []
    for (let length = 1; length <= query.length; length += 1) {
      take()
      setValue.call(search, query.slice(0, length))
      search.dispatchEvent(new Event("input", { bubbles: true }))
      await settle(10)
      searchBlocked.push(take())
    }
    setValue.call(search, "")
    search.dispatchEvent(new Event("input", { bubbles: true }))
    await settle(15)
    take()

    const viewport = document.querySelector('.note-list-scroll [data-slot="scroll-area-viewport"]')
    viewport.scrollTop = 0
    await settle(4)
    take()
    for (let step = 0; step < 50; step += 1) { viewport.scrollTop += 220; await nextFrame() }
    await settle(10)
    const scrollBlocked = take()

    observer.disconnect()
    const sorted = [...switchBlocked].sort((left, right) => left - right)
    return {
      scrollBlocked,
      searchBlocked,
      searchBlockedTotal: searchBlocked.reduce((sum, item) => sum + item, 0),
      switchBlocked,
      switchBlockedMedian: sorted[Math.floor(sorted.length / 2)],
      syntaxHighlightApplied: Boolean(document.querySelector(".hljs, [class*=hljs]")),
    }
  })
}

async function measureLongNoteTyping(page) {
  await page.evaluate(() => {
    const viewport = document.querySelector('.note-list-scroll [data-slot="scroll-area-viewport"]')
    if (viewport) viewport.scrollTop = 0
  })
  await page.waitForTimeout(400)
  await page.locator(".note-list-row", { hasText: "笔记 0001" }).first().click()
  await page.waitForTimeout(700)
  const editButton = page.locator('.note-view-mode-button[data-mode="edit"]')
  if (await editButton.count()) {
    await editButton.first().click()
    await page.waitForTimeout(2000)
  }
  await page.locator(".cm-content").click()
  await page.evaluate(() => {
    window.__benchBlocked = []
    window.__benchObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__benchBlocked.push(Math.round(entry.duration))
    })
    window.__benchObserver.observe({ entryTypes: ["longtask"] })
  })
  // 用真实键盘输入，delay 接近正常打字节奏；程序化 dispatch 测不出输入法与合成事件的开销。
  await page.keyboard.type("这是一段用来测手感的输入", { delay: 90 })
  await page.waitForTimeout(800)
  return page.evaluate(() => {
    window.__benchObserver.disconnect()
    return {
      blocked: window.__benchBlocked,
      blockedTotal: window.__benchBlocked.reduce((sum, item) => sum + item, 0),
    }
  })
}

const browser = await chromium.launch({ channel: "chrome" })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
try {
  const session = await page.context().newCDPSession(page)
  if (CPU_THROTTLE > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE })

  try {
    await page.goto(TARGET, { timeout: 10_000 })
  } catch {
    throw new Error(`打不开 ${TARGET}。先跑 pnpm build，再另开终端执行 pnpm preview --port ${PORT} --strictPort`)
  }
  await seedVaultCache(page, buildNotes(NOTE_COUNT))
  await page.reload()
  await page.waitForSelector(".note-list-row", { timeout: 15_000 })
  await page.waitForTimeout(2500)

  // 列表交互统一在阅读态下量，和用户日常浏览的状态一致。
  const previewButton = page.locator('.note-view-mode-button[data-mode="preview"]')
  if (await previewButton.count() && await previewButton.first().getAttribute("aria-pressed") !== "true") {
    await previewButton.first().click()
    await page.waitForTimeout(800)
  }

  const list = await measureListInteractions(page)
  const typing = await measureLongNoteTyping(page)

  console.log(`笔记 ${NOTE_COUNT} 篇 · CPU 节流 ${CPU_THROTTLE}x · 单位为主线程阻塞毫秒\n`)
  console.log(`  切换笔记      中位数 ${list.switchBlockedMedian}　明细 ${list.switchBlocked.join(" ")}`)
  console.log(`  搜索逐字输入  合计 ${list.searchBlockedTotal}　明细 ${list.searchBlocked.join(" ")}`)
  console.log(`  列表滚动      合计 ${list.scrollBlocked}`)
  console.log(`  长笔记打字    合计 ${typing.blockedTotal}　明细 ${typing.blocked.join(" ")}`)
  if (!list.syntaxHighlightApplied) console.log("\n  注意：没有检测到代码高亮，压测数据可能没覆盖到高亮路径")
} finally {
  await browser.close()
}
