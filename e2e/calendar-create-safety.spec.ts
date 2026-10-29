import { test, expect, type Page } from '@playwright/test'
import { seedCapabilityNote } from './editor-capability-seed'

async function openCreate(page: Page) {
  await seedCapabilityNote(page, '# 创建验证')
  await page.evaluate(() => localStorage.setItem('swell-note:webdav-config:v1', JSON.stringify({provider:'jianguoyun',remotePath:'/Swell/',serverUrl:'https://dav.jianguoyun.com/dav/',username:'calendar-safety@example.com'})))
  await page.goto('/#/calendar')
  await page.reload()
  await page.getByRole('button',{name:'新建日程',exact:true}).click()
}
async function savedCount(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve,reject) => { const req=indexedDB.open('swell-note-vault-cache',3);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error) })
    try {
      return await new Promise<number>((resolve,reject) => { const req=db.transaction('documents').objectStore('documents').getAll();req.onsuccess=()=>resolve(req.result.filter((d:{content:string})=>d.content.includes('swell_event: 1')).length);req.onerror=()=>reject(req.error) })
    } finally { db.close() }
  })
}

test('未修改直接关闭，修改后 Esc、遮罩和关闭按钮均保护输入', async ({page}) => {
  await openCreate(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button',{name:'新建日程',exact:true}).click()
  await page.getByLabel('日程名称',{exact:true}).fill('保留我的输入')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading',{name:'放弃未保存的修改？'})).toBeVisible()
  await page.getByRole('button',{name:'继续编辑',exact:true}).click()
  await expect(page.getByLabel('日程名称',{exact:true})).toHaveValue('保留我的输入')
  await page.getByRole('button',{name:'Close',exact:true}).click()
  // 再次按 Esc 只退出确认界面，不丢弃草稿。
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('日程名称',{exact:true})).toHaveValue('保留我的输入')
  await page.mouse.click(5,5)
  await expect(page.getByRole('heading',{name:'放弃未保存的修改？'})).toBeVisible()
  await page.getByRole('button',{name:'放弃修改',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await savedCount(page)).toBe(0)
})

test('本地事务失败保留输入，重试只创建一次且关闭时已持久化', async ({page}) => {
  await openCreate(page)
  // 隔离缓存中模拟事务中止；覆盖异步失败，不能仅等待请求 put 成功。
  await page.evaluate(() => {
    const original=IDBDatabase.prototype.transaction
    ;(window as any).__restoreCalendarTransaction=()=>{IDBDatabase.prototype.transaction=original}
    IDBDatabase.prototype.transaction=function(stores,mode,options) {
      const tx=original.call(this,stores,mode,options)
      if(this.name==='swell-note-vault-cache' && mode==='readwrite') queueMicrotask(() => tx.abort())
      return tx
    }
  })
  await page.getByLabel('日程名称',{exact:true}).fill('失败后重试')
  await page.getByRole('button',{name:'保存日程',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('日程名称',{exact:true})).toHaveValue('失败后重试')
  expect(await savedCount(page)).toBe(0)
  await expect(page.locator('.note-calendar-footer')).toContainText('0 项日程')
  await page.evaluate(()=>(window as any).__restoreCalendarTransaction())
  // 同一轮事件连发两次提交，验证保存锁不会产生重复笔记。
  await page.locator('.note-calendar-form').first().evaluate(form=>{
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
  })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await savedCount(page)).toBe(1)
  await page.reload()
  await expect(page.locator('.note-calendar-footer')).toContainText('1 项日程')
  expect(await savedCount(page)).toBe(1)
})

test('等待本地事务期间禁止退出和重复提交', async ({page}) => {
  await openCreate(page)
  await page.evaluate(()=>{
    const original=IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction=function(stores,mode,options){
      const tx=original.call(this,stores,mode,options)
      if(this.name==='swell-note-vault-cache' && mode==='readwrite'){
        IDBDatabase.prototype.transaction=original
        Object.defineProperty(tx,'oncomplete',{set(callback){
          tx.addEventListener('complete',event=>{(window as any).__completeCalendarWrite=()=>callback.call(tx,event)},{once:true})
        }})
      }
      return tx
    }
  })
  await page.getByLabel('日程名称',{exact:true}).fill('等待落盘')
  await page.getByRole('button',{name:'保存日程',exact:true}).click()
  await page.waitForFunction(()=>typeof (window as any).__completeCalendarWrite==='function')
  await expect(page.getByLabel('日程名称',{exact:true})).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button',{name:'正在保存…',exact:true})).toBeDisabled()
  await page.locator('form.note-calendar-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  await page.evaluate(()=>(window as any).__completeCalendarWrite())
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await savedCount(page)).toBe(1)
})
