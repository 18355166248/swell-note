# 常规表格编辑排查（2026-11-05）

修复前排查基于 main 的 f0bd563；以下问题及失败结果为修复前记录，修复与最终验证见文末。本次使用独立离线测试笔记及浏览器剪贴板，不修改真实笔记。桌面 Chrome 和 Pixel 7 Chrome 模拟均在 macOS 主机运行；移动模拟中的键盘组合不代表真机软键盘验收。

## 已确认：单列 HTML 表格粘贴丢失格内换行

进入单元格，粘贴同时具有以下两种格式的剪贴板：

- text/plain：`第一行\n第二行\n下一格`，不含制表符。
- text/html：`<table><tr><td>第一行<br>第二行</td></tr><tr><td>下一格</td></tr></table>`。

预期第一格存为 `第一行<br>第二行`，第二格为 `下一格`；实际第一格变为 `第一行第二行`，两行文字粘连。桌面、移动模拟各在两轮中均复现。

源码定位：`markdown-table-widget.ts` 的 `parseClipboardTabular` 在 TSV 不适用时，用 `cell.textContent` 读取 HTML 单元格，因此丢失 br。`markdown-table-model.ts` 的 `parseTabularText` 要求存在制表符，单列内容会走 HTML 回退。已有“TSV 优先于 HTML”测试不能覆盖这个分支。

对照：带引号、含格内换行的 TSV 正常；无换行的普通二维 HTML 正常；纯文本单元格粘贴的换行正常。问题范围是 HTML 回退解析丢失格内换行，不是所有粘贴都会丢内容。

## 已确认：退出格内编辑后撤销，焦点丢失导致键盘重做无效

1. 在 2×2 正文表格的右下角粘贴 `一\t二\t三\r\n四\t\t六\r\n`。
2. 表格正确扩展为 3 行正文、4 列，原有其他格与前后正文保持正确。
3. Escape 退出格内编辑，Cmd+Z 撤销，正确恢复原笔记。
4. Cmd+Shift+Z 重做，没有恢复粘贴内容。

桌面、移动模拟各在两轮中均复现。最终轮撤销后的 `document.activeElement` 均为 BODY，见 [焦点证据](./regular-editing-focus.json)。不是单纯等待不够：撤销恢复原笔记后才发送重做，断言持续等待 8 秒仍无变化。

源码定位：`markdown-table-widget.ts` 的 `onWrapperKeyDown` 对非 textarea 目标直接调用 CodeMirror `undo/redo`；表格重建后原焦点节点被移除。格内 textarea 则由 `markdown-editor.tsx` 的 `runCellHistory` 调用 `TableHistoryController`。结合焦点证据，应优先检查 wrapper 撤销路径的焦点恢复。

对照：不按 Escape，保留格内编辑时键盘撤销重做正常（两端）；退出编辑后撤销，再点击桌面工具栏重做，内容恢复正常。因此历史仍存在，本次没有证明数据无法恢复。

## 通过的常规操作

- 普通粘贴替换格内选区，中文、emoji、竖线、换行提交正确。
- TSV 扩展行列、CRLF、尾部空格位、引号及格内换行解析正确。
- 未提交内容时上方/下方插入行、左侧/右侧插入列，内容与位置正确。
- 删至最后一列后重新插列并录入。
- 删除全部正文行后从表头下方插行并录入。
- 既有拖选复制、真实键盘复制粘贴、清空、右键结构操作、行列复制排序及未提交草稿衔接。

最终运行：

```sh
pnpm exec playwright test e2e/table-regular-editing-audit.spec.ts e2e/table-editing.spec.ts e2e/editor-table-organize.spec.ts --workers=1 --output=/tmp/swell-note-regular-audit-final
pnpm exec tsc --noEmit
```

共 52 项：35 通过、4 失败（两个问题各两个平台）、13 跳过（12 项既有桌面专用用例，1 项桌面重做按钮对照）。新增 13 个场景共 26 项：21 通过、4 失败、1 跳过。TypeScript 检查通过。失败用例保留正常预期断言，未通过跳过或 expected-failure 标注隐藏问题，当时运行此测试集退出 1；修复后结果见下文。

第一轮触屏菜单测试错误地直接访问未展开的入口而超时，已改为点击工具条抓手后进入行列菜单；最终增删行列全部通过，不将首轮入口错误归为产品缺陷。完整 trace、失败截图和断言快照位于 `/tmp/swell-note-regular-audit-final/`。


## 修复与最终验证（2026-11-06）

- HTML 回退解析在脱离页面的 DOM 中把 br 替换为文本换行，再读取 textContent；保留 TSV 优先级，不向页面插入剪贴板 HTML。
- wrapper 接收撤销/重做且没有矩形选区时，先将焦点移到稳定的 CodeMirror contentDOM，再执行历史命令，避免旧单元格移除后焦点落到 BODY。矩形选区的 pinnedRange 恢复、textarea 的 TableHistoryController 路径保持不变，也没有引入延迟抢焦。
- 新增 3 项单测，修复前均失败、修复后均通过：格内与选区两条 HTML 粘贴路径（连续换行、实体、内联标签、撤销重做），以及 Escape 后撤销的焦点保留与外部输入框不被抢焦。
- 浏览器用例保留正常断言，补充稳定焦点检查及第二轮撤销重做。两个原失败场景在桌面 Chrome 和 Pixel 7 Chrome 模拟中均通过。

最终验证：

```sh
pnpm exec vitest run src/components/editor src/components/workspace/shortcut-scope.test.ts src/components/workspace/selection-action-bar.test.tsx --maxWorkers=2
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/table-regular-editing-audit.spec.ts e2e/table-editing.spec.ts e2e/editor-table-organize.spec.ts e2e/table-focus-race.spec.ts e2e/table-interaction-edge.spec.ts e2e/table-cell-keyboard.spec.ts e2e/table-interaction-audit.spec.ts --workers=1 --output=/tmp/swell-note-regular-fix
```

单测 42 个文件、747 项通过；TypeScript 检查通过；浏览器 81 项通过、23 项按平台跳过、0 失败。覆盖普通文本/TSV/HTML 粘贴、复制、增删行列、撤销重做、快速切格、格内与页面全选、查找替换、链接与拖选。上轮浏览器运行被中断且未留下完整结果，最终已完整重跑，不将中断轮计为通过。真机及系统输入法仍未进行设备验收。
