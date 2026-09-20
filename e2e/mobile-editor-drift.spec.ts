import { expect, test, type Page } from "@playwright/test"

// 移动端「每打开一次笔记，页面整体下移一段、顶部空白不断增大」的回归护栏。
// 只在真实移动视口下测量累计位移：每次进入笔记详情都记录布局视口与各滚动所有者的位置，
// 20 轮之后同名的量与首轮一致才算通过。
// 同时把「只应有一个滚动所有者」写进断言：任何新增的可滚容器都会让它失败。

async function seedCachedVault(page: Page) {
  await page.goto("/#/notes")
  await page.evaluate(async () => {
    const cacheId = "e2e-drift"
    const note = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/长文.md",
      preview: "长文摘要",
      readOnly: false,
      remotePath: "/Swell/测试/长文.md",
      revision: '"d1"',
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title: "长文",
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
      label: "E2E 漂移库",
      lastSyncedAt: Date.now(),
      notes: [note],
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    const content = ["# 长文", "", ...Array.from({ length: 120 }, (_, index) => `第 ${index + 1} 段落正文。`)].join("\n")
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
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  })
  await page.reload()
}

// 采集一次「当前这一屏的几何事实」。全部是只读测量，不修改页面。
async function measure(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const scrollers: Array<{ cls: string; scrollTop: number; overflowY: string }> = []
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      const style = getComputedStyle(element)
      if (!/auto|scroll/.test(style.overflowY)) continue
      if (element.scrollHeight <= element.clientHeight + 1) continue
      scrollers.push({
        cls: typeof element.className === "string" ? element.className.split(/\s+/).slice(0, 2).join(".") : element.tagName,
        overflowY: style.overflowY,
        scrollTop: element.scrollTop,
      })
    }
    const content = document.querySelector<HTMLElement>(".cm-content")
    const shell = document.querySelector<HTMLElement>(".markdown-editor-shell")
    const workspaceEl = document.querySelector<HTMLElement>(".mobile-workspace")
    const host = document.querySelector<HTMLElement>(".markdown-editor-host")
    return {
      bodyScrollTop: document.body.scrollTop,
      cmEditorCount: document.querySelectorAll(".cm-editor").length,
      domNodeCount: document.querySelectorAll("*").length,
      hostTop: host ? Math.round(host.getBoundingClientRect().top) : null,
      shellMinHeight: shell ? getComputedStyle(shell).minHeight : null,
      workspacePadTop: workspaceEl ? getComputedStyle(workspaceEl).paddingTop : null,
      workspaceHeight: workspaceEl ? getComputedStyle(workspaceEl).height : null,
      docScrollTop: root.scrollTop,
      // 顶部空白 = 正文首行相对视口顶端的距离；累计位移会直接体现在这个值上。
      contentTop: content ? Math.round(content.getBoundingClientRect().top) : null,
      rootClientHeight: root.clientHeight,
      rootScrollHeight: root.scrollHeight,
      scrollerCount: scrollers.length,
      scrollers,
      windowScrollY: window.scrollY,
    }
  })
}

test.describe("移动端编辑器累计位移", () => {
  test("反复进入同一篇笔记 20 次，顶部空白与滚动所有权保持不变", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "只在移动视口下测量")
    test.setTimeout(180_000)
    await seedCachedVault(page)

    const workspace = page.locator(".mobile-workspace:visible")
    // 移动端笔记库根屏只列文件夹，先进「测试」才能看到笔记行。
    await expect(workspace.getByText("测试", { exact: true }).first()).toBeVisible()
    await workspace.getByText("测试", { exact: true }).first().click()
    await expect(workspace.getByText("长文", { exact: true }).first()).toBeVisible()

    const samples: Awaited<ReturnType<typeof measure>>[] = []
    for (let round = 0; round < 20; round += 1) {
      await workspace.getByText("长文", { exact: true }).first().click()
      await expect(page.locator(".cm-content")).toBeVisible()
      await page.waitForTimeout(250)
      samples.push(await measure(page))
      // 返回列表，再进入下一轮。
      await page.goBack()
      await expect(workspace.getByText("长文", { exact: true }).first()).toBeVisible()
      await page.waitForTimeout(120)
    }

    console.log(JSON.stringify(samples.map((s) => ({
      contentTop: s.contentTop, cmEditorCount: s.cmEditorCount, domNodeCount: s.domNodeCount,
      hostTop: s.hostTop, rootClientHeight: s.rootClientHeight, rootScrollHeight: s.rootScrollHeight,
      shellMinHeight: s.shellMinHeight, workspaceHeight: s.workspaceHeight, workspacePadTop: s.workspacePadTop,
      scrollerCount: s.scrollerCount,
    })), null, 1))

    const first = samples[0]
    // 逐轮比对：任何累计漂移都会在某一轮开始持续偏离首轮。
    for (const [index, sample] of samples.entries()) {
      expect(sample.contentTop, `第 ${index + 1} 轮正文顶端`).toBe(first.contentTop)
      expect(sample.rootClientHeight, `第 ${index + 1} 轮布局视口高度`).toBe(first.rootClientHeight)
      expect(sample.rootScrollHeight, `第 ${index + 1} 轮布局视口内容高度`).toBe(first.rootScrollHeight)
      expect(sample.windowScrollY, `第 ${index + 1} 轮 window.scrollY`).toBe(0)
      expect(sample.bodyScrollTop, `第 ${index + 1} 轮 body.scrollTop`).toBe(0)
      expect(sample.docScrollTop, `第 ${index + 1} 轮根节点 scrollTop`).toBe(0)
      // 滚动所有者只应有一个：多出来的可滚容器就是累计位移的温床。
      expect(sample.scrollerCount, `第 ${index + 1} 轮可滚容器数量`).toBe(first.scrollerCount)
    }
  })
})
