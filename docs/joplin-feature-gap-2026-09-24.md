# Swell Note 与 Joplin 功能对比（2026-09-24）

范围：基于当前仓库代码与 Joplin 3.7 官方文档做静态功能盘点；未做两款应用的并排真机体验测试。这里的“缺失”指当前仓库没有对应的完整产品流程，不等于底层完全没有相关代码。

进展：备份完整性核对与单篇笔记标签编辑已实施。缺少笔记正文或引用附件时会停止 ZIP 下载并显示清单；标签写回 Markdown frontmatter，沿用现有保存和同步流程。仍需真实 Vault 的端到端恢复演练。

## 已覆盖的基础能力

| 能力 | Swell Note 当前状态 | 判断 |
| --- | --- | --- |
| 本地优先、跨端、离线编辑 | 本地 Markdown Vault / IndexedDB 工作副本，Tauri 桌面和移动端、Web/PWA | 已具备，需真机稳定性验证 |
| 多设备同步 | WebDAV，ETag 条件写入、三方合并、冲突副本、失败重试 | 已具备；支持的同步目标少于 Joplin |
| Markdown 编辑与附件 | CodeMirror、预览、表格、任务勾选、图片和文件附件、Excalidraw | 已具备；编辑器复杂交互仍有专项验证项 |
| 搜索 | 本地 SQLite FTS / Web 缓存索引、全局标题/正文/标签/目录筛选 | 已具备基础搜索；没有 Joplin 式组合查询语法 |
| 历史、回收站、备份 | 本地版本历史与逐行差异、回收站、整库备份恢复 | 已具备；历史仅当前设备保留最多 30 个版本 |
| 导入导出 | `.md` 批量导入、单篇带附件导出、整库备份 | 已具备 Markdown 主路径；迁移元数据与其他格式不完整 |

## 推荐优先级

### P0：先把数据可信度和移动端编辑稳定性做成可验证的承诺

1. **iOS/Android 真机编辑与同步回归。** 重点跑中文输入法组合、键盘弹收、切换笔记、后台恢复、附件插入、同步同时编辑、弱网重试与冲突恢复。现有 `docs/editor-joplin-evaluation.md` 明确记录了 iOS 真机验收未完成；这些风险比新增功能更直接影响笔记安全。给每种场景保留可复现脚本、设备/系统版本和结果，作为发布门槛。
2. **历史版本的跨设备恢复。** 当前 `note-version-history-dialog.tsx` 明示“版本仅保存在当前设备，最多保留 30 个”；Joplin 的历史版本会随同步跨设备保存。优先明确产品承诺：若仍只保留本机历史，在同步设置、历史页和备份页明确提示；若要追平，设计基于普通 Markdown 的可选版本归档、保留期限与清理策略，避免把数据库变成正文唯一来源。
3. **备份完整性结果。** 原实现允许跳过不可读笔记/附件，部分情况仍返回成功。现已改为导出前核对并阻止不完整 ZIP；下一步是恢复前清单预览，以及真实 Vault 的“导出→空库恢复→文件哈希比对”验收。

### P1：完善笔记整理、找回与迁移的闭环

4. **标签管理。** 已有笔记级 frontmatter 标签编辑、显示和筛选；待补批量赋标签、跨笔记重命名和标签管理页。继续以 Markdown frontmatter 为事实来源，保留未知字段与原有正文。
5. **组合搜索与快速跳转。** 全局搜索现可组合范围、目录、单标签、更新时间与收藏状态；尚无 `title:`、`tag:`、排除词、精确短语等查询语法和保存搜索。后续应补语法与清晰的索引未就绪提示，并实测中文大库的性能和召回。Joplin 提供丰富查询语法和 Goto Anything。
6. **迁移完整性。** 现有 `.md` 导入和整库备份适合 Swell Note 自身；从 Joplin/Obsidian 迁移时，标签、时间戳、笔记间链接与附件路径需要专门映射与核验。先做目录级 Markdown + 附件导入预览及迁移报告，再评估 JEX/ENEX 导入。保持普通 Markdown 作为最终数据格式。

### P2：按目标用户选择扩展

7. **网页采集。** Joplin 有浏览器剪藏。Swell Note 可先做“分享 URL/选中文本→笔记”及来源地址字段，再决定是否做浏览器扩展与正文提取；这是知识收集频繁用户的高价值入口。
8. **任务与提醒。** 当前是 Markdown 行内待办汇总；Joplin 还有独立待办笔记、完成状态、提醒和通知。若待办是主场景，优先在标准 frontmatter 中定义到期时间和提醒语义，再做跨端通知。若不是主场景，保持轻量待办即可。
9. **附件 OCR。** Joplin 可对图片/PDF 做本地 OCR，并在桌面和移动端搜索识别文本。适合扫描资料多的用户；先做可选桌面离线索引与搜索命中提示，避免大附件在手机端耗电。

### 暂不按“功能数量”追平

- **端到端加密：** Joplin 支持全平台 E2EE；Swell Note 的核心承诺是远端可读的普通 Markdown。加密会改变这个承诺，应作为独立的“加密库”产品决策，不宜直接塞进现有 WebDAV 同步管线。WebDAV HTTPS 和系统凭据存储不等于 E2EE。
- **插件平台、AI/MCP、分享协作：** Joplin 3.7 已覆盖这些方向，但 Swell Note 目前更需要守住编辑和同步可信度。只有在用户画像和使用频率证据支持后再排期；可先把内部渲染器接口、搜索接口保持清晰。
- **白板：** Swell Note 已有 Excalidraw 集成；Joplin 3.7 的白板是另一种形式。优先确认画布在移动端的阅读、编辑、附件和同步体验，不按名称重复开发。

## 建议的下一轮实施顺序

1. 真机稳定性与灾备验收（发布门槛）。
2. 标签编辑 + 组合搜索（最小可交付的整理/找回闭环）。
3. Markdown 目录迁移报告 + 附件核验。
4. 依据实际用户行为选择剪藏、提醒或 OCR 其中一项。

## 主要证据

- Swell Note：`README.md`、`src/components/workspace/global-search-dialog.tsx`、`src/services/search/global-search-filter.ts`、`src/components/workspace/note-version-history-dialog.tsx`、`src/App.tsx` 的整库备份/恢复流程、`docs/editor-joplin-evaluation.md`。
- Joplin：[3.7 发布说明](https://joplinapp.org/news/20260831-release-3-7/)、[搜索](https://joplinapp.org/help/apps/search/)、[待办](https://joplinapp.org/help/apps/to-dos/)、[笔记历史](https://joplinapp.org/help/apps/note_history/)、[OCR](https://joplinapp.org/help/apps/ocr/)、[端到端加密](https://joplinapp.org/help/apps/sync/e2ee/)、[插件](https://joplinapp.org/help/apps/plugins/)、[导入导出](https://joplinapp.org/help/apps/import_export/)。
