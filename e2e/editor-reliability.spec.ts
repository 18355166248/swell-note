import {expect,test,type Page} from "@playwright/test"
async function seedCachedVault(page: Page, noteContent?: string, readOnly = false, secondNoteContent = "# 第二篇\n\n正文 B") {
  await page.goto("/#/notes")
  await page.evaluate(async ({ noteContent, readOnly, secondNoteContent }) => {
    const cacheId = "e2e-vault"
    const noteA = {
      content: "",
      contentCached: true,
      contentLoaded: false,
      folder: "测试",
      id: "webdav:/Swell/测试/第一篇.md",
      preview: "第一篇摘要",
      readOnly,
      remotePath: "/Swell/测试/第一篇.md",
      revision: '"a1"',
      source: readOnly ? "local" : "webdav",
      starred: false,
      syncStatus: "synced",
      title: "第一篇",
      updatedAt: "刚刚",
    }
    const noteB = {
      ...noteA,
      id: "webdav:/Swell/测试/第二篇.md",
      preview: "第二篇摘要",
      remotePath: "/Swell/测试/第二篇.md",
      revision: '"b1"',
      title: "第二篇",
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
      label: "E2E 离线库",
      lastSyncedAt: Date.now(),
      notes: [noteA, noteB],
      savedAt: Date.now(),
      sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    const contentA = noteContent ?? [
      "# 第一篇",
      "",
      "标准笔记链接：[第二篇](./%E7%AC%AC%E4%BA%8C%E7%AF%87.md)",
      "",
      "双链：[[第二篇]]",
      "",
      "裸 URL：https://example.com/page",
      "",
      "外部链接：[示例站](https://example.com)",
      "",
    ].join("\n")
    for (const [note, content] of [[noteA, contentA], [noteB, secondNoteContent]] as const) {
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
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  }, { noteContent, readOnly, secondNoteContent })
  await page.reload()
}


test('审计：全部替换后仍有匹配时计数应刷新', async ({page}) => {
  await seedCachedVault(page, '猫 猫')
  const editor = page.locator('.desktop-workspace:visible .cm-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByLabel('查找当前笔记').fill('猫')
  const bar=page.locator('.editor-find-bar')
  await expect(bar.locator('[aria-live]')).toHaveText('1/2')
  await page.getByLabel('替换为').fill('猫咪')
  await bar.getByRole('button', {name:'全部',exact:true}).click()
  await expect(editor).toHaveText('猫咪 猫咪')
  await expect(bar.locator('[aria-live]')).toContainText('/2')
  await expect(bar.getByRole('button', {name:'下一个匹配项'})).toBeEnabled()
})
test('审计：打开查找后正文新增匹配应更新计数', async ({page}) => {
  await seedCachedVault(page, '猫')
  const editor = page.locator('.desktop-workspace:visible .cm-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByLabel('查找当前笔记').fill('猫')
  const bar=page.locator('.editor-find-bar')
  await expect(bar.locator('[aria-live]')).toHaveText('1/1')
  await editor.click()
  await editor.press('ControlOrMeta+End')
  await editor.press('End')
  await page.keyboard.insertText(' 猫')
  await expect(editor).toHaveText('猫 猫')
  await expect(bar.locator('[aria-live]')).toContainText('/2')
  await editor.press('ControlOrMeta+z')
  await expect(bar.locator('[aria-live]')).toContainText('/1')
  await editor.press('ControlOrMeta+Shift+z')
  await expect(bar.locator('[aria-live]')).toContainText('/2')
})
test('审计：历史保护副本写入失败不能继续覆盖当前正文', async ({page}) => {
  await seedCachedVault(page, '当前不可丢失正文')
  const editor = page.locator('.desktop-workspace:visible .cm-content')
  await expect(editor).toBeVisible()
  // 独立测试库内注入旧版本；只对「恢复前」写入模拟存储故障。
  await page.evaluate(async () => {
    const req=indexedDB.open('swell-note-history',1)
    req.onupgradeneeded=()=>{
      const s=req.result.createObjectStore('versions',{keyPath:'key'})
      s.createIndex('noteKey','noteKey')
    }
    const db=await new Promise<IDBDatabase>((r,j)=>{req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error)})
    const tx=db.transaction('versions','readwrite')
    tx.objectStore('versions').put({cacheId:'e2e-vault',content:'旧版本正文',createdAt:Date.now(),id:'audit-old',key:'audit-old',noteId:'webdav:/Swell/测试/第一篇.md',noteKey:'e2e-vault\u0000webdav:/Swell/测试/第一篇.md',reason:'编辑前',title:'第一篇'})
    await new Promise<void>((r,j)=>{tx.oncomplete=()=>r();tx.onerror=()=>j(tx.error)})
    db.close()
    const original=IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put=function(value,key){
      if(this.name==='versions' && value.reason==='恢复前') throw new DOMException('audit storage full','QuotaExceededError')
      return key===undefined ? original.call(this,value) : original.call(this,value,key)
    }
  })
  await page.getByRole('button',{name:'更多操作',exact:true}).click()
  await page.getByRole('menuitem',{name:/本地版本历史/}).click()
  await expect(page.locator('.note-history-preview pre')).toHaveText('旧版本正文')
  page.once('dialog', d=>d.accept())
  await page.getByRole('button',{name:'恢复此版本',exact:true}).click()
  await expect(editor).toHaveText('当前不可丢失正文')
})

test('恢复成功后保留恢复前正文的持久版本', async ({page}) => {
  await seedCachedVault(page, '当前正文')
  const editor = page.locator('.desktop-workspace:visible .cm-content')
  await expect(editor).toBeVisible()
  await page.evaluate(async () => {
    const req = indexedDB.open('swell-note-history', 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('versions', {keyPath: 'key'})
      store.createIndex('noteKey', 'noteKey')
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error)})
    const tx = db.transaction('versions', 'readwrite')
    tx.objectStore('versions').put({cacheId:'e2e-vault',content:'旧正文',createdAt:Date.now(),id:'old',key:'old',noteId:'webdav:/Swell/测试/第一篇.md',noteKey:'e2e-vault\u0000webdav:/Swell/测试/第一篇.md',reason:'编辑前',title:'第一篇'})
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error)})
    db.close()
  })
  await page.getByRole('button',{name:'更多操作',exact:true}).click()
  await page.getByRole('menuitem',{name:/本地版本历史/}).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button',{name:'恢复此版本',exact:true}).click()
  await expect(editor).toHaveText('旧正文')
  const protectedContent = await page.evaluate(async () => {
    const req = indexedDB.open('swell-note-history', 1)
    const db = await new Promise<IDBDatabase>((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})
    const tx=db.transaction('versions','readonly')
    const items=await new Promise<any[]>((resolve,reject)=>{const get=tx.objectStore('versions').getAll();get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)})
    db.close()
    return items.find(item=>item.reason==='恢复前')?.content
  })
  expect(protectedContent).toBe('当前正文')
})

test('全部替换为相同文字或空文本后，匹配状态与撤销一致', async ({page}) => {
  await seedCachedVault(page, '猫 猫')
  const editor = page.locator('.desktop-workspace:visible .cm-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByLabel('查找当前笔记').fill('猫')
  const bar = page.locator('.editor-find-bar')
  await page.getByLabel('替换为').fill('猫')
  await bar.getByRole('button', {name:'全部', exact:true}).click()
  await expect(editor).toHaveText('猫 猫')
  await expect(bar.locator('[aria-live]')).toContainText('/2')
  await page.getByLabel('替换为').fill('')
  await bar.getByRole('button', {name:'全部', exact:true}).click()
  await expect(editor).toHaveText(' ')
  await expect(bar.locator('[aria-live]')).toHaveText('无匹配')
  await editor.press('ControlOrMeta+z')
  await expect(bar.locator('[aria-live]')).toContainText('/2')
})

test('查找计数刷新与全部替换不抢输入焦点', async ({page}) => {
  await seedCachedVault(page, '猫 猫')
  const editor = page.locator('.desktop-workspace:visible .cm-content')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+f')
  const query = page.getByLabel('查找当前笔记')
  await query.fill('猫')
  await expect(query).toBeFocused()
  await expect(page.locator('.editor-find-bar [aria-live]')).toHaveText('1/2')
  await expect(query).toBeFocused()
  const replacement = page.getByLabel('替换为')
  await replacement.fill('猫咪')
  await expect(replacement).toBeFocused()
  await page.locator('.editor-find-bar').getByRole('button', {name:'全部', exact:true}).click()
  await expect(editor).toHaveText('猫咪 猫咪')
  await expect(editor).not.toBeFocused()
  await expect(page.locator('.editor-find-bar [aria-live]')).toContainText('/2')
})

test('保护版本写入期间切换笔记会取消旧恢复', async ({page}) => {
  await seedCachedVault(page, 'A 当前正文', false, 'B 当前正文')
  await expect(page.locator('.desktop-workspace:visible .cm-content')).toHaveText('A 当前正文')
  await page.evaluate(async () => {
    const req = indexedDB.open('swell-note-history', 1)
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('versions', {keyPath:'key'})
      store.createIndex('noteKey', 'noteKey')
    }
    const db = await new Promise<IDBDatabase>((resolve,reject) => {req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})
    const tx = db.transaction('versions', 'readwrite')
    tx.objectStore('versions').put({cacheId:'e2e-vault',content:'A 旧正文',createdAt:Date.now(),id:'switch-old',key:'switch-old',noteId:'webdav:/Swell/测试/第一篇.md',noteKey:'e2e-vault\u0000webdav:/Swell/测试/第一篇.md',reason:'编辑前',title:'第一篇'})
    await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
    db.close()
  })
  await page.getByRole('button',{name:'更多操作',exact:true}).click()
  await page.getByRole('menuitem',{name:/本地版本历史/}).click()
  await expect(page.locator('.note-history-preview pre')).toHaveText('A 旧正文')
  await page.evaluate(() => {
    const originalOpen = indexedDB.open.bind(indexedDB)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    ;(window as Window & { releaseHistory?: () => void }).releaseHistory = release
    indexedDB.open = ((name: string, version?: number) => {
      const request = version === undefined ? originalOpen(name) : originalOpen(name, version)
      if (name === 'swell-note-history') {
        Object.defineProperty(request, 'onsuccess', {
          configurable: true,
          set(callback: ((event: Event) => void) | null) {
            if (callback) request.addEventListener('success', (event) => { void gate.then(() => callback.call(request, event)) }, {once:true})
          },
        })
      }
      return request
    }) as typeof indexedDB.open
  })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button',{name:'恢复此版本',exact:true}).click()
  await expect(page.getByRole('button',{name:'正在保存保护版本…'})).toBeVisible()
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  await page.locator('.desktop-workspace:visible .note-list-row').filter({hasText:'第二篇'}).click()
  await expect(page.locator('.desktop-workspace:visible .cm-content')).toHaveText('B 当前正文')
  await page.evaluate(() => (window as Window & { releaseHistory: () => void }).releaseHistory())
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('swell-note-history', 1)
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const transaction = database.transaction('versions', 'readonly')
    const count = await new Promise<number>((resolve, reject) => {
      const read = transaction.objectStore('versions').count()
      read.onsuccess = () => resolve(read.result)
      read.onerror = () => reject(read.error)
    })
    database.close()
    return count
  })).toBe(2)
  await expect(page.locator('.desktop-workspace:visible .cm-content')).toHaveText('B 当前正文')
  await page.locator('.desktop-workspace:visible .note-list-row').filter({hasText:'第一篇'}).click()
  await expect(page.locator('.desktop-workspace:visible .cm-content')).toHaveText('A 当前正文')
})
