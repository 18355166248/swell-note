# Swell Note

一个本地优先、兼容普通 Markdown 文件的跨端笔记应用。目标平台包括 macOS、Windows、Android、iOS 和 Web，远端同步使用 WebDAV。

## 当前状态

- Tauri 2 + React 19 + TypeScript + Vite 基础工程
- Tailwind CSS 4 与 shadcn/ui（Nova / Radix）
- 宽屏四栏、平板三栏与手机三级页面的响应式笔记界面
- 笔记搜索、选择、收藏，以及可写本地 Vault 中的真实 Markdown 新建与编辑
- CodeMirror 6 Markdown 编辑器与光标位置格式插入
- 坚果云 WebDAV 参数配置、递归目录扫描与 Markdown 按需读取
- Web / Tauri 统一笔记库适配层，可选择并递归读取现有本地 Obsidian Vault
- 本地笔记自动保存、文件版本校验、冲突副本与源文件重新加载
- 本地后台全文索引、搜索正文和 Obsidian `[[双向链接]]` 反向引用
- GFM Markdown 阅读预览、任务列表、表格与可跳转 Wiki 链接
- 本地 Vault 与坚果云相对路径图片、Obsidian 图片嵌入预览
- 从实际 Vault 路径生成文件夹层级、递归计数与目录筛选
- IndexedDB 离线 Vault 缓存、刷新自动恢复与多缓存切换
- 在线整库手动刷新，并保留当前文档、目录、搜索和已读取正文
- Hash 路由导航：笔记、Markdown 待办、设置，以及 WebDAV / 缓存 / 关于二级设置页
- 笔记详情、文件夹、最近更新和收藏二级路由，支持刷新恢复
- 本地 Markdown 待办勾选写回，以及非当前离线缓存删除
- macOS / Windows 桌面端构建基础

默认不注入任何演示笔记；连接坚果云或打开本地目录后，界面只展示真实 Vault 数据。坚果云当前保持只读。文件列表和已打开正文会写入本机 IndexedDB，WebDAV 应用密码只存在于当前连接会话，不会写入缓存。

## 本地运行

```bash
pnpm install
pnpm dev
```

启动桌面应用：

```bash
pnpm tauri dev
```

生产构建：

```bash
pnpm build
pnpm tauri build
```

初始化移动端工程：

```bash
pnpm tauri android init
pnpm tauri ios init
```

## 技术边界

- Markdown 文件是用户数据的事实来源，不能依赖私有数据库才能读取。
- SQLite 只保存搜索索引、同步元数据和可重建缓存。
- 所有编辑优先落本地，WebDAV 同步失败不能阻塞编辑。
- WebDAV 写入需要使用 ETag / `If-Match` 防止静默覆盖。
- 无法自动合并的修改必须保留冲突副本。
- WebDAV 应用密码不能写入源码或浏览器 localStorage；原生端使用系统安全存储。

## 下一阶段

1. 扩展 PDF、音频等非图片附件预览。
2. 将内存索引迁移到 SQLite，支持更大规模笔记库。
3. 实现 WebDAV 增量同步、冲突检测与同步日志。
