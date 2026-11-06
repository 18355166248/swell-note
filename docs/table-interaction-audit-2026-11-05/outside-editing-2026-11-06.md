# 表格内外交叉编辑排查（2026-11-06）

基于 main 的 `3a74181`。使用独立离线测试库，不改真实笔记；本轮仅新增 E2E 测试和记录，未修改业务代码、未提交。

## 结果

本轮未发现新的异常。新增 `e2e/table-outside-editing-audit.spec.ts` 的 9 个场景在桌面 Chrome 和 Pixel 7 Chrome 模拟中全部通过（18 项）。同时回归常规表格编辑及页面功能，最终共 55 项通过、1 项按平台跳过、0 失败。跳过项为移动端没有的桌面工具栏重做按钮对照。TypeScript 检查通过。

## 新增覆盖

1. 未提交单元格草稿切到源码模式，在正文续写，再返回表格继续录入。
2. 未提交草稿锁定只读，解锁后撤销并继续格内编辑。
3. 剪切格内部分文字并粘贴到正文，撤销重做不误改邻格。
4. 正文选中文字复制回表格，原正文与其他单元格保持不变。
5. 两张表之间切换编辑，再插入正文，草稿不串表。
6. 单元格草稿与正文一起参与全篇替换，撤销恢复各处内容。
7. 草稿提交后在正文加粗、撤销，表格内容保持已提交。
8. 矩形多格剪切只清空目标内容，保留表格结构；连续撤销重做后继续编辑。
9. 退出格内编辑后全篇剪切，撤销恢复整篇笔记和草稿，恢复后继续编辑表格。

使用真实键盘快捷键与浏览器剪贴板，并对照缓存中的整篇 Markdown 断言内容。补充覆盖来自既有测试的普通文本/TSV/HTML 粘贴、插入删除行列、查找选区边界、章节折叠、专注模式、源码行号、只读阅读和图片附件展示。

## 验证命令

```sh
pnpm exec playwright test e2e/table-outside-editing-audit.spec.ts e2e/table-regular-editing-audit.spec.ts e2e/editor-advanced-find.spec.ts e2e/editor-long-writing.spec.ts e2e/editor-reading-cleanup.spec.ts --workers=1 --output=/tmp/swell-note-table-outside-final
pnpm exec tsc --noEmit
```

第一轮 7 个交叉场景两端共 14 项通过；随后增加两个剪切边界并运行上述完整测试集，统计以最终一轮为准，不叠加重复运行。

范围边界：移动端为 Chrome 设备模拟，在 macOS 主机上发送键盘事件；不是实际 iOS/Android 软键盘、系统输入法或原生应用验收。本轮通过表示所列场景未发现异常，不代表全部可能操作均无问题。
