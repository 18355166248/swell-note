# Swell Note

一个本地优先、兼容普通 Markdown 文件的跨端笔记应用。目标平台包括 macOS、Windows、Android、iOS 和 Web，远端同步使用 WebDAV。

## 当前状态

- Tauri 2 + React 19 + TypeScript + Vite 基础工程
- Tailwind CSS 4 与 shadcn/ui（Nova / Radix）
- 宽屏四栏、平板三栏与手机三级页面的响应式笔记界面
- 笔记搜索、选择、收藏，以及可写本地 Vault 中的真实 Markdown 新建与编辑
- CodeMirror 6 Markdown 编辑器与光标位置格式插入
- 坚果云 WebDAV 参数配置、递归目录扫描、Markdown 按需读取与限速后台全文索引
- Web / Tauri 统一笔记库适配层，可选择并递归读取现有本地 Obsidian Vault
- 本地笔记自动保存、文件版本校验、冲突副本与源文件重新加载
- 本地 / WebDAV 后台全文索引、搜索正文和 Obsidian `[[双向链接]]` 反向引用
- GFM Markdown 阅读预览、任务列表、表格与可跳转 Wiki 链接
- 本地 Vault 与坚果云相对路径图片、Obsidian 图片嵌入预览
- PDF、音频、视频与普通附件按需读取，避免打开笔记时自动下载大文件
- 本地 Vault / 坚果云图片粘贴、文件拖入与工具栏选择上传，写入 `attachments/` 并插入相对路径引用
- 从实际 Vault 路径生成文件夹层级、递归计数与目录筛选
- 本地 Vault 支持空文件夹创建、目录重命名与递归删除，浏览器和桌面端保持一致
- 独立回收站支持批量恢复、永久清理与 7/30/90 天或永久保留；本地文件使用隐藏目录安全暂存
- 原生端使用内置 SQLite FTS 持久化全文索引并按 Vault 隔离，Web 端自动回退内存搜索
- 桌面和移动端笔记列表统一虚拟化，只渲染视口附近条目以支撑大型笔记库
- IndexedDB 离线 Vault 缓存、刷新自动恢复与多缓存切换
- 手动、联网恢复或防抖后台同步，并保留当前文档、目录、搜索和已读取正文
- 本机同步日志、同步前可撤销删除与冲突保护
- 坚果云文件夹批量重命名、待删除队列与同步时按需创建远端目录
- Web PWA 安装清单与生产环境离线应用壳
- Hash 路由导航：笔记、Markdown 待办、设置，以及 WebDAV / 缓存 / 关于二级设置页
- 笔记详情、文件夹、最近更新和收藏二级路由，支持刷新恢复
- 本地 Markdown 待办勾选写回、文件移动与二次确认永久删除
- Tauri 原生 HTTP 接入，WebDAV 在 macOS、Windows、Android、iOS 中不依赖 WebView CORS
- Android Studio 与 Xcode 工程；已通过 arm64 Android 调试 APK 和 iOS arm64 模拟器包构建

默认不注入任何演示笔记；连接坚果云或打开本地目录后，界面只展示真实 Vault 数据。坚果云采用本地工作副本与带 ETag 校验的安全同步，自动同步默认关闭，可在设置中选择联网恢复或后台防抖模式。附件统一写入 Vault 根目录的 `attachments/`，正文使用标准 Markdown 相对路径引用，单个附件上限 20MB；坚果云附件先进入 IndexedDB 离线队列，同步时先上传附件再上传引用正文。文件列表和已打开正文会写入本机 IndexedDB；Web 端应用密码仅存在于当前会话，原生端可由用户选择保存到系统凭据库，均不会写入笔记缓存。

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

当前仓库已经包含生成后的 Android / iOS 工程，一般不需要再次初始化。移动端调试构建：

```bash
pnpm build:android:debug
pnpm build:ios:sim
```

基础自测：

```bash
pnpm test
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 技术边界

- Markdown 文件是用户数据的事实来源，不能依赖私有数据库才能读取。
- SQLite 只保存搜索索引、同步元数据和可重建缓存。
- 所有编辑优先落本地，WebDAV 同步失败不能阻塞编辑。
- WebDAV 写入需要使用 ETag / `If-Match` 防止静默覆盖。
- 无法自动合并的修改必须保留冲突副本。
- WebDAV 应用密码不能写入源码或浏览器 localStorage；原生端使用系统安全存储。

## 后续增强

1. 增加 SQLite 索引增量迁移、统计与损坏自动重建工具。
2. 补齐附件引用清理与未使用附件巡检。
3. 补齐应用商店签名、发布账号与自动发布流水线。
