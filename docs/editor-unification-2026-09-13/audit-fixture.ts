// 仅供本机开发验收的显式入口，不被生产 main 引用；写入独立 cacheId，避免覆盖已有笔记。
const cacheId = "unified-audit-20260913"
const body = [
  "---", "tags: [验收, 一体化]", "status: 待验证", "---", "",
  "# 同一画布", "", "普通中文 **加粗**、*斜体* 和 [链接](https://example.com)。", "",
  "## 列表与引用", "", "- 列表第一项", "- 列表第二项", "- [ ] 待完成", "",
  "> 引用第一行", "> 引用第二行", "",
  "> [!tip]+ 操作提示", "> 这里应直接阅读，点击局部编辑时不能改变其他段落。", "",
  "## 表格", "", "| 名称 | 状态 |", "| --- | --- |", "| 苹果 | 新鲜 |", "| 香蕉 | 一般 |", "",
  "## 公式", "", "行内公式 $E=mc^2$ 与中文并排。", "", "$$", "a^2+b^2=c^2", "$$", "",
  "## 图表", "", "```mermaid", "graph LR", "A[阅读] --> B[编辑] --> C[保存]", "```", "",
  "## 普通代码", "", "```js", "const price = '$20';", "```", "",
  "## 嵌入", "", "![[验收乙]]", "", "结尾验收标记-END。",
].join("\n")

document.querySelector<HTMLButtonElement>("#load")!.onclick = async () => {
  const status = document.querySelector<HTMLElement>("#status")!
  try {
    // 验收数据只能搭配假账号，避免在有真实云端配置的浏览器里意外同步测试笔记。
    const config = localStorage.getItem("swell-note:webdav-config:v1")
    if (config && JSON.parse(config).username !== "audit@example.invalid") {
      throw new Error("请使用没有真实云端配置的独立浏览器进行验收")
    }
    const request = indexedDB.open("swell-note-vault-cache", 3)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const db = request.result
        for (const [name, keyPath] of [["vaults", "id"], ["settings", "key"], ["documents", "key"], ["attachments", "key"]]) {
          if (db.objectStoreNames.contains(name)) continue
          const store = db.createObjectStore(name, { keyPath })
          if (name === "documents" || name === "attachments") store.createIndex("cacheId", "cacheId")
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const notes = ["验收甲", "验收乙"].map((title) => ({
      id: `webdav:/Swell/验收/${title}.md`, title, content: "", contentCached: true,
      contentLoaded: false, folder: "验收", preview: title, readOnly: false,
      remotePath: `/Swell/验收/${title}.md`, revision: '"audit-base"', source: "webdav",
      starred: false, syncStatus: "synced", updatedAt: "刚刚",
    }))
    const transaction = database.transaction(["vaults", "settings", "documents"], "readwrite")
    transaction.objectStore("vaults").put({
      activeNoteId: notes[0].id, directories: ["验收"], id: cacheId, label: "一体化离线验收",
      lastSyncedAt: Date.now(), notes, savedAt: Date.now(), sourceKind: "webdav",
    })
    transaction.objectStore("settings").put({ key: "last-cache", value: cacheId })
    notes.forEach((note, index) => {
      const content = index === 0 ? body : "# 被引用的笔记\n\n嵌入正文应可直接阅读。\n\n- [ ] 嵌入任务不应写入宿主笔记。"
      transaction.objectStore("documents").put({
        baseContent: content, cacheId, content, key: `${cacheId}\u0000${note.id}`,
        noteId: note.id, outgoingLinks: [], path: note.remotePath, tags: [], title: note.title,
      })
    })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
    // 只有缺少配置的隔离浏览器才填充假账号以启用离线新建；不保存密码，也不发起同步。
    if (!localStorage.getItem("swell-note:webdav-config:v1")) {
      localStorage.setItem("swell-note:webdav-config:v1", JSON.stringify({
        provider: "jianguoyun", remotePath: "/Swell/", serverUrl: "https://dav.jianguoyun.com/dav/", username: "audit@example.invalid",
      }))
    }
    location.href = "/#/notes"
  } catch (error) {
    status.textContent = `无法载入验收数据：${String(error)}`
  }
}
