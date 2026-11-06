import { expect, test } from '@playwright/test'
import { capabilityContent, seedCapabilityNote } from './editor-capability-seed'

const source = '正文\n\n| 项目 | 地址 |\n| --- | --- |\n| 设计稿 | https://example.com/design |\n\nios: 1496283 绑定 pt=19\n安卓: 1496487 绑定 pt=12\n\n- [ ] 后续任务'

for (const paste of [false, true]) {
  test(`表格后唯一空行输入不能吞入后续正文：粘贴=${paste}`, async ({ page, isMobile }) => {
    await seedCapabilityNote(page, source)
    const note = page.locator('.note-editor:visible')
    const blank = note.locator('.cm-md-table-wrap + .cm-line').first()
    await expect(blank).toHaveText('')
    // 移动端左侧 32px 是返回手势区，会主动阻止编辑器聚焦；在行内中部点按。
    if (isMobile) await blank.tap({ position: { x: 80, y: 12 } })
    else await blank.click({ position: { x: 4, y: 8 } })
    await expect(note.locator('.cm-content')).toBeFocused()
    if (paste) {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.evaluate(() => navigator.clipboard.writeText('新增正文'))
      await page.keyboard.press('ControlOrMeta+v')
    } else await page.keyboard.type('123')
    const text = paste ? '新增正文' : '123'
    await expect(note.locator('.cm-md-table tbody tr')).toHaveCount(1)
    await expect.poll(() => capabilityContent(page)).toBe(source.replace('\n\nios:', `\n\n${text}\nios:`))
    await expect(note.locator('.cm-content')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => capabilityContent(page)).toBe(source)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => capabilityContent(page)).toBe(source.replace('\n\nios:', `\n\n${text}\nios:`))
    await expect(note.locator('.cm-md-table tbody tr')).toHaveCount(1)
  })
}
