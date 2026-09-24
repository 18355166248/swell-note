# Joplin 与 Swell Note：桌面端和 iOS 功能续查

日期：2026-09-24。Swell Note 基线：`44a627f` 及当前工作区；Joplin 基线：3.7 发布说明、当前帮助和 iOS 更新日志。本轮为源码、原生工程、已安装依赖和既有验收记录交叉核对，未重新进行双应用真机测试。已有实现不等于所有平台均已验收；“缺失”表示未找到可供用户使用的完整流程。

## 本轮实施更新

本节记录审计后的代码实现；下方对比表保留审计时的基线。

- 正向 `body:` 已修复：多个正文条件取交集，可与标题/标签及界面范围组合；当前编辑正文优先，未加载正文使用缓存匹配。
- iOS 本地目录选择显式使用 `fileAccessMode: scoped`，避免默认复制模式；仍需真机核对不同文件提供者和重启后的重新授权。
- 整库 ZIP 已统一接入原生保存对话框；取消保存不会报成功，写入失败会展示错误。iOS 原生文件写出与恢复仍待真机验收。
- 桌面和移动端笔记列表新增「批量整理笔记」：勾选/全选当前列表，移动、移入回收站、添加/移除标签。删除二次确认；同名冲突、未保存、只读和不可读取正文逐项报告；移动会修复可读取笔记中的相对链接。
- 批量修改逐篇持久化；WebDAV 保留原路径、同步基线和待同步状态，不在整理操作中直接写远端。离线目标路径由当前库推导，避免切库后误用其他连接配置。
- 验证：构建通过；相关单元测试和桌面/手机浏览器流程通过；本地模拟目录的批量移动→回收站→恢复核对通过。详情见 [实施与验收](batch-organize-2026-09-24.md)。

## 结论

Swell Note 已覆盖日常 Markdown 写作、目录组织、标签、全文检索、WebDAV 同步、附件、回收站和本机版本历史。当前最明显的功能差距集中在收集入口、离线可用性的控制、跨设备恢复、导出交付和系统集成。iOS 的原生交互与文件访问需要单独验收，不能由桌面或浏览器通过推定。

建议先完成 iOS 文件/备份/同步验收，再补分享入口与离线预下载；桌面优先补 PDF/HTML 导出、批量整理和搜索语义。OCR、提醒按使用频率排期，插件、AI 与协作暂列产品选项。

## 已有能力：本轮不再计为缺失

| 能力 | 当前实现与边界 |
| --- | --- |
| Markdown 编辑 | CodeMirror、即时渲染、格式工具栏、可交互表格、查找替换；手机已有“查找当前笔记”触屏入口 |
| 阅读与附件 | 图片缩放、PDF iframe、音视频播放、文件插入与附件队列；PDF 原生 iOS 的翻页与大文件体验尚不能由组件存在推定 |
| 整理 | 目录、收藏、置顶、排序、笔记标签编辑、本地及 WebDAV 跨笔记标签重命名 |
| 检索与跳转 | 标题/正文/标签索引、组合筛选、保存搜索、桌面搜索快捷键；`tag:a tag:b` 已支持同时匹配，不能说仅支持单标签查询 |
| 笔记链接 | 标准相对 Markdown 链接、反向引用；旧 Obsidian 双链/嵌入读取兼容 |
| 同步保护 | 本地工作副本、ETag、三方合并、冲突副本、失败重试和同步中心 |
| 找回数据 | 回收站、最多 30 个本机历史版本及差异、恢复副本、ZIP 备份恢复 |
| 画布 | 已有 Excalidraw 与 Canvas 相关实现；与 Joplin 白板形态不同，不按名称重复建设 |

实现入口：`src/components/workspace/workspace.tsx`、`src/components/editor/markdown-preview.tsx`、`src/services/search/global-search-filter.ts`、`src/services/history/note-history.ts`、`src/App.tsx`。

## iOS 重点差距

| 功能 | Joplin 依据 | Swell Note 当前状态 | 建议 |
| --- | --- | --- | --- |
| 从其他 App 分享到笔记 | iOS 更新日志记录接收分享及图片分享的修复，证明有系统分享入口；不等于完整网页剪藏。[更新日志](https://joplinapp.org/help/about/changelog/ios/) | **缺失**：Apple 工程只定义主应用，未找到 Share Extension、接收分享与导入收件箱流程 | P1：URL、文本、图片、PDF → 选择目录 → 本地保存 → 同步；记录来源地址 |
| 从笔记向外分享 | iOS 更新日志记录分享长笔记时改用文件。[更新日志](https://joplinapp.org/help/about/changelog/ios/) | **部分**：有导出 ZIP/Markdown 的文件流程，未找到系统分享面板桥接；导出不等于可直接选微信、邮件等目标 | P1：文本/文件分享与“存储到文件”各自可用 |
| 拍照扫描、多页收集 | 移动端支持连续拍摄多页并建立笔记；识别增强另有服务条件。[扫描说明](https://joplinapp.org/help/apps/scan_notebook/) | **缺失专用流程**：附件选择已有；未找到多页扫描、页面排序和扫描结果创建笔记 | P2：先拍照、多图合并，按需求再做文档扫描；不能承诺现有选择器完全不能拍照 |
| 应用内录音 | iOS 日志记载录音及后台录音改进。[更新日志](https://joplinapp.org/help/about/changelog/ios/) | **缺失**：音频播放已有，未找到录音、麦克风授权和录音文件入库 | P2：会议记录场景再做 |
| Face ID / Touch ID 应用锁 | iOS 已有生物识别锁。[更新日志](https://joplinapp.org/help/about/changelog/ios/) | **缺失**：Keychain 存储 WebDAV 凭据已有；未找到笔记界面的生物识别解锁流程 | P1/P2：按隐私需求排期；应用锁与正文加密分别定义 |
| 整库/指定目录离线准备 | Joplin 附件提供 Always / Auto / Manual 下载策略。[附件说明](https://joplinapp.org/help/apps/attachments/) | **部分**：“完整离线缓存”文案实际说明保存已读取正文和附件；没有发现“下载全部附件/指定目录离线就绪”的产品入口 | P1：下载范围、字节数、进度、重试及完成标识；飞行模式验证从未打开的笔记与附件 |
| 横屏、iPad 键盘体验 | 本轮不对 Joplin iPad 各种窗口模式作完整支持承诺 | **明确限制/待验收**：iPhone 配置仅竖屏；iPad 允许横竖屏但缺完整验收证据。全局快捷键按视口宽度跳过手机布局 | P1：先补外接键盘、长文选区、旋转与安全区测试，再决定开放 iPhone 横屏 |
| 独立富文本编辑模式 | Joplin 移动端也可选择 Rich Text 编辑器。[编辑器说明](https://joplinapp.org/help/apps/rich_text_editor/) | **模式差异**：当前主线是 Markdown + 即时渲染，没有独立富文本模式；现有编辑能力不应因此整体判缺失 | P2：只有非 Markdown 用户确有需求时再做 |

原生证据：`src-tauri/gen/apple/project.yml`、`src-tauri/gen/apple/swell-note_iOS/Info.plist`、`src-tauri/gen/apple/swell-note_iOS/swell-note_iOS.entitlements`、`src-tauri/src/lib.rs`。附件与缓存证据：`src/components/editor/markdown-preview.tsx:839`、`src/components/routes/app-pages.tsx:686`、`src/App.tsx:1049`。

## 桌面端与两端共通差距

| 功能 | Joplin 依据 | Swell Note 当前状态 | 建议 |
| --- | --- | --- | --- |
| PDF / HTML 导出 | 官方支持这些交付格式。[导入导出](https://joplinapp.org/help/apps/import_export/) | **缺失**：目前以 Markdown、单篇附件 ZIP、整库 ZIP 为主；未找到 PDF/HTML 导出及打印入口 | P1，桌面优先；验证中文字体、图片、表格分页和数学公式 |
| 网页剪藏 | 桌面配合浏览器扩展保存网页。[Web Clipper](https://joplinapp.org/help/apps/clipper/) | **缺失**：没有剪藏扩展、正文提取和采集流程 | P1/P2：先 URL/选中文本收集，再正文提取 |
| 历史跨设备恢复 | 历史会随同步传播；iOS 13.4.1 已加入 revision viewer。[历史](https://joplinapp.org/help/apps/note_history/)、[iOS 日志](https://joplinapp.org/help/about/changelog/ios/) | **部分**：当前每篇最多 30 个版本，仅本机，整库 ZIP 不包含历史；换设备无法取回这些版本 | P1：可选历史归档与保留策略；同时明确附件历史的恢复边界 |
| 高级搜索 | 支持 OR、日期范围、待办状态、附件类型等语法。[搜索](https://joplinapp.org/help/apps/search/) | **部分**：已有组合筛选及限定词，尚不覆盖 `any:`、`created:`、`due:`、`resource:` 等；正向 `body:` 还有语义缺口，见下文 | P1：先保证已展示语法正确，再逐步扩展 |
| 批量整理 | 本轮确认的是 Swell Note 自身缺口，未给 Joplin iOS 批量操作范围作全面对等承诺 | **部分**：回收站批量恢复、跨笔记重命名标签已有；普通笔记列表未找到多选后批量移动/删除/赋标签入口 | P1，桌面先做、iOS 长按进入选择模式 |
| 提醒与到期任务 | 桌面与移动端的待办均可设置闹钟并触发系统通知。[待办](https://joplinapp.org/help/apps/to-dos/)、[通知](https://joplinapp.org/help/apps/notifications/) | **部分**：只有 Markdown 勾选任务与汇总；任务模型无到期时间，未找到本地通知调度 | P2；先定义同步后的提醒归属、时区和取消语义 |
| 图片/PDF OCR 搜索 | 桌面识别，移动端通过同步获得结果并可搜索。[OCR](https://joplinapp.org/help/apps/ocr/) | **缺失**：当前索引来自笔记正文/元数据；附件可显示不等于附件文本可检索 | P2；桌面识别与索引同步，手机消费结果 |
| 完整迁移 | 支持 Markdown 目录、ENEX 等导入；3.7 增加 Obsidian Vault 导入。[导入导出](https://joplinapp.org/help/apps/import_export/)、[3.7](https://joplinapp.org/news/20260831-release-3-7/) | **部分**：直接打开本地 Vault、批量 `.md` 导入已有；没有 JEX/ENEX 迁移器和完整迁移核验报告 | P1/P2：先核验附件、目录、标签、时间戳和笔记链接 |
| 从系统或其他工具打开特定笔记 | Joplin 有外部 URL 协议。[外部链接](https://joplinapp.org/help/apps/external_links/) | **缺失原生入口**：Hash 路由能在应用内定位；未找到原生 URL scheme 注册和系统深链分发 | P2：从日历、待办、快捷指令打开笔记 |
| 外部编辑器联动 | 桌面可直接调用指定编辑器。[外部编辑器](https://joplinapp.org/help/apps/external_text_editor/) | **部分**：普通 Markdown 本就可外部编辑，且本地 Vault 有监听；未找到应用内“用外部编辑器打开”入口 | P2：补入口即可，保留现有变更冲突保护 |
| E2EE | Joplin 支持端到端加密。[加密](https://joplinapp.org/help/apps/sync/e2ee/) | **缺失**：HTTPS 和系统凭据库不提供笔记正文 E2EE | 产品决策：可读 Markdown 远端与加密库需明确区分 |
| 插件 / AI / 协作 | Joplin 有插件；3.7 桌面加入 AI Beta、语义搜索、MCP；Cloud 提供协作。[插件](https://joplinapp.org/help/apps/plugins/)、[3.7](https://joplinapp.org/news/20260831-release-3-7/)、[协作](https://joplinapp.org/help/apps/share_notebook/) | **缺失对应平台能力**：内部 CodeMirror 扩展不算用户插件系统 | P3；不应排在文件可靠性和收集入口之前 |

源码证据：`src/services/export/markdown-export.ts`、`src/services/import/markdown-import.ts`、`src/services/search/global-search-filter.ts`、`src/services/search/saved-searches.ts`、`src/services/history/note-history.ts`、`src/services/tasks/markdown-tasks.ts`、`src/components/workspace/workspace.tsx`、`src/services/vault/local-vault-adapter.ts`。

## 三项需要单独处理的实现问题或验收缺口

### 1. 正向 `body:` 没有真正限定正文

`parseGlobalSearchQuery` 识别 `body:` 后，正向分支仍将原始 token 放入普通查询 `text`，随后 `join(" ")`。所以 `body:苹果` 留下的查询仍是 `body:苹果`，并不会变成正文范围中的“苹果”。负向 `-body:` 有专门分支；界面的正文范围选择也已有实现。

证据：`src/services/search/global-search-filter.ts:41`。这是源码可确认的语义缺口，本轮没有运行 UI 复现。建议定义前缀与界面筛选的组合规则，并覆盖“标题含词但正文不含词”的验收用例。保存搜索仍只存当前设备，也应保持明确说明。

### 2. iOS 本地 Vault 的“打开原目录”语义尚不明确

`selectTauriVault` 使用 `open({ directory: true, multiple: false, recursive: true })`，没有显式指定 `fileAccessMode`。已安装的 Tauri dialog 2.7.2 声明默认是 `copy`：复制进沙盒；`scoped` 才保留原位置访问。因此不能把 iOS 本地目录入口视为已验证的“原位编辑 iCloud/文件 App 目录”。

证据：`src/services/vault/local-vault-adapter.ts:212`；依赖 `node_modules/@tauri-apps/plugin-dialog/dist-js/index.d.ts` 的 `fileAccessMode` 说明。具体目录供应商行为仍需真机观察，不能仅凭这一点宣称目录打开必然失败。验收必须包含：选目录→编辑→文件 App 核对原文件→终止进程→重启→再次读写。

### 3. iOS 备份导出尚未形成可验证的交付承诺

单篇导出调用原生 `save()` 后写文件。已安装依赖的 Swift `DialogPlugin.saveFileDialog` **确实实现了 iOS 分支**，不能套用旧版本结论说 iOS 不支持保存对话框。但仍需验证文件提供者权限、实际写出内容及取消行为。

整库备份则在 `src/App.tsx:4463` 使用 Blob + `<a download>`，没有 iOS 专用的文件保存/分享分支。已有桌面验收不能证明 WKWebView 中文件已保存到用户可找回的位置。验收需从“文件”App 取回 ZIP 并恢复到隔离测试库，比较正文和附件哈希。

备份现状更新：最新[演练记录](backup-rehearsal-2026-09-24.md)已完成 macOS 真实库的**不完整**导出与隔离恢复，113 篇笔记、13 个附件共 126 文件哈希一致；仍缺 6 个引用附件，完整备份门槛未过。旧盘点中的“9 个缺失、桌面尚待验收”已不能代表最新进展。

## 对 Joplin 平台能力的校正

- **移动后台同步**：官方 FAQ 明确说明应用进入后台或设备休眠会中断同步，不能把“锁屏持续同步”列为 Joplin 已有的领先功能。[FAQ](https://joplinapp.org/help/faq/)
- **iOS 历史查看**：帮助页仍说只能在桌面看历史，但更新日志明确在 iOS 13.4.1 加入 revision viewer。本次以更新日志纠正旧帮助页，不把 iOS 历史查看判为缺失。[iOS 日志](https://joplinapp.org/help/about/changelog/ios/)
- **OCR**：桌面负责识别，iOS 搜索同步后的 OCR 文本；不等于手机本机自动 OCR。扫描笔记的转写服务另有条件。[OCR](https://joplinapp.org/help/apps/ocr/)、[扫描](https://joplinapp.org/help/apps/scan_notebook/)
- **插件与协作**：iOS 只允许推荐插件；Cloud 帮助页将发起共享放在桌面，移动端可使用已共享笔记本，不能默认两端管理能力相同。[插件](https://joplinapp.org/help/apps/plugins/)、[协作](https://joplinapp.org/help/apps/share_notebook/)
- **大附件**：Joplin 附件帮助仍提示移动端大于 10 MB 的限制；未实测新版实际边界，因此不作 Joplin 大附件全面优于 Swell Note 的判断。[附件](https://joplinapp.org/help/apps/attachments/)

## 建议下一轮实施与验收顺序

1. **P0：验证数据能保存、能带走、能恢复。** iOS 原生目录语义、ZIP 导出/恢复、后台切回、弱网与双设备并发编辑；沿用隔离测试库。现有 iOS 模拟器已验证中文/表格/文末避让等具体路径，真机连续输入和复杂选区仍待补齐，见 [iOS 检查](ios-editor-check-2026-09-23.md)。
2. **P1：补日常收集和交付。** iOS 分享导入/导出、离线预下载；桌面 PDF/HTML 导出；修复 `body:` 语义并补批量整理。验收以“用户完成一次实际任务”为单位。
3. **P1：补跨设备恢复。** 历史归档、保留和恢复策略；修正或补齐真实库的 6 个缺失附件引用后重跑完整备份验收。
4. **P2：按场景补 OCR、提醒、扫描、录音、应用锁。** 扫描资料多优先 OCR，任务多优先提醒；应用锁可独立于 E2EE 落地。
5. **P3：再评估生态能力。** 插件、AI/MCP、公开发布和多人协作，需独立产品范围与数据模型设计。

本轮产物为功能审计，未修改产品代码，也未执行新的构建、自动测试或真机验证。以上优先级是基于桌面+iOS 个人笔记场景的建议。
