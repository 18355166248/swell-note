# 桌面与 iOS 原生编辑验收

2026-09-13，接续编辑/阅读一体化实现。使用当前源码构建的 macOS Tauri 应用和 iPhone 17 / iOS 26.2 模拟器，实际操作通过 CUA 完成。

桌面验收应用为 `Swell Note QA.app`，测试文件位于 `/tmp/swell-native-audit-vault/原生编辑验收.md`。iOS 新建 `QA-iOS-0913-zhong` 作为测试文档；模拟器既有缓存可以读取，但系统安全存储不可用，本轮没有连接/同步远端。没有修改既有业务笔记。

## 原生实测发现

1. 本地笔记自动保存期间，整个正文短暂切为只读。连续键入 `DESKTOP-OK` 只保存第一个 `D`，其余输入丢失。保存状态应为后台提示，不应锁住正文。
2. 表格单元格尚未失焦时使用 `Cmd+E` 锁定，会丢掉局部草稿。需要提交当前输入或在只读期间保留会话，并保护外部修改冲突。
3. iOS 中文组合输入时有额外错位的蓝色光标，锁定后还残留。需要避免原生 caret 和 CodeMirror 自绘 caret 同时显示。

![iOS 修复前光标](/Users/xmly/Swell/code/swell-note/docs/native-editor-audit-2026-09-13/ios-before-caret.png)

## 已执行操作

- iOS 新建进入不自动弹键盘。
- 通过实际简体拼音软键点击 `zhongwen`、选择「中文」，点击换行；长文末尾输入 `ceshi`、选择「测试」、删除一个汉字。
- 粘贴含列表、任务、表格和公式的长文，展开软键盘后继续输入与连续换行，确认文末仍可滚动到达，格式工具条位于键盘上方。
- 点更多菜单时键盘收起，锁定后显示只读状态。

## 修复与最终复验

上述三项均已修复，并在重新构建的原生应用中复验：

| 场景 | 修复与实测结果 |
| --- | --- |
| 桌面连续输入与保存 | 本地后台保存保持可编辑，`DESKTOP-OK` 完整保留并写入文件；WebDAV 同步保存仍保留写保护。 |
| 桌面中文与格式 | 中文粘贴、换行、选中「验收」加粗、撤销和重做通过。桌面中文使用粘贴验证，不将其视作拼音组合输入覆盖。 |
| 表格立即锁定 | 输入 `苹果TABLE-OK` 后立即 `Cmd+E`，锁定视图保留新值；解锁后一次撤销恢复 `苹果`。快捷键锁定前提交焦点输入，表格会话额外保护草稿和外部修改冲突。 |
| iOS 拼音与光标 | 最终安装包用软键盘逐键输入 `ceshi`、选择「测试」，正文正确落字；组合输入及落字后的光标均在文字末尾，没有额外错位光标。iOS 使用原生光标与选区，桌面保留 CodeMirror 自绘选区。 |
| iOS 选区与格式 | 双击「测试」显示原生选区手柄；点加粗成功，文字和选区位置正确。 |
| iOS 锁定/解锁 | 锁定后键盘、原生选区和光标退出，只读状态可见；解锁后工具条恢复，不自动弹键盘。 |
| iOS 局部公式编辑 | 打开源码输入区，软键盘上方的保存/取消操作可见，取消恢复原内容。本轮未完成原生公式修改后保存的独立操作验证。 |

同时审查了后台保存竞态：通过请求版本、笔记版本与仓库代次过滤过期状态；同一路径继续串行写入，已失效的排队任务在写入前退出。延迟任务测试覆盖旧写入完成、新内容待保存和切换仓库等情况。

![桌面修复后](/Users/xmly/Swell/code/swell-note/docs/native-editor-audit-2026-09-13/desktop-after.png)

![iOS 单光标](/Users/xmly/Swell/code/swell-note/docs/native-editor-audit-2026-09-13/ios-after-caret.png)

![iOS 原生选区](/Users/xmly/Swell/code/swell-note/docs/native-editor-audit-2026-09-13/ios-after-selection.png)

![iOS 锁定阅读](/Users/xmly/Swell/code/swell-note/docs/native-editor-audit-2026-09-13/ios-after-locked.png)

## 构建与自动验证

- `pnpm test`：89 个测试文件通过、1 个跳过；701 项通过、1 项跳过。
- `pnpm build`：TypeScript 与 Vite 构建通过。
- macOS：`tauri build --debug --bundles app`，使用独立 QA 标识，构建通过；未替换 `/Applications/Swell Note.app`。
- iOS：`tauri ios build --debug --target aarch64-sim --ci --no-sign`，最终完整构建通过，已安装并复验。
- 初次 iOS 构建遇到旧输出目录非空导致归档搬运失败，保留旧产物到临时目录后重新构建通过；没有删除模拟器应用数据。
- `git diff --check` 通过。本轮未运行完整 Playwright 套件，原生交互结论来自上述实际操作。

本轮已测主要编辑路径没有再复现阻断问题。未发布或提交代码；模拟器安全存储提示仍存在，未验证云同步。模拟器不能代替真实 iPhone 的触摸延迟、第三方输入法及长期性能验证。
