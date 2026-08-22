# Swell Note

一个本地优先、兼容普通 Markdown 文件的跨端笔记应用。目标平台包括 macOS、Windows、Android、iOS 和 Web，远端同步使用 WebDAV。

## 当前状态

- Tauri 2 + React 19 + TypeScript + Vite 基础工程
- Tailwind CSS 4 与 shadcn/ui（Nova / Radix）
- 宽屏四栏、平板三栏与手机三级页面的响应式笔记界面
- 笔记搜索、选择、新建、编辑和收藏交互
- CodeMirror 6 Markdown 编辑器与光标位置格式插入
- 坚果云 WebDAV 参数配置、递归目录扫描与 Markdown 按需读取
- macOS / Windows 桌面端构建基础

默认展示内置演示数据。连接坚果云后会切换为远端 Markdown 只读列表；上传同步和原生密码安全存储尚未接入。

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

1. 设计统一的文件系统适配层，支持 Tauri 与浏览器文件能力。
2. 读取现有 Obsidian Vault，兼容附件与 `[[双向链接]]`。
3. 建立 SQLite 索引和本地全文搜索。
4. 实现 WebDAV 增量同步、冲突检测与同步日志。
