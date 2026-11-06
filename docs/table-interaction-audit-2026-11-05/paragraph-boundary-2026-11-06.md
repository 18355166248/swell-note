# 表格后空行输入吞入正文（2026-11-06）

用户截图指出此前测试遗漏的场景：表格和已有正文之间只有一个空行，在该空行输入时，输入内容和下面的段落变为表格行。之前的交叉测试点击的是已有正文，不覆盖这个边界，不能据此推断空行输入安全。

## 复现与原因

以一行数据的两列表格为例，其后是一个空行和两行 iOS/安卓正文。修复前用真实鼠标点空行并连续输入 123，表格正文行数从 1 变成 5。输入占用了 Markdown 表格唯一的空白分隔，GFM 允许没有竖线的文字作为后续表格行，装饰随解析结果扩展，光标和后续输入进一步受影响。并非主动点击进入了单元格。

修复前粘贴路径也没有保留源码分隔空行；当时其表格行数断言通过，但完整源码断言失败，不能把两条路径的即时显示结果混为一谈。

## 修复

`live-preview.ts` 的网格编辑扩展加入事务过滤：仅在用户输入/粘贴把表格紧邻的空行变成非空行时，在其前面保留一个分隔空行。补行与用户输入合并为同一事务，映射光标、共同撤销。表格内部更新、源码模式、代码块、程序更新和普通正文编辑保持原有路径。

新增单测覆盖输入、组合输入事务、粘贴、文末输入、多行文本、Enter、源码模式、表格事务、程序更新及代码块。组合输入单测不等同于系统输入法真机验收。

新增浏览器测试用真实空行点按复现，断言表格仍只有一行数据、缓存完整正文、编辑器焦点，以及一次撤销/重做恢复。移动模拟初次点按在页面左侧 32px 返回手势区，该区已有逻辑阻止编辑器聚焦；改为点按空行中部后通过。未修改导航手势逻辑。

## 验证

- 编辑器及相关快捷键单测：43 文件、753 项通过。
- TypeScript 检查通过。
- 桌面 Chrome 与 Pixel 7 Chrome 模拟：69 通过、1 项桌面按钮对照按平台跳过、0 失败。
- 覆盖截图边界、常规表格粘贴、行列增删、格内导航、页面全选、表格内外交叉编辑和撤销重做。

```sh
pnpm exec vitest run src/components/editor src/components/workspace/shortcut-scope.test.ts src/components/workspace/selection-action-bar.test.tsx --maxWorkers=2
pnpm exec tsc --noEmit
pnpm exec playwright test e2e/table-paragraph-boundary.spec.ts e2e/table-outside-editing-audit.spec.ts e2e/table-regular-editing-audit.spec.ts e2e/table-focus-race.spec.ts e2e/table-cell-keyboard.spec.ts --workers=1 --output=/tmp/swell-note-boundary-regression
```

修复前证据在 `/tmp/swell-note-boundary-before/`。使用隔离笔记，无真实笔记修改。代码尚未提交、尚未打包到原生桌面应用；不自动修复此前已经写入的异常笔记。
