# Swell Note 当前编辑体验复核与 Joplin 对照

日期：2026-09-22。源码基线：`1f3213f`。本轮做评估与复现，未修改产品实现。审计期间工作区出现的 `src/App.css` 改动不属于本轮，未改动或回滚。

后续核对（2026-09-23）：B1–B4 的对应实现仍未修复。`b3a43f6` 已加入编辑字号与行宽偏好，所以下文“长文阅读与写作”一行描述的是审计当天的状态，不再是当前待办。

结论：常用 Markdown 编辑能力已经较齐全，下一轮应先补可靠性：历史恢复保护、查找状态一致性、附件失败重试。随后改善同步期间的连续写作、历史恢复与单篇导出。现有证据不支持现在更换编辑内核。

## 本轮确认的缺陷

### B1 · P1：恢复历史版本未等保护副本保存成功

- 用户看到的承诺：确认框说“当前正文会先保存为一个历史版本”。
- 实际：`src/App.tsx:3124` 中异步调用 `saveNoteVersion`，不等待完成，且吞掉失败；随即用旧版本覆盖当前正文。
- 复现：在隔离测试库植入旧版本，仅对 reason 为“恢复前”的 IndexedDB 写入注入 `QuotaExceededError`。确认恢复后，当前正文仍被换成旧版本，界面没有阻止此次恢复。
- 影响：存储不足或历史库故障时，用户以为有保护副本，实际没有可靠的持久恢复保障。不能据此声称所有情况下正文都永久不可恢复；本轮未验证撤销等其他路径。
- 建议：先等待保护副本持久化成功，再应用恢复；失败保留原文并显示重试。提供“恢复为副本”也值得优先考虑。异步过程需要固定目标笔记/库身份，防止等待期间切换笔记后写错。
- 验收：注入写入失败时当前正文逐字不变、明确报错；正常恢复时可查到恢复前版本；等待期间切笔记不误写。

### B2 · P2：全部替换后错误显示无匹配，操作按钮被禁用

- 复现：正文“猫 猫”→查找“猫”→全部替换为“猫咪”。正文正确变成“猫咪 猫咪”，但查找栏显示“无匹配”，仍然存在的两个匹配不能通过上下项按钮导航。
- 根因：`src/components/workspace/workspace.tsx:2645` 无条件把匹配结果归零，未按替换后的正文重算。
- 建议：替换事务完成后更新匹配集合与当前位置，并反馈本次实际替换数量。
- 验收：替换文本仍含原查询、替换文本相同、替换为空三种情况均正确；撤销后计数也恢复。

### B3 · P2：查找栏不跟随正文编辑更新

- 复现：正文“猫”→查找显示 `1/1`→回正文追加“ 猫”。正文已经两个匹配，查找栏仍为 `1/1`。
- 根因：`src/components/workspace/workspace.tsx:2280` 的查找 effect 不订阅正文变更；用于等待编辑器挂载的 observer 在首次查找后就断开。
- 影响：边查边改时计数过期；原本无匹配再输入目标词时，也缺少自动恢复查找操作的更新路径。
- 建议：订阅编辑器文档事务，按需刷新匹配，不要每次输入都跳回第一个匹配、移动光标或抢走焦点。
- 验收：添加、删除、撤销、重做后匹配数更新，正文输入焦点和选区保持。

### B4 · P2：兼容阅读中的附件“重试读取”没有真正重试

- 位置：`src/components/editor/markdown-preview.tsx:839` 的 `VaultAttachment`。这是附件阅读组件，区别于已经完善的附件写入队列。
- 复现：首次打开 PDF 附件时 resolver 返回 null，按钮变成“重试读取附件”；再点击，resolver 调用次数仍为 1，预期为 2。
- 根因：第一次点击已将 `requested` 设为 true，重试仍执行 `setRequested(true)`，effect 依赖没有变化。
- 影响：临时网络或缓存读取失败后，用户点重试没有作用，需要离开再回来等额外操作。
- 建议：引入重试序号或显式加载命令，并保持对象 URL 释放和过期请求守卫。
- 验收：首次失败后点击能重新读取；连续点击加载中不重复请求；卸载后结果不回写。

## 已有能力与真正需要完善的地方

| 维度 | Swell Note 在 2026-09-22 的状态 | Joplin 对照或建议 | 优先级 |
| --- | --- | --- | --- |
| 连续写作 | 本地保存不锁正文；WebDAV 的 saving 状态锁正文，测试明确验证了这一策略。慢同步可能中断输入 | Joplin 官方说明采用后台同步。Swell 应将待同步快照与持续输入分离；不能仅删只读判断，必须避免旧快照覆盖新输入 | P2，涉及数据一致性，单独切片 |
| 历史恢复 | 本机 IndexedDB，最多 30 个；自动“编辑前”版本间隔 5 分钟。界面仅显示增删行数及旧全文，恢复覆盖当前笔记 | Joplin 历史跨设备同步，默认保留 90 天，恢复到 Restored Notes 中。先补安全恢复和逐行差异，再设计历史同步及可配置保留策略 | B1 先修；增强 P2 |
| 单篇交付 | 当前导出只写 `.md` 正文，未打包相对路径附件。已有整库 ZIP 备份，不能说完全没有附件备份 | 单篇发给别人时图片/附件容易缺失。补单篇 Markdown+附件包，再补 HTML/PDF。Joplin 已提供 HTML/PDF 导出 | P2 |
| 查找替换 | 已有查找、上一项/下一项、单次/全部替换；匹配固定为不区分大小写的字面匹配 | 先修 B2/B3。再增加区分大小写、全词、选区范围，以及独立于正文选区的全部匹配高亮；正则可后置。这些是 Swell 使用建议，本轮未逐项实测 Joplin 查找 UI | P2/P3 |
| 附件阅读 | 兼容阅读已支持 PDF、音频、视频按需预览；不能记成“完全不支持”。该能力目前位于独立预览组件 | Joplin 官方提供内嵌媒体预览及附件下载策略。Swell 先修 B4，再评估统一画布中的附件预览入口与离线状态提示 | P2/P3 |
| 长文阅读与写作 | 有大纲、字数、源码切换；当前偏好中未见编辑字号、正文行宽、行距设置 | 提供本机显示偏好，减少长文疲劳；不需要为此引入逐字字号、字体颜色等富文本存储 | P3 |
| 移动端 | 已有简化工具栏、链接面板、表格单元格编辑、源码模式；真实 iOS/WKWebView 验证仍不足 | 优先真机验证中文输入、软键盘、表格横滚、选区及多次返回。必要时为窄屏表格提供独立编辑面板 | 验证优先；不能当作已复现 bug |

同步只读依据：`src/components/workspace/workspace.tsx:294`、`src/components/workspace/saving-editability.test.tsx`；WebDAV 队列开始事件见 `src/App.tsx:2093` 附近。导出依据：`src/services/export/markdown-export.ts:12`。历史 UI 依据：`src/components/workspace/note-version-history-dialog.tsx`。查找匹配依据：`src/components/editor/markdown-editor.tsx:1789`。

## 不应重复登记的旧问题

- 源码模式、可见附件队列、失败项重试、粘贴图片位置、附件引用补插已有实现。本轮没有把这些再列成缺项；也没有重验其全部边界。
- 旧 e2e“长表格添加行失败”：本轮原测试仍失败，但截图中按钮可见。菜单现在挂到 `document.body`，测试仍在 table 子树查找。仅把定位改到 page 后整条流程通过，包括添加到 61 行。这是测试定位过时。
- 旧 e2e“标题设置失败”：原测试要求即时预览 DOM 含 `##`，实际渲染隐藏标记。补充流程通过界面切到源码核对，设置二级标题、取消为正文、原光标位置继续输入均通过。本轮桌面样例不能证明所有标题场景均无问题，但不能继续用这条失败断言标题功能损坏。

## 验证与证据

所有浏览器操作使用 Playwright 新建的隔离上下文和测试库，没有访问真实笔记库。

| 检查 | 本轮结果 |
| --- | --- |
| 原 `editor-link-click.spec.ts`，desktop-chrome | 6 passed、2 failed、11 skipped；两个失败按上文分类 |
| 新行为诊断，desktop-chrome | 3 failed，分别在 B2、B3、B1 的目标断言处失败；均完成前置操作 |
| 附件重试组件诊断，jsdom | 1 failed，在“重试应调用第二次”处失败，对应 B4 |
| 既有 saving-editability 单测 | 2 passed，确认本地可继续写、WebDAV saving 锁定 |
| 更新定位/源码核对的基线诊断，desktop-chrome | 2 passed |
| iOS / Android 真机、全量单测与构建 | 本轮未运行；不作通过声明 |

诊断源文件以 `.txt` 留档，避免已知失败的审计样例混入默认测试：

- [行为诊断](./behavior-probes.spec.ts.txt)：复制到 `e2e/editor-audit-20260922.spec.ts`，运行 `pnpm exec playwright test e2e/editor-audit-20260922.spec.ts --project=desktop-chrome --workers=1`。
- [旧回归复核](./baseline-probes.spec.ts.txt)：复制到 `e2e/editor-audit-baseline-20260922.spec.ts`，同方式运行。
- [附件重试诊断](./attachment-retry-probe.test.tsx.txt)：复制到 `src/components/editor/__audit-attachment-retry.test.tsx`，运行 `pnpm exec vitest run src/components/editor/__audit-attachment-retry.test.tsx`。

截图：[替换后无匹配](./find-after-replace.png)、[编辑后计数过期](./find-after-edit.png)、[保护副本失败仍恢复](./restore-after-backup-failure.png)。

## 建议下一批顺序

1. 修 B1 安全恢复、B2/B3 查找状态、B4 附件重试；每项都有现成复现样例，适合小范围落地。
2. 单篇 Markdown+附件导出、历史逐行对比与恢复副本；改善“写完能交付、改错能找回”。
3. WebDAV 同步期间持续编辑；先明确 revision/快照合并规则，再解锁 UI。
4. iOS 真机输入与表格走查，随后补长文显示偏好和高级查找。

不建议为追平 Joplin 直接引入另一套富文本内核。Joplin 官方同样列出 Markdown 富文本往返的 HTML、混合列表和插件格式限制；现阶段保留源码可回退与内容无损，更符合项目已有方向。

## Joplin 官方参考

以下页面于本轮读取，用于确认公开功能声明，不代表本轮实际运行过 Joplin 或证明全端无缺陷。

- [历史版本与恢复副本](https://joplinapp.org/help/apps/note_history/)
- [后台同步](https://joplinapp.org/help/apps/sync/)
- [附件及媒体预览](https://joplinapp.org/help/apps/attachments/)
- [HTML/PDF 等导出](https://joplinapp.org/help/apps/import_export/)
- [富文本编辑器及限制](https://joplinapp.org/help/apps/rich_text_editor/)
