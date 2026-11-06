import { expect, test, type Page } from "@playwright/test"
import { capabilityContent, seedCapabilityNote } from "./editor-capability-seed"

const source = "正文\n\n| A | B |\n| --- | --- |\n| 甲 | 乙 |\n| 丙 | 丁 |\n\n结尾"
const table = (page: Page) => page.locator('.note-editor:visible .cm-md-table')
async function paste(page: Page, plain: string, html?: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(async ({ plain, html }) => {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([plain], { type: 'text/plain' }),
      ...(html ? { 'text/html': new Blob([html], { type: 'text/html' }) } : {}),
    })])
  }, { plain, html })
  await page.keyboard.press('ControlOrMeta+v')
}
async function action(page: Page, label: string) {
  const menu = page.locator('.note-editor:visible .cm-md-table-menu > summary', { hasText: '行列' })
  // 触屏没有 hover，需先点工具条抓手展开实际可见的菜单入口。
  if (!await menu.isVisible()) await page.locator('.note-editor:visible .cm-md-table-toolbar').click({ position: { x: 4, y: 4 } })
  await menu.click()
  await page.locator('.cm-md-table-menu-panel').getByRole('button', { name: label, exact: true }).click()
}

test('普通粘贴替换格内选区，保留换行、竖线和 Unicode', async ({ page }) => {
  await seedCapabilityNote(page, source)
  await table(page).locator('tbody td').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await paste(page, '中文🙂|末尾\n第二行')
  await expect(table(page).locator('textarea')).toHaveValue('中文🙂|末尾\n第二行')
  await page.keyboard.press('Tab')
  await expect.poll(() => capabilityContent(page)).toContain('| 中文🙂\\|末尾<br>第二行 | 乙 |')
  await expect.poll(() => capabilityContent(page)).toContain('结尾')
})

test('从末格粘贴 TSV 自动扩展行列，撤销重做保持边界', async ({ page }, testInfo) => {
  await seedCapabilityNote(page, source)
  await table(page).locator('tbody td').last().click()
  await paste(page, '一\t二\t三\r\n四\t\t六\r\n')
  await expect(table(page).locator('thead th')).toHaveCount(4)
  await expect(table(page).locator('tbody tr')).toHaveCount(3)
  await expect.poll(() => capabilityContent(page)).toContain('| 丙 | 一 | 二 | 三 |\n|  | 四 |  | 六 |')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => capabilityContent(page)).toBe(source)
  await expect(page.locator('.note-editor:visible .cm-content')).toBeFocused()
  await testInfo.attach('focus-after-undo', { body: JSON.stringify(await page.evaluate(() => ({ tag: document.activeElement?.tagName, className: document.activeElement?.className }))), contentType: 'application/json' })
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => capabilityContent(page)).toContain('| 丙 | 一 | 二 | 三 |\n|  | 四 |  | 六 |')
  // 重建后继续操作，确认不是只修复第一次重做。
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => capabilityContent(page)).toBe(source)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => capabilityContent(page)).toContain('| 丙 | 一 | 二 | 三 |\n|  | 四 |  | 六 |')
})

test('带引号 TSV 保留格内换行、双引号和尾部空格位', async ({ page }) => {
  await seedCapabilityNote(page, source)
  await table(page).locator('tbody td').first().click()
  await paste(page, '"第一行\n第二行"\t"他说""好"""\t\r\n末行\t尾\t\r\n')
  await expect.poll(() => capabilityContent(page)).toContain('| 第一行<br>第二行 | 他说"好" |  |\n| 末行 | 尾 |  |')
})

test('单列表格 HTML 粘贴保留单元格内 br 换行', async ({ page }) => {
  await seedCapabilityNote(page, source)
  await table(page).locator('tbody td').first().click()
  // 单列剪贴板没有制表符，需覆盖实际会进入的 HTML 回退解析路径。
  await paste(page, '第一行\n第二行\n下一格', '<table><tr><td>第一行<br>第二行</td></tr><tr><td>下一格</td></tr></table>')
  await expect.poll(() => capabilityContent(page)).toContain('| 第一行<br>第二行 | 乙 |\n| 下一格 | 丁 |')
})

for (const label of ['上方插入行', '下方插入行', '左侧插入列', '右侧插入列']) {
  test(`未提交内容后${label}，原内容与位置保持正确`, async ({ page }) => {
    await seedCapabilityNote(page, source)
    await table(page).locator('tbody td').first().click()
    await table(page).locator('textarea').fill('修改🙂')
    await action(page, label)
    const expected = label === '上方插入行' ? '|  |  |\n| 修改🙂 | 乙 |\n| 丙 | 丁 |'
      : label === '下方插入行' ? '| 修改🙂 | 乙 |\n|  |  |\n| 丙 | 丁 |'
      : label === '左侧插入列' ? '|  | 修改🙂 | 乙 |\n|  | 丙 | 丁 |'
      : '| 修改🙂 |  | 乙 |\n| 丙 |  | 丁 |'
    await expect.poll(() => capabilityContent(page)).toContain(expected)
    await expect.poll(() => capabilityContent(page)).toContain('正文')
    await expect.poll(() => capabilityContent(page)).toContain('结尾')
  })
}

test('删至最后一列后仍能插列并继续编辑', async ({ page }) => {
  await seedCapabilityNote(page, source)
  await table(page).locator('tbody td').first().click()
  await action(page, '删除列')
  await expect(table(page).locator('thead th')).toHaveCount(1)
  await table(page).locator('tbody td').first().click()
  await action(page, '右侧插入列')
  await expect(table(page).locator('thead th')).toHaveCount(2)
  await table(page).locator('tbody td').nth(1).click()
  await table(page).locator('textarea').fill('新增')
  await page.keyboard.press('Tab')
  await expect.poll(() => capabilityContent(page)).toContain('| 乙 | 新增 |\n| 丁 |  |')
})

for (const escape of [false, true]) {
  test(`粘贴后撤销重做对照：退出编辑=${escape}`, async ({ page }, testInfo) => {
    test.skip(escape && testInfo.project.name !== 'desktop-chrome', '该对照使用桌面工具栏重做按钮')
    await seedCapabilityNote(page, source)
    await table(page).locator('tbody td').last().click()
    await paste(page, '一\t二\n三\t四')
    await expect.poll(() => capabilityContent(page)).toContain('| 丙 | 一 | 二 |')
    if (escape) await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => capabilityContent(page)).toBe(source)
    if (escape) await page.locator('.note-editor:visible').getByRole('button', { name: '重做（⌘/Ctrl+Shift+Z）', exact: true }).click()
    else await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => capabilityContent(page)).toContain('| 丙 | 一 | 二 |\n|  | 三 | 四 |')
  })
}

test('删除全部正文行后从表头插行仍能录入', async ({ page }) => {
  await seedCapabilityNote(page, source)
  for (let remaining = 1; remaining >= 0; remaining--) {
    await table(page).locator('tbody td').first().click()
    await action(page, '删除行')
    await expect(table(page).locator('tbody tr')).toHaveCount(remaining)
  }
  await table(page).locator('th').first().click()
  await action(page, '下方插入行')
  await expect(table(page).locator('tbody tr')).toHaveCount(1)
  await table(page).locator('tbody td').first().click()
  await table(page).locator('textarea').fill('重新录入')
  await page.keyboard.press('Tab')
  await expect.poll(() => capabilityContent(page)).toContain('| 重新录入 |  |')
})

test('无 TSV 的普通 HTML 表格可正确粘贴二维内容', async ({ page }) => {
  await seedCapabilityNote(page, source)
  await table(page).locator('tbody td').first().click()
  await paste(page, '', '<table><tr><td>一</td><td>二</td></tr><tr><td>三</td><td>四</td></tr></table>')
  await expect.poll(() => capabilityContent(page)).toContain('| 一 | 二 |\n| 三 | 四 |')
})
