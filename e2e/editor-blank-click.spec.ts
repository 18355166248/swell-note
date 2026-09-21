import { expect, test, type Page } from "@playwright/test"

// 点击「行内文字右侧空白」的落点验证。种子数据是独立的离线 vault，不触碰真实笔记。
const NOTE_CONTENT = [
  "- [ ] 删除系统日历 rn有sdk",
  "NativeModules.Business.recurringCalendarDelete 对应的添加日历也可以完善下",
  "",
  "普通行一",
  "普通行二",
  "",
  "这是一段足够长的文本用来触发自动折行，需要写得足够长才能撑满整行宽度并折成两段以上，继续加字继续加字。",
  "末尾行",
].join("\n")

async function seedBlankClickNote(page: Page) {
  await page.goto("/#/notes")
  await page.evaluate(async (content) => {
    const cacheId = "e2e-blank-click-vault"
    const note = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/空白点击.md",
      preview: "空白点击",
      readOnly: false,
      remotePath: "/Swell/测试/空白点击.md",
      revision: '"t1"',
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title: "空白点击",
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
      label: "E2E 空白点击库",
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
  await expect(page.locator(".cm-content")).toBeVisible()
}

type Rect = { bottom: number; top: number }

// 第 n 个视觉行（.cm-line）的行框；折行行占多个视觉行，这里只取第一个。
function rowBox(page: Page, lineNo: number) {
  return page.locator(".cm-line").nth(lineNo - 1)
}

type Box = Rect & { left: number; right: number }

async function rowRect(row: ReturnType<typeof rowBox>): Promise<Box> {
  const box = await row.boundingBox()
  if (!box) throw new Error("行框不可见")
  return { bottom: box.y + box.height, left: box.x, right: box.x + box.width, top: box.y }
}

// 行内最后一个文字节点的右边界：由 DOM 真实排版量出，避免依赖 CodeMirror 的高度缓存。
async function textEndX(row: ReturnType<typeof rowBox>): Promise<number> {
  const x = await row.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node as Text
    if (!last || !last.length) return null
    const range = document.createRange()
    range.setStart(last, last.length)
    range.setEnd(last, last.length)
    const rect = range.getBoundingClientRect()
    if (rect.width || rect.height) return rect.right
    return last.parentElement?.getBoundingClientRect().right ?? null
  })
  if (x === null) throw new Error("行内没有文字节点")
  return x
}

type SelectionSnapshot = {
  anchorCol: number
  anchorLine: number
  empty: boolean
  headCol: number
  lineNo: number
  ranges: number
}

async function selection(page: Page): Promise<SelectionSnapshot> {
  return page.evaluate(() => {
    const content = document.querySelector(".cm-content") as HTMLElement
    const view = (content as unknown as { cmTile: { root: { view: unknown } } }).cmTile.root.view as never as {
      state: {
        doc: { lineAt: (pos: number) => { from: number; number: number } }
        selection: { main: { anchor: number; empty: boolean; head: number }; ranges: unknown[] }
      }
    }
    const main = view.state.selection.main
    const line = view.state.doc.lineAt(main.head)
    return {
      anchorCol: main.anchor - view.state.doc.lineAt(main.anchor).from,
      anchorLine: view.state.doc.lineAt(main.anchor).number,
      empty: main.empty,
      headCol: main.head - line.from,
      lineNo: line.number,
      ranges: view.state.selection.ranges.length,
    }
  })
}

async function documentLines(page: Page, count = 6): Promise<string[]> {
  return page.evaluate((take) => {
    const content = document.querySelector(".cm-content") as HTMLElement
    const view = (content as unknown as { cmTile: { root: { view: unknown } } }).cmTile.root.view as never as {
      state: { doc: { toString: () => string } }
    }
    return view.state.doc.toString().split("\n").slice(0, take)
  }, count)
}

// 行内文字右侧的空白点：必须落在正文内，否则点到编辑器之外，落点根本不会更新。
async function blankXInside(page: Page, row: ReturnType<typeof rowBox>): Promise<number> {
  const contentRight = await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as HTMLElement
    return content.getBoundingClientRect().right
  })
  const x = (await textEndX(row)) + 40
  return Math.min(x, contentRight - 4)
}

// 在行内空白处点一下：x 取该行文字右侧，y 取行框内的指定纵向位置。
async function clickBlank(page: Page, lineNo: number, at: "upper" | "lower" | "middle") {
  const row = rowBox(page, lineNo)
  const box = await rowRect(row)
  const x = await blankXInside(page, row)
  const y = at === "upper" ? box.top + 4 : at === "lower" ? box.bottom - 3 : (box.top + box.bottom) / 2
  await page.mouse.click(x, y)
  return { x, y }
}

// 行内靠左的文字起点：正文列不在视口左边缘，用固定 x 会点到编辑器之外。
async function textStartX(row: ReturnType<typeof rowBox>): Promise<number> {
  const x = await row.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode() as Text | null
    if (!text || !text.length) return null
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 1)
    const rect = range.getBoundingClientRect()
    return rect.width || rect.height ? rect.left : null
  })
  if (x === null) throw new Error("行内没有文字节点")
  return x
}

test.describe("行内空白点击落点", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedBlankClickNote(page)
  })

  test("任务行右侧空白：上半区与下半区都落在本行行尾", async ({ page }) => {
    // 「下半区」是关键一档：高度缓存与真实排版不一致时，CodeMirror 会把行框下半段
    // 判给下一行，光标因此跳到第 2 行。
    await clickBlank(page, 1, "upper")
    expect(await selection(page)).toMatchObject({ headCol: 19, lineNo: 1 })

    await clickBlank(page, 1, "lower")
    expect(await selection(page)).toMatchObject({ headCol: 19, lineNo: 1 })

    // 输入标记字符：必须追加到第 1 行末尾，绝不能写进第 2 行。
    await page.keyboard.type("★")
    const lines = await documentLines(page, 3)
    expect(lines[0]).toBe("- [ ] 删除系统日历 rn有sdk★")
    expect(lines[1]).toBe("NativeModules.Business.recurringCalendarDelete 对应的添加日历也可以完善下")
    expect(lines[1]).not.toContain("★")
  })

  test("普通行右侧空白：上半区与下半区都落在本行行尾", async ({ page }) => {
    await clickBlank(page, 4, "upper")
    expect(await selection(page)).toMatchObject({ headCol: 4, lineNo: 4 })

    await clickBlank(page, 4, "lower")
    expect(await selection(page)).toMatchObject({ headCol: 4, lineNo: 4 })

    await page.keyboard.type("☆")
    const lines = await documentLines(page, 6)
    expect(lines[3]).toBe("普通行一☆")
    expect(lines[4]).toBe("普通行二")
  })

  test("点击文字中间仍按具体字符定位", async ({ page }) => {
    const row = rowBox(page, 4)
    const box = await rowRect(row)
    // 量出「行」字的渲染矩形，点它的左边缘：光标应落在「通」与「行」之间。
    const glyph = await row.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode() as Text | null
      if (!text) throw new Error("行内没有文字节点")
      const range = document.createRange()
      range.setStart(text, 2)
      range.setEnd(text, 3)
      const rect = range.getBoundingClientRect()
      return { left: rect.left, width: rect.width }
    })
    await page.mouse.click(glyph.left + 1, (box.top + box.bottom) / 2)
    const placed = await selection(page)
    expect(placed.lineNo).toBe(4)
    // 「普通行一」中点在第 3 个字符左右，绝不能是行尾（4）。
    expect(placed.headCol).toBeGreaterThanOrEqual(2)
    expect(placed.headCol).toBeLessThan(4)
  })

  test("Shift+点击扩展选区不被截断", async ({ page }) => {
    const firstRow = rowBox(page, 4)
    const secondRow = rowBox(page, 5)
    const first = await rowRect(firstRow)
    const third = await rowRect(secondRow)
    const firstX = (await textStartX(firstRow)) + 2
    const secondX = (await textStartX(secondRow)) + 2
    await page.mouse.click(firstX, (first.top + first.bottom) / 2)
    await page.keyboard.down("Shift")
    await page.mouse.click(secondX, (third.top + third.bottom) / 2)
    await page.keyboard.up("Shift")
    const extended = await selection(page)
    expect(extended.ranges).toBe(1)
    // 头部到了第 5 行、锚点仍在第 4 行，说明是扩选而不是重新落点。
    expect(extended.lineNo).toBe(5)
    expect(extended.anchorLine).toBe(4)
    expect(extended.anchorCol).toBe(0)
  })

  test("从空白处拖选仍能拉出选区", async ({ page }) => {
    const firstRow = rowBox(page, 4)
    const secondRow = rowBox(page, 5)
    const first = await rowRect(firstRow)
    const second = await rowRect(secondRow)
    const blankX = await blankXInside(page, firstRow)
    const targetX = (await textStartX(secondRow)) + 2
    await page.mouse.move(blankX, (first.top + first.bottom) / 2)
    await page.mouse.down()
    await page.mouse.move(targetX, (second.top + second.bottom) / 2, { steps: 10 })
    await page.mouse.up()
    const dragged = await selection(page)
    expect(dragged.ranges).toBe(1)
    // 起手在本行行尾，拖到第 5 行内：选区跨行而不是塌成一个光标。
    expect(dragged.empty).toBe(false)
    expect(dragged.anchorLine).toBe(4)
    expect(dragged.anchorCol).toBe(4)
    expect(dragged.lineNo).toBe(5)
  })

  test("自动折行的长文本不会被送到整个逻辑行末尾", async ({ page }) => {
    // 折行行占多个视觉行，第一段右侧的空白只属于这一段，不能直接跳到整行末。
    const wrap = await page.evaluate(() => {
      const content = document.querySelector(".cm-content") as HTMLElement
      const view = (content as unknown as { cmTile: { root: { view: unknown } } }).cmTile.root.view as never as {
        state: { doc: { lines: number; line: (n: number) => { from: number; to: number; text: string } } }
        coordsAtPos: (pos: number, side?: number) => { top: number; bottom: number; right: number } | null
      }
      const contentRight = content.getBoundingClientRect().right
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n)
        const start = view.coordsAtPos(line.from, 1)
        const end = view.coordsAtPos(line.to, -1)
        if (!start || !end || Math.abs(start.top - end.top) < 1) continue
        // 第一个纵向位置下移的字符，就是折行点的位置。
        for (let pos = line.from + 1; pos <= line.to; pos++) {
          const rect = view.coordsAtPos(pos, 1)
          if (rect && rect.top > start.top + 1) {
            const previous = view.coordsAtPos(pos - 1, -1)!
            // 第一段末字可能顶到正文右边界，空白只剩几个像素：留够可点宽度，
            // 但必须仍在正文内，否则点到编辑器之外，落点会留在原处而不是被点的那一行。
            const gap = contentRight - previous.right
            return {
              blankX: gap >= 12 ? previous.right + Math.min(30, gap - 4) : null,
              firstSegmentRight: previous.right,
              glyphH: start.bottom - start.top,
              lineFrom: line.from,
              lineNo: n,
              lineTo: line.to,
              segTop: start.top,
            }
          }
        }
      }
      return null
    })
    expect(wrap).not.toBeNull()
    // 第一段右侧的空白：x 取第一段末字之右（且落在正文内），y 取第一段行内。
    expect(wrap!.blankX, "第一段右侧需要留出可点的空白").not.toBeNull()
    await page.mouse.click(wrap!.blankX!, wrap!.segTop + wrap!.glyphH / 2)
    const placed = await selection(page)
    expect(placed.lineNo).toBe(wrap!.lineNo)
    // 关键：落点必须在第一段里，而不是整个逻辑行的末尾。
    expect(placed.headCol).toBeLessThan(wrap!.lineTo - wrap!.lineFrom)
  })

  test("高度缓存与真实排版不一致时，仍落在被点的那一行", async ({ page }) => {
    // CodeMirror 的行高是自己量出来的：字体换用、缩放或样式晚于首次测量生效，
    // 缓存就会与实际排版脱节，行框下半段被判给下一行。这里用运行期改行高复现该状态。
    const row = rowBox(page, 1)
    const x = await blankXInside(page, row)
    await page.evaluate(() => {
      const style = document.createElement("style")
      style.id = "e2e-line-height"
      style.textContent = ".markdown-editor-shell .cm-scroller { line-height: 2.6 !important; }"
      document.head.appendChild(style)
    })
    await page.waitForTimeout(200)

    const box = await rowRect(row)
    await page.mouse.click(x, box.bottom - 3)
    const placed = await selection(page)
    expect(placed.lineNo).toBe(1)
    expect(placed.headCol).toBe(19)

    await page.keyboard.type("★")
    const lines = await documentLines(page, 3)
    expect(lines[0]).toBe("- [ ] 删除系统日历 rn有sdk★")
  })
})
