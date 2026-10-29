import { test, expect } from "@playwright/test"
import { seedCapabilityNote, capabilityContent } from "./editor-capability-seed"

test("日历返回恢复日期视图与选中日程，移除安排保留笔记", async ({ page }, info) => {
  const body = '---\nswell_event: 1\nevent_title: "跨日讨论"\nevent_start: 2027-02-03T23:00:00\nevent_end: 2027-02-04T01:00:00\nevent_category: work\ntags: [keep]\n---\n# 会议记录\n必须保留的正文\n'
  await seedCapabilityNote(page, body)
  await page.goto('/#/calendar?date=2027-02-03&view=agenda&mobileView=agenda')
  await page.locator('.swell-calendar-agenda-event').filter({ hasText: '跨日讨论' }).first().click()
  await expect(page.getByRole('dialog')).toContainText('跨日讨论')
  const calendarUrl = page.url()
  await page.getByRole('button', { name: '打开日程笔记', exact: true }).click()
  await expect(page.locator('.note-editor:visible .cm-content')).toBeVisible()
  // 来源路由还用于移动端返回按钮；浏览器后退验证相同上下文的重新挂载。
  expect(await page.evaluate(() => history.state.usr.returnTo)).toContain('/calendar?date=2027-02-03')
  if (info.project.name.includes('mobile')) {
    await page.reload()
    await page.getByRole('button', { name: '返回日历', exact: true }).click()
  } else await page.goBack()
  await expect(page).toHaveURL(calendarUrl)
  await expect(page.getByRole('dialog')).toContainText('跨日讨论')
  await page.reload()
  await expect(page.getByRole('dialog')).toContainText('跨日讨论')
  await page.getByRole('button', { name: '移除日程安排', exact: true }).click()
  await page.getByRole('button', { name: '保留安排', exact: true }).click()
  expect(await capabilityContent(page)).toContain('swell_event: 1')
  await page.getByRole('button', { name: '移除日程安排', exact: true }).click()
  await page.getByRole('button', { name: '确认移除安排', exact: true }).click()
  await expect.poll(() => capabilityContent(page)).not.toContain('swell_event')
  expect(await capabilityContent(page)).toContain('必须保留的正文')
  expect(await capabilityContent(page)).toContain('tags: [keep]')
  await page.reload()
  await expect(page.locator('.swell-calendar-agenda-event')).toHaveCount(0)
  await expect(page.locator('.note-calendar-footer')).toContainText('0 项日程')
})

test("异常日程可打开源笔记处理", async ({ page }) => {
  await seedCapabilityNote(page, '---\nswell_event: 1\nevent_title: "错误时间"\nevent_start: invalid\nevent_end: 2027-02-04T01:00:00\n---\n待修正正文')
  await page.goto('/#/calendar')
  const warning = page.getByRole('alert').filter({ hasText: '日程的名称或起止时间异常' })
  await expect(warning).toContainText('1 项')
  await warning.getByRole('button').click()
  await expect(page.locator('.note-editor:visible .cm-content')).toContainText('待修正正文')
})
