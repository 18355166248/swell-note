import { test, expect } from '@playwright/test'
import { seedCapabilityNote } from './editor-capability-seed'

test('日历样式：明暗主题、日程与新建表单适配', async ({page}, info) => {
  const today = new Date();today.setHours(10,0,0,0)
  const events = [
    {title:'产品方案讨论',hour:10,category:'work'},
    {title:'阅读与灵感整理',hour:14,category:'personal'},
    {title:'本周计划回顾',hour:16,category:'work'},
  ]
  const content=(event:typeof events[number])=>{
    const start=new Date(today);start.setHours(event.hour)
    return `---\nswell_event: 1\nevent_title: "${event.title}"\nevent_start: ${start.toISOString()}\nevent_end: ${new Date(+start+3600000).toISOString()}\nevent_category: ${event.category}\n---\n# ${event.title}\n`
  }
  await seedCapabilityNote(page, content(events[0]))
  // 离开应用再写入隔离样例，避免旧页面防抖快照覆盖测试数据。
  await page.goto("/manifest.webmanifest")
  await page.evaluate(async ({contents})=>{
    localStorage.setItem('swell-note:webdav-config:v1',JSON.stringify({provider:'jianguoyun',remotePath:'/Swell/',serverUrl:'https://dav.jianguoyun.com/dav/',username:'visual@example.com'}))
    const db=await new Promise<IDBDatabase>(resolve=>{const req=indexedDB.open('swell-note-vault-cache',3);req.onsuccess=()=>resolve(req.result)})
    const tx=db.transaction(['vaults','documents'],'readwrite')
    const store=tx.objectStore('vaults'),req=store.get('editor-capability-test')
    req.onsuccess=()=>{
      const vault=req.result,base=vault.notes[0]
      contents.forEach((content,index)=>{
        const id=`webdav:/Swell/视觉验证-${index}.md`
        vault.notes.push({...base,id,title:`日程记录 ${index+1}`,remotePath:`/Swell/视觉验证-${index}.md`})
        tx.objectStore('documents').put({cacheId:vault.id,noteId:id,key:`${vault.id}\u0000${id}`,content,title:`日程记录 ${index+1}`})
      })
      store.put(vault)
    }
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
    db.close()
  },{contents:events.slice(1).map(content)})
  await page.goto('/#/calendar');await page.reload()
  const mobile=info.project.name.includes('mobile')
  if(!mobile) await page.setViewportSize({width:1440,height:900})
  const size=mobile?'mobile':'desktop'
  await expect(page.locator('.note-calendar-footer')).toContainText('3 项日程')
  await expect(page.locator(mobile?'.swell-calendar-agenda-event':'.note-calendar-item')).toHaveCount(3)
  await page.screenshot({path:`docs/calendar/polish/${size}-light.png`,fullPage:true,animations:"disabled"})
  await page.evaluate(()=>document.documentElement.classList.add('dark'))
  await page.screenshot({path:`docs/calendar/polish/${size}-dark.png`,fullPage:true,animations:"disabled"})
  await page.evaluate(()=>document.documentElement.classList.remove('dark'))
  await page.getByRole('button',{name:'新建日程',exact:true}).click()
  await expect(page.getByLabel('日程名称',{exact:true})).toBeVisible()
  await page.screenshot({path:`docs/calendar/polish/${size}-create.png`,fullPage:true,animations:"disabled"})
  await page.keyboard.press('Escape')
  for(const width of mobile?[320,390]:[1024,1440]){
    await page.setViewportSize({width,height:mobile?844:900})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.getByRole('button',{name:'日',exact:true}).click()
    await expect(page.locator('.swell-calendar-day-view')).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
})
