import type { Note } from "@/types/note"
import { extractWikiLinks } from "@/services/search/note-index"

const notes: Note[] = [
  {
    id: "welcome",
    title: "欢迎使用 Swell Note",
    preview: "这是一个本地优先、兼容 Markdown 的跨端笔记应用。",
    content: `# 欢迎使用 Swell Note

这是一个本地优先、兼容 Markdown 的跨端笔记应用。

## 第一阶段目标

- 保留普通 Markdown 文件
- 本地离线编辑
- 通过 WebDAV 安全同步
- 支持 macOS、Windows、Android、iOS 和 Web

> 当前页面是交互式产品壳层，下一步会接入真实文件系统和编辑器。`,
    updatedAt: "今天 10:24",
    starred: true,
  },
  {
    id: "ideas",
    title: "产品灵感",
    preview: "记录对移动端快速输入、双向链接和每日笔记的想法。",
    content: `# 产品灵感

## 快速输入

移动端启动后直接进入输入状态，减少选择和跳转。

## 双向链接

使用 [[笔记标题]] 建立关联，底部展示反向链接。`,
    updatedAt: "昨天 18:42",
    starred: false,
  },
  {
    id: "sync",
    title: "WebDAV 同步设计",
    preview: "本地文件为事实来源，使用 ETag 和 If-Match 避免覆盖远端修改。",
    content: `# WebDAV 同步设计

1. 所有编辑先写入本地文件。
2. 同步任务读取服务器 ETag。
3. 上传使用 If-Match，冲突时保留两个副本。
4. 同步失败不阻塞继续编辑。

相关：[[欢迎使用 Swell Note]]`,
    updatedAt: "8 月 20 日",
    starred: true,
  },
  {
    id: "reading",
    title: "待读清单",
    preview: "收集值得深入阅读的文章、书籍和技术资料。",
    content: `# 待读清单

- [ ] Local-first software
- [ ] WebDAV RFC 4918
- [ ] CodeMirror 6 architecture`,
    updatedAt: "8 月 18 日",
    starred: false,
  },
]

export const demoNotes: Note[] = notes.map((note) => ({
  ...note,
  outgoingLinks: extractWikiLinks(note.content),
  searchText: note.content.toLocaleLowerCase(),
}))
