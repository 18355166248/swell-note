# 基于 Joplin 思路的编辑器改造评估

> 分支：`feat/joplin-editor`
> 目标：不再引入 Vditor、Milkdown 等新编辑内核，在现有 CodeMirror 6 基础上，参考 Joplin 的编辑器架构改善桌面端与移动端体验。
> 状态：**P1 首个切片已实现**（见文末「实施记录」）。P2–P6 未开工。

## 结论

Joplin 的 Markdown 编辑器同样基于 CodeMirror 6。Swell Note 当前的问题并不主要来自 CodeMirror，而是编辑器生命周期、平台适配、命令边界、实时预览和复杂表格组件之间耦合过深。

建议采用“架构参考、独立实现”的方式：

- 保留 CodeMirror 6 和现有 Markdown 存储格式。
- 不引入 Joplin 富文本编辑器。Joplin 的富文本模式仍以 Markdown 为存储格式，官方也明确列出了表格、混合列表、HTML、插件内容等往返转换限制。
- 不直接复制 Joplin 源码或依赖 `@joplin/editor`：该包标记为 private，Joplin 仓库默认采用 AGPL-3.0-or-later；Swell Note 当前未声明兼容许可证。
- 参考 Joplin 的 `EditorControl + typed events + commands + Compartment` 分层，重构 Swell Note 现有编辑器。
- 表格和实时预览只吸收设计思路，不照搬功能。Joplin 当前仍有表格格式化与实际 Markdown 不一致等公开问题。

## 当前实现的主要问题

当前编辑器已经具备较丰富的功能，但实现规模和耦合度较高：

- `markdown-editor.tsx` 同时负责 CodeMirror 创建、扩展组装、剪贴板、附件、链接、表格、移动端键盘、滚动和对外命令。
- `MarkdownEditorHandle` 暴露大量 UI 操作，Workspace、工具栏和编辑器内部实现直接耦合。
- 切换笔记时通过 React `key` 重建编辑器，再依赖最近 20 个 `EditorState` 恢复历史。这个方案容易造成焦点、输入法组合态、滚动位置和移动端视口抖动。
- `live-preview.ts` 和 `markdown-table-widget.ts` 都已经发展为大型子系统，编辑状态、装饰层和 DOM 输入控件之间容易不同步。
- 桌面端、移动端、键盘弹起、只读模式等分支集中在同一组件中，后续修改很容易产生平台回归。
- 异步图片/附件插入依赖捕获位置和当前笔记状态，需要更明确的笔记身份与版本校验，避免回调写入已经切换走的笔记。

现有的本地文件防抖保存、WebDAV working copy、冲突检测和 revision 处理属于应用数据层，应该保留，不应在本次编辑器重构中推翻。

## Joplin 值得借鉴的部分

| 维度 | Swell Note 当前方式 | Joplin 的思路 | 建议 |
| --- | --- | --- | --- |
| 编辑内核 | CodeMirror 6 | CodeMirror 6 | 保留现有内核 |
| 生命周期 | 按笔记 `key` 重建并缓存 EditorState | 稳定 EditorView，通过 control 更新正文和配置 | 优先改造 |
| 对外接口 | 大型 React ref handle | 统一 EditorControl、命令和事件 | 优先改造 |
| 配置切换 | React props/useMemo 重组扩展 | Compartment 动态重配置 | 采用 |
| 平台差异 | 分支混在编辑组件内 | 共享核心，平台 host 负责外部能力 | 采用 |
| Markdown 预览 | 大量自定义 live-preview widget | 相对保守的内联渲染扩展 | 收敛功能 |
| 表格 | 复杂网格 widget、单元格输入层 | 仍在持续修复边界问题 | 自行设计轻量模式 |
| 富文本 | 已尝试 Milkdown/Vditor | ProseMirror/TinyMCE，存在 Markdown 往返限制 | 暂不采用 |

## 推荐目标架构

建议逐步拆分为以下边界，目录名可在实施时根据现有结构微调：

```text
src/components/editor/
  core/
    editor-types.ts
    editor-events.ts
    editor-control.ts
    create-editor.ts
  commands/
    formatting.ts
    navigation.ts
    history.ts
  extensions/
    live-preview.ts
    attachments.ts
    links.ts
    tables.ts
    mobile-input.ts
  adapters/
    react-editor.tsx
    desktop-editor-host.ts
    mobile-editor-host.ts
```

核心原则：

1. `EditorControl` 是 Workspace、工具栏和编辑器核心之间唯一的命令入口。
2. 格式化、撤销、搜索、附件插入等操作变成带类型的 command，不再由外部组件查找编辑器 DOM。
3. 编辑器只发出正文、选区、焦点、滚动和资源请求事件；文件选择、外链打开、保存、路由等由 host 处理。
4. 一个已挂载的编辑区域保持稳定的 EditorView。切换笔记时以事务更新文档，并根据笔记身份明确决定是否恢复历史、选区和滚动状态。
5. 主题、只读状态、移动端模式、实时预览和表格模式通过 Compartment 动态切换，避免整体重建。

## 分阶段改造计划

### P0：建立基线与保护网

- 建立真实 Markdown 样例：中文输入、长文、代码块、表格、图片、任务列表、HTML、混合中英文标点。
- 记录桌面端、iOS、Android 的输入法、选区、撤销、切换笔记和键盘弹起行为。
- 增加 Markdown 保存前后逐字对比测试，保证重构不悄悄改写原文。
- 记录长文首次打开、输入延迟、笔记切换和装饰刷新耗时。

### P1：先重构生命周期和接口

- 引入 `EditorControl`、typed commands 和 typed events。
- 将 `MarkdownEditorHandle` 逐步收敛为 control，不一次性重写所有功能。
- 去除以笔记 `key` 强制重建编辑器的依赖，改为稳定 EditorView。
- 为每个笔记保存独立的选区、滚动和历史快照；切换时先结束 composition，再进行带 note id/revision 的文档更新。
- 使用 Compartment 管理可变配置。

这是收益最高、风险最可控的一阶段，也能直接改善移动端反复打开笔记后的焦点和视口累积问题。

### P2：移动端输入与布局

- composition 期间禁止外部 value 回写覆盖正在输入的中文。
- 页面只保留一个滚动所有者，键盘 inset 由 mobile host 统一计算，避免编辑器和页面同时补偿高度。
- iOS 优先使用系统选区和原生长按菜单；桌面端快捷工具不直接照搬到窄屏。
- 移动端工具栏改成可折叠或底部弹出，默认只保留撤销、待办、标题、列表和插图等高频动作。
- 增加打开/关闭同一笔记、多次切换笔记、旋转屏幕、键盘切换的回归测试。

Joplin 为规避 Android 兼容问题禁用了 CodeMirror EditContext。Swell Note 不应直接全平台照搬，应先在 Android 定向验证，iOS 保持独立测试结论。

### P3：收敛实时预览

- 先支持标题、强调、链接、任务、图片等稳定语法。
- 只在光标不位于当前标记范围时隐藏 Markdown 符号，编辑当前行时优先展示源码。
- 图片、数学公式、Mermaid 等异步渲染增加事务版本校验；笔记切换或文本变化后取消过期结果。
- 装饰只处理可视区域，避免每次输入扫描并重建整篇长文 DOM。

目标不是在 CodeMirror 中模拟完整 WYSIWYG，而是让 Markdown 源码编辑更易读、可预测。

### P4：重新定义表格体验

- Markdown 文本始终是唯一数据源，网格编辑通过 CodeMirror transaction 写回，不维护平行正文状态。
- 桌面端可保留轻量网格编辑；移动端建议使用独立的全屏/半屏表格编辑器，而不是在正文中塞入多个 textarea。
- 保留不规则表格和用户原始格式的降级路径，无法安全解析时直接显示源码。
- 表格功能作为可关闭扩展，先解决光标、撤销和 Markdown 一致性，再增加拖拽、对齐等增强功能。

### P5：保存与异步资源安全

- 保留 App 层现有本地/WebDAV 保存管线。
- 编辑器事件携带 `noteId + revision`，异步附件上传完成时校验目标笔记和插入锚点仍然有效。
- 切换笔记、应用进入后台和关闭窗口时提供显式 flush。
- 保存失败不回滚用户正在输入的 EditorState，由应用层展示待同步状态并重试。

### P6：性能与渐进发布

- 避免无变化时频繁调用 `doc.toString()`，正文序列化只发生在确有变更或保存边界。
- 扩展按功能拆包，图片/图表/高级表格按需加载。
- 增加输入延迟、transaction 耗时、装饰数量和长任务监控。
- 使用功能开关 `joplinEditorArchitectureV1` 灰度启用；在桌面、iOS、Android 达到退出标准前保留当前编辑器回退路径。

## 建议的首个实现切片

首个切片不要先改 UI，范围控制为：

1. 建立 `EditorControl` 和事件协议。
2. 用 Compartment 管理只读、主题、平台和预览配置。
3. 将笔记切换从 React `key` 重建改为受控事务更新。
4. 保持现有工具栏、实时预览、表格和保存行为不变。
5. 补齐“中文输入中切换焦点”“连续打开笔记”“撤销不跨笔记”“保存内容不变化”测试。

完成这个切片后，再根据实测数据决定移动端布局、实时预览和表格分别需要重写多少，避免一次大改无法定位回归。

## 验收标准

- 同一笔记连续进入/退出 20 次，页面顶部、滚动区域和键盘 inset 不累积位移。
- 中英文输入法 composition 不丢字、不重复、不跳光标。
- 撤销历史不跨笔记，返回原笔记时按产品定义恢复。
- 桌面端和移动端保存后的 Markdown 与预期逐字一致。
- 异步图片上传完成后不会插入到已经切换到的另一篇笔记。
- 1 MB 级 Markdown 输入时无持续明显卡顿，非可视区域不创建大量 widget。
- 表格无法安全解析时可无损退回源码编辑。

## 实施记录（P1 首个切片）

本节记录**实际落地**的内容，与上面的计划不一致处以此节为准。

### 已实现

新增 `src/components/editor/core/`，共四个模块：

| 文件 | 职责 |
| --- | --- |
| `create-editor.ts` | 全仓库唯一的 `new EditorView` 位置。集中 Compartment（只读、主题、可编辑、扩展包）、`buildEditorState`、扩展装配 |
| `editor-control.ts` | `EditorControl`：稳定 EditorView 的持有者，对外只暴露 `updateDocument` / `dispatchCommand` / `on` / `destroy` |
| `editor-events.ts` | 对外事件表 `EditorEventMap`（`documentChange` / `selectionChange` / `focusChange` / `formatStateChange`） |
| `editor-types.ts` | 命令联合类型 `EditorCommand`、返回类型映射 `EditorCommandResult` 与文档身份类型 |

配套改动：

- `markdown-editor.tsx` 不再自己 `new EditorView`，改为持有一个 `EditorControl`；外部 props 变化通过 `control.updateDocument(value, identity, { forceSwitch, settings })` 走事务写入，不再重建组件。
- `workspace.tsx` 去掉 `<MarkdownEditor>` 上的 `key={noteRenderIdentity}`，改为传 `revision={note.revision}`，笔记身份由编辑器内部判断。
- 扩展按用途拆成 `buildBehaviorExtensions` / `buildPlatformExtensions` / `buildLivePreviewExtensions` / `buildTableEditingExtensions` 四个 `useCallback`，由 Compartment 分组装载。
- `live-preview.ts` 拆出 `markdownLivePreviewBase()`（选项 + 插件 + `richBlockDecorationsField`）与 `markdownTableEditing()`（仅 `tableDecorationsField`），使表格装饰可独立卸载；`syncTableDecorations` / `tableDecorationsDrifted` 增加 `state.field(field, false)` 存在性判断，避免字段缺失时抛错。
- 会话快照改为按 `sessionKey` 隔离，由 `EditorControl` 内部的 `rememberSnapshot` / `buildRestoredState` 独占读写；`editor-session.ts` 只导出共享的 `editorSessionStore` 实例与 `sessionFields`。

### P1 定向审查与修复（`fix(editor): harden note switching and IME state synchronization`）

针对评审提出的三个 P1 问题逐一复核，全部**确认成立**并已修复。

#### 一、composition 挂起更新的状态一致性与丢字风险（确认）

**根因**：旧 `updateDocument` 在组合期间把**所有**回写（含用户输入的 echo 回传）塞进 `pending.doc`，`compositionend` 时 `flushPendingDocument` 直接 `applyDocument(pending.doc)`。而 `pending.doc` 是 React 受控 value 慢一拍的旧值，会覆盖 IME 刚提交的最后一个字符；且组合期间收到的 settings 只改 `this.settings`，不经过 `updateSettings/reconfigure`，导致 `getSettings().readOnly` 与 `EditorState`/DOM 状态分裂。

**修复**：
- 引入 `UpdateDocumentOptions.origin`（`"echo" | "switch" | "external"`）区分三类更新来源；组合期间统一挂起，`flushPendingDocument` 按 `origin` 分流——echo 只补身份与设置、绝不覆盖正文，external 才真正落外部正文，switch 按切换重建。
- `flushPendingDocument` 对「正文相同」不再直接 return：先经新增的 `applyIdentityAndSettings` 落地 identity（含 revision）与 settings（走 Compartment reconfigure）。
- settings 在组合期间一并挂起（`readOnly` 翻转会打断候选词），结束后经 `updateSettings` 真正生效。
- `endComposition` 在 `blur()` 前先清空 `pending`/`pendingSettings`，避免 `blur` 同步派发的 `compositionend` 把旧会话挂起反扑到新笔记。

#### 二、切换笔记闪现旧正文（确认）

**根因**：`markdown-editor.tsx` 用普通 `useEffect` 调 `updateDocument`，React 提交新笔记 UI 后、effect 更新 EditorView 前，浏览器可能先绘制一次旧 `EditorView`。jsdom 的 `rerender + act` 会同步冲刷 effect，因此旧测试「每一帧都显示目标笔记」并不能证明浏览器无闪现。

**修复**：正文同步改走 `useLayoutEffect`（DOM 变更后、绘制前同步执行），笔记身份与正文切换落在同一帧内；`sessionKey` 的推进拆到独立的普通 `useEffect`，`forceSwitch` 与 `origin` 在渲染期按 `previousSessionKeyRef` 计算。保持 EditorView 实例与外层 DOM 稳定，未加回 `key={noteRenderIdentity}`。

#### 三、切换笔记后派生 UI 状态残留（确认）

**根因**：`EditorView.setState()` 绕过普通 transaction 路径、不触发 `updateListener`（已核对 `@codemirror/view` 6.43 源码：`setState` 走 `plugin.destroy + 重建 ViewState/DocView`，从不 dispatch transaction）。切换后 `applyDocument` 虽补发 `documentChange`，但适配层对 `external` 直接 return，`onHistoryChange` 只在普通 docChanged 监听与初次挂载执行，因此 undo/redo、光标、格式高亮在切换后不刷新。

**修复**：删除死抽象 `formatStateChange`（有订阅无 emit），新增 `sessionChange` 事件；`applyDocument` 在切换时（且非组合态）补发 `sessionChange`，适配层订阅它一次性重读 `undoDepth/redoDepth`、选区、`editingTable=false`、光标行列与 `detectFormatState`。切换后撤销按钮、光标、格式状态立即落到目标笔记，不依赖下一次用户输入。

#### 同时收敛的架构项

- `owns()` 现按完整 `isSameDocumentIdentity`（含 revision）判断，适配层的 `controlRef.current !== control` 保留为「实例归属」守卫——两套职责不同：前者判文档身份（可跨实例复用），后者判「这个 control 是否还是当前挂载的」。保留双守卫但职责已澄清。
- 修正 `editor-session.ts` / `editor-control.ts` 中仍声称「会话快照保存滚动位置」的过期注释：滚动实际由 `noteEditorScrollMemory` 管理。

#### 新增/改写测试

`markdown-editor.test.tsx`：
- 改写「外部 value 回写不覆盖正在组合的中文」为「组合结束旧 value 不覆盖最终正文」。
- 新增：composition 期间 readOnly 改变后 EditorState 与 contenteditable 一致；切换笔记旧 pending 不覆盖新笔记；多次 value/settings 更新只应用最终状态；切换经 layout effect 且不触发 onChange；快速 A→B→C 不串正文不触发保存。

`editor-control.test.ts`：
- 改写两个旧 composition 测试，新增「旧 value 不覆盖 IME 已提交正文」「挂起的外部正文组合后落地」「切走不反扑」「revision 变化后身份落地」「readOnly 状态一致」「sessionChange 只在切换时发」。

测试边界：jsdom 无法观测真实 paint 时序，「无闪现」依赖 `useLayoutEffect` 的 React 语义（绘制前同步执行），已明确标注；layout effect 路径与 external 不触发 onChange 已由测试覆盖。

### 与计划的偏差

1. **命令表比计划小得多。** `EditorCommand` 目前只有 6 条：`history.undo`、`history.redo`、`selection.all`、`selection.collapse`、`navigation.revealLine`、`navigation.scrollLineToTop`。格式化、搜索、剪贴板等命令依赖表格单元格、链接面板等 UI 现场，仍在 `MarkdownEditorHandle` 兼容层内实现。
   计划里曾把 7 条尚无实现的命令写进联合类型，已删除：`dispatchCommand` 的返回类型是按命令派生的，列出未实现命令会让调用方拿到「声明返回 `EditorFindResult`、实际得到 `undefined`」的假类型，恰是本设计要消灭的东西。后续迁移时**实现与类型声明一起加回**。`runCommand` 末尾用 `assertNever(command)` 做穷尽性检查——新增命令类型却漏实现会直接变成 tsc 编译错误。
2. **滚动不由编辑器负责，因此没有 `scrollChange` 事件。** 滚动容器是工作区外层的 Radix `ScrollArea`，阅读位置的记录与恢复由 `src/services/navigation/mobile-scroll-memory.ts` 的 `noteEditorScrollMemory` 按 `缓存库:笔记ID` 完成（200 条 LRU）。core 再发一份自己的 `scrollChange` 没有订阅方，只会让人误以为滚动位置由编辑器保存。同理 `EditorSessionSnapshot` 不含 `scrollTop`。
3. **`compositionChange` 没有外发。** 组合态只在 `EditorControl` 内部记录，宿主需要的两件事各有更直接的通道：「现在能否改正文」由 `updateDocument` 按 `composing` 分流，「组合期间不打断」由挂起 + `flushPendingDocument` 在 `compositionend` 落地。
4. **`focusChange` 保留外发。** `markdown-editor.tsx` 订阅它同步「当前是否在编辑表格单元格」，删掉会断掉真实订阅方。
5. **未使用特性开关灰度。** P6 里的 `joplinEditorArchitectureV1` 未实现，本次是直接替换而非开关灰度。
6. **`@uiw/react-codemirror` 仍被部分引用**（`basicSetup`、`defaultLightThemeOption`、`oneDark`），仅去掉了它作为 React 组件包装层的用法。这三个符号的底层包 `@uiw/codemirror-extensions-basic-setup` 与 `@codemirror/theme-one-dark` 只是传递依赖；仓库没有依赖检查工具，为此新增两个直接依赖不算净收益，故维持现状。

### 尚未验证 / 已知风险

- **本轮三个 P1 修复的 iOS 真机项未验证。** composition 状态机、`useLayoutEffect` 切换无闪现、`sessionChange` 后的派生状态刷新，全部只在 jsdom 单测与 tsc/vite 构建下验证。**不得宣称在 WKWebView 上问题已解决**——Chromium e2e 只能作页面结构旁证，无法复现 WKWebView 的键盘、safe-area、composition 时序。
- **iOS 真机项全部未验证。** 验收标准中「反复进出同一笔记 20 次不累积位移」「键盘弹收循环」「输入法切换」「旋转屏幕」「返回列表对位」在真机/模拟器上都**没有得到有效结论**。
  此前一次脚本化测量曾得出「20 轮无漂移」，该结果是**假通过**：`drift-02.png` 至 `drift-20.png` 的 md5 完全相同（`7a452f83…`），即第 2 轮之后截图根本没变，合成点击被前台其他应用（zed、企业微信、Chrome）接收，未进入模拟器。该测量已在获知用户正在使用电脑后停止，不再重跑。**不得把这次读数当作通过。**
- 可作参考但**不能替代真机**的旁证：`e2e/mobile-editor-drift.spec.ts` 在 Chromium 下给出 `hostTop` 恒为 162、`scrollerCount` 恒为 1。Chromium 无法复现 WKWebView 的 safe-area 与键盘行为，只能说明页面层没有累积位移的代码路径。
- **`owns()` 与实例比较两套守卫并存。** 已收敛职责：`owns()` 按 `isSameDocumentIdentity`（含 revision）判文档身份，适配层 `controlRef.current !== control` 判「当前挂载的实例是否还是这个」。两者语义不同，均保留。
- **`formatStateChange` 死抽象**：有订阅无 emit，已删除，切换后的格式刷新改由 `sessionChange` 承接。
- **`@uiw/react-codemirror` 传递依赖**：如上，未处理。
- **e2e 并行启动偶发超时**：`mobile-editor-drift.spec.ts` 与 `table-editing.spec.ts` 并行跑时出现过 `browserType.launch: Timeout 180000ms exceeded`；单独以 `--workers=1` 重跑均通过，判定为并行启动 Chrome 的抖动，非本次改动引入的回归。

### 验证方式与结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | 通过 |
| 编辑器单元测试 | `npx vitest run src/components/editor` | 443 passed（24 个文件） |
| 其中 core | `npx vitest run src/components/editor/core` | 21 passed |
| 全量单元测试 | `npx vitest run` | 1037 passed \| 1 skipped |
| 构建 | `npx vite build` | 成功 |
| e2e | `npx playwright test <spec> --workers=1` | 逐 spec 单独跑均通过 |
| Lint | `npx eslint .` | **无法执行**：仓库内不存在任何 ESLint 配置（无 `eslint.config.*`、无 `.eslintrc*`，`package.json` 也无 lint 脚本），命令输出的是 ESLint 的迁移指引文本，不是 lint 结果 |

`markdown-editor.test.tsx` 中与本次改造直接相关的用例包括：切换笔记复用同一个 EditorView 与 DOM 节点、只读与主题变化不重建 EditorView、重复挂载/卸载十次不残留编辑器 DOM、返回原笔记时选区与撤销历史按会话恢复、composition 期间外部回写不覆盖中文且组合结束后补上、书签属于切换前的笔记或上传期间 revision 变化时拒绝插入。

### 复核提示（给 code review / 功能 review）

建议重点看这几处：

1. `editor-control.ts` 的 `updateDocument` 分支：`forceSwitch`、`composing`、`pending` 三条路径的优先级是否覆盖了「同步合并改过正文」与「组合中被外部更新」同时发生的情况。
2. `assertNever` 的穷尽性检查是否真的会在漏实现时报错（可临时往 `EditorCommand` 加一条类型试）。
3. `owns()` 与实例比较的取舍。
4. `live-preview.ts` 拆出的两个工厂是否让既有调用方（含测试）拿到了与拆分前一致的扩展集合。

## 参考资料与许可证边界

- [Joplin `@joplin/editor` package](https://github.com/laurent22/joplin/blob/dev/packages/editor/package.json)
- [Joplin CodeMirror `createEditor`](https://github.com/laurent22/joplin/blob/dev/packages/editor/CodeMirror/createEditor.ts)
- [Joplin `CodeMirrorControl`](https://github.com/laurent22/joplin/blob/dev/packages/editor/CodeMirror/CodeMirrorControl.ts)
- [Joplin mobile NoteEditor](https://github.com/laurent22/joplin/blob/dev/packages/app-mobile/components/NoteEditor/NoteEditor.tsx)
- [Joplin rich text editor limitations](https://joplinapp.org/help/apps/rich_text_editor/)
- [Joplin CodeMirror 6 plugin tutorial](https://joplinapp.org/help/api/tutorials/cm6_plugin/)
- [Joplin repository license](https://github.com/laurent22/joplin/blob/dev/LICENSE)
- [Joplin table formatting issue #16421](https://github.com/laurent22/joplin/issues/16421)

本方案只参考公开架构和交互思想，不复制 Joplin AGPL 源码、图标或品牌资源。若未来决定直接复用其实现，需要先明确 Swell Note 的开源和分发许可策略。
