import { expect, test, type Page } from "@playwright/test"

// 表格编辑交互的界面验证。种子数据是独立的离线 vault，不触碰真实笔记。
const NOTE_CONTENT = [
  "# 表格验证",
  "",
  "这是 **加粗** 文字段落。",
  "",
  "| 名称 | 状态 | 备注 |",
  "| --- | :---: | --- |",
  "| 苹果 | 新鲜 | 重点 |",
  "| 香蕉 | 一般 | 普通 |",
  "| 樱桃 | 过期 | 残余 |",
  "",
  "结尾段落。",
].join("\n")

async function seedTableNote(page: Page) {
  await page.goto("/#/notes")
  await page.evaluate(async (content) => {
    const cacheId = "e2e-table-vault"
    const note = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/表格.md",
      preview: "表格交互",
      readOnly: false,
      remotePath: "/Swell/测试/表格.md",
      revision: '"t1"',
      source: "webdav",
      starred: false,
      syncStatus: "synced",
      title: "表格",
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
      label: "E2E 表格库",
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
  await page.getByRole("button", { name: "编辑模式" }).click()
  await expect(page.locator(".cm-md-table-wrap")).toBeVisible()
}

function cellDisplay(page: Page, text: string) {
  return page.locator(".cm-md-table td", { hasText: text }).first()
}

test.describe("表格编辑交互", () => {
  test("单击单元格按点击位置定位光标", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)

    const cell = cellDisplay(page, "苹果")
    const display = cell.locator(".cm-md-table-cell-display")
    await expect(display).toBeVisible()
    // 取「果」字的渲染矩形，点它的左边缘：光标应落在「苹」与「果」之间，而不是单元格末尾。
    const glyph = await display.evaluate((element) => {
      const textNode = element.firstChild
      if (!textNode) throw new Error("单元格没有文字节点")
      const range = document.createRange()
      range.setStart(textNode, 1)
      range.setEnd(textNode, 2)
      const rect = range.getBoundingClientRect()
      return { height: rect.height, x: rect.x, y: rect.y }
    })
    await page.mouse.click(glyph.x + 1, glyph.y + glyph.height / 2)
    const input = page.locator(".cm-md-table-cell-input")
    await expect(input).toBeVisible()
    await expect(input).toHaveValue("苹果")
    await page.keyboard.type("大")
    await page.keyboard.press("Enter")
    await expect(page.locator(".cm-md-table")).toContainText("苹大果")
  })

  test("在指定位置插入行与列", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)

    await cellDisplay(page, "香蕉").click()
    await expect(page.locator(".cm-md-table-cell-input")).toBeVisible()
    await page.locator(".cm-md-table-menu > summary", { hasText: "行列" }).click()
    await page.locator(".cm-md-table-menu-panel button", { hasText: "下方插入行" }).click()
    // 香蕉行下方出现一行空行，其他内容保持不变。
    await expect(page.locator(".cm-md-table tbody tr")).toHaveCount(4)
    await expect(page.locator(".cm-md-table")).toContainText("樱桃")

    await cellDisplay(page, "苹果").click()
    await page.locator(".cm-md-table-menu > summary", { hasText: "行列" }).click()
    await page.locator(".cm-md-table-menu-panel button", { hasText: "右侧插入列" }).click()
    await expect(page.locator(".cm-md-table thead th")).toHaveCount(4)
    // 撤销两步回到原表，验证结构操作支持撤销。
    await page.getByRole("button", { name: "撤销（⌘/Ctrl+Z）" }).click()
    await expect(page.locator(".cm-md-table thead th")).toHaveCount(3)
    await page.getByRole("button", { name: "撤销（⌘/Ctrl+Z）" }).click()
    await expect(page.locator(".cm-md-table tbody tr")).toHaveCount(3)
  })

  test("拖选矩形选区、就近浮层、复制与清空", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)

    const from = (await cellDisplay(page, "苹果").boundingBox())!
    const to = (await cellDisplay(page, "一般").boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()

    // 2×2 选区高亮，浮层出现；拖选没有把单元格带进编辑态。
    await expect(page.locator(".cm-md-table-cell-in-range")).toHaveCount(4)
    await expect(page.locator(".cm-md-table-cell-input")).toHaveCount(0)
    const bar = page.locator(".cm-md-table-floatbar")
    await expect(bar).toBeVisible()

    // 复制：合成 copy 事件读取写出的 TSV（选区优先于正文）。
    const tsv = await page.evaluate(() => {
      const data = new DataTransfer()
      document.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }))
      return data.getData("text/plain")
    })
    expect(tsv).toBe("苹果\t新鲜\n香蕉\t一般")

    // 浮层清空后选区保留，可一次撤销恢复。
    await bar.locator("button", { hasText: "清空" }).click()
    await expect(page.locator(".cm-md-table")).not.toContainText("苹果")
    await expect(page.locator(".cm-md-table-cell-in-range")).toHaveCount(4)
    await page.getByRole("button", { name: "撤销（⌘/Ctrl+Z）" }).click()
    await expect(page.locator(".cm-md-table")).toContainText("苹果")
  })

  test("右键菜单：结构操作且未提交文字不丢失", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)

    // 先在樱桃单元格进入编辑并输入，不提交。
    await cellDisplay(page, "樱桃").click()
    const input = page.locator(".cm-md-table-cell-input")
    await expect(input).toBeVisible()
    await page.keyboard.type("X")

    // 右键另一个单元格：菜单先提交未完成的输入，再对目标格操作。
    await cellDisplay(page, "新鲜").click({ button: "right" })
    const menu = page.locator('[data-slot="context-menu-content"]')
    await expect(menu).toBeVisible()
    // 全局只出现一个菜单。
    await expect(page.locator('[data-slot="context-menu-content"]')).toHaveCount(1)
    await expect(page.locator(".cm-md-table")).toContainText("樱桃X")

    await menu.getByRole("menuitem", { name: "在下方插入行" }).click()
    await expect(page.locator(".cm-md-table tbody tr")).toHaveCount(4)
    await expect(page.locator(".cm-md-table")).toContainText("樱桃X")
  })

  test("正文富文本粘贴转 Markdown，失败回退纯文本", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)

    await page.locator(".cm-content").click()
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData("text/html", [
        "<h2>粘贴标题</h2>",
        "<p>这是<strong>加粗</strong><a href=\"javascript:alert(1)\">危险链接</a></p>",
        "<table><tr><td>甲</td><td>乙</td></tr><tr><td>1</td><td>2</td></tr></table>",
        "<script>window.__pwned = true</script>",
      ].join(""))
      data.setData("text/plain", "纯文本兜底")
      document.querySelector(".cm-content")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }))
    })
    // 标题与加粗转成 Markdown 后参与即时渲染；危险链接降级为纯文字；脚本未执行。
    await expect(page.locator(".cm-content")).toContainText("粘贴标题")
    await expect(page.locator(".cm-content")).toContainText("危险链接")
    await expect(page.locator(".cm-content")).not.toContainText("javascript:")
    await expect(page.locator(".cm-md-table-wrap").nth(1)).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned ?? false)).toBe(false)

    // 无结构的 HTML 回退为纯文本，内容不丢。
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData("text/html", "<span>没有结构</span>")
      data.setData("text/plain", "纯文本回退内容")
      document.querySelector(".cm-content")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }))
    })
    await expect(page.locator(".cm-content")).toContainText("纯文本回退内容")

    // 行内片段原位插入，不把原段落拆成三段：在「结尾|段落」之间粘一个加粗词。
    await page.locator(".cm-line", { hasText: "结尾段落。" }).click()
    await page.keyboard.press("Home")
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData("text/html", "<strong>新</strong>")
      document.querySelector(".cm-content")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }))
    })
    // 光标移开后语法标记收起，整段仍是同一行。
    await page.locator(".cm-line", { hasText: "表格验证" }).click()
    await expect(page.locator(".cm-line", { hasText: "结尾新段落。" })).toHaveCount(1)
  })

  test("工具栏反映光标所在格式", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)

    // 点击正文里的加粗词，加粗按钮高亮；再点一次按钮取消格式并取消高亮。
    await page.locator(".cm-content").getByText("加粗", { exact: true }).click()
    const bold = page.getByRole("button", { name: "加粗（⌘/Ctrl+B）" })
    await expect(bold).toHaveAttribute("data-active", "true")
    await bold.click()
    await expect(bold).not.toHaveAttribute("data-active", "true")

    // 光标落到标题行，标题选择器显示对应级别。
    await page.locator(".cm-content").getByText("表格验证", { exact: true }).click()
    await expect(page.locator(".toolbar-heading-select")).toHaveValue("#")
    // 选「正文」取消标题格式（受控选择器重选同级不触发 onChange，必须有可达入口）。
    await page.locator(".toolbar-heading-select").selectOption("")
    await expect(page.locator(".toolbar-heading-select")).toHaveValue("")
    await expect(page.locator(".cm-line", { hasText: "表格验证" })).toHaveCount(1)
  })

  test("选区在添加行后保持可见，清空范围与高亮一致", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)

    // 拖选「苹果…一般」的 2×2 矩形选区。
    const from = (await cellDisplay(page, "苹果").boundingBox())!
    const to = (await cellDisplay(page, "一般").boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect(page.locator(".cm-md-table-cell-in-range")).toHaveCount(4)

    // 行列 → 添加行：选区跨重建保留并重新绘制（此前高亮消失，隐藏选区却仍在响应操作）。
    await page.locator(".cm-md-table-menu > summary", { hasText: "行列" }).click()
    await page.locator(".cm-md-table-menu-panel button", { hasText: "添加行" }).click()
    await expect(page.locator(".cm-md-table tbody tr")).toHaveCount(4)
    await expect(page.locator(".cm-md-table-cell-in-range")).toHaveCount(4)

    // 右键选区内的单元格清空：操作范围与可见高亮一致，正好是这 4 格。
    await cellDisplay(page, "香蕉").click({ button: "right" })
    const menu = page.locator('[data-slot="context-menu-content"]')
    await menu.getByRole("menuitem", { name: "清空选中区域" }).click()
    await expect(page.locator(".cm-md-table")).not.toContainText("苹果")
    await expect(page.locator(".cm-md-table")).not.toContainText("香蕉")
    // 选区外的内容不受影响。
    await expect(page.locator(".cm-md-table")).toContainText("樱桃")
  })

  test("建立多格选区时提交未完成的输入并接管键盘焦点", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)

    // 编辑「苹果」但不提交，Shift+点击「一般」建立 2×2 选区。
    await cellDisplay(page, "苹果").click()
    await expect(page.locator(".cm-md-table-cell-input")).toBeVisible()
    await page.keyboard.type("X")
    await page.keyboard.down("Shift")
    await cellDisplay(page, "一般").click()
    await page.keyboard.up("Shift")

    // 未提交的文字被写回、输入框收起：焦点不再留在 textarea，复制作用于整个选区。
    await expect(page.locator(".cm-md-table")).toContainText("苹果X")
    await expect(page.locator(".cm-md-table-cell-input")).toHaveCount(0)
    await expect(page.locator(".cm-md-table-cell-in-range")).toHaveCount(4)
    const tsv = await page.evaluate(() => {
      const data = new DataTransfer()
      document.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }))
      return data.getData("text/plain")
    })
    expect(tsv).toBe("苹果X\t新鲜\n香蕉\t一般")

    // 焦点已交给表格容器：真实键盘 Shift+方向键可以扩展选区（2×2 → 2×3）。
    await expect(page.locator(".cm-md-table-wrap")).toBeFocused()
    await page.keyboard.press("Shift+ArrowRight")
    await expect(page.locator(".cm-md-table-cell-in-range")).toHaveCount(6)
  })

  test("正文聚焦时拖选选区，真实键盘复制作用于表格", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome")
    await seedTableNote(page)
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])

    // 先点正文让 CodeMirror 持有焦点，再拖选「苹果…一般」的 2×2 选区。
    await page.locator(".cm-content").click()
    const from = (await cellDisplay(page, "苹果").boundingBox())!
    const to = (await cellDisplay(page, "一般").boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect(page.locator(".cm-md-table-cell-in-range")).toHaveCount(4)
    // 选区建立后焦点离开正文，否则复制的是正文而不是表格。
    await expect(page.locator(".cm-md-table-wrap")).toBeFocused()

    // 真实键盘复制：系统剪贴板收到表格 TSV。
    await page.keyboard.press("Meta+c")
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("苹果\t新鲜\n香蕉\t一般")
  })
})
