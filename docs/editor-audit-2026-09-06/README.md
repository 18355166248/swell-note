# Swell Note 笔记编辑体验审计

> 本文保留改动前的审计快照。后续实施和验证结果见 [PROGRESS.md](./PROGRESS.md)。

日期：2026-09-06。代码基线：本地 `main`，`0df66ac`。本轮仅做评估和制作复现材料，没有修改应用代码。

结论：普通 Markdown 写作与本地保存已经有可用基础，但表格、正文、图片之间的编辑上下文还没有贯通。优先处理会改错位置、丢撤销历史和让操作不可见的问题，再补表格数据粘贴与展示一致性。

## 范围与证据

在 Codex 内置浏览器运行当前本地应用，实际新建两篇测试笔记，使用桌面 1280 × 720 与手机尺寸 390 × 844 检查。沿用现有深色主题和离线 WebDAV 缓存。图片使用项目自带 PNG 品牌素材；多列数据为人工编写的测试内容。

- `编辑体验审计 2026-09-06（测试）`：表格连续输入、多行多列粘贴、表格末尾插入图片。
- `综合内容展示审计（测试）`：标题、YAML 属性、中英文、粗斜体、删除线、高亮、嵌套列表、任务、引用、提示块、数值表、代码、公式、Mermaid、双链、脚注、失效图片、独立图片和撤销。
- 两篇笔记保留在当前浏览器的离线工作副本，未点击云同步；已有笔记内容未修改。
- 本目录保存 17 张本轮截图和一份初始 Markdown 样本。截图均已重新打开检查。没有把旧走查结论作为本轮通过证据。
- 手机尺寸检查不等于 iOS 真机：没有模拟真实软键盘、触摸长按或系统中文候选词交互。

## 流程检查

| 步骤 | 使用任务 | 状态 | 证据与观察 |
| --- | --- | --- | --- |
| 1 | 新建、命名、进入正文 | 需优化 | 图 01；新建直接进入编辑模式，但焦点停在新建按钮。首次命名后 Enter 导致路由变化，焦点落回页面。 |
| 2 | 插入表格、连续填写、粘贴数据 | 部分可用 | 图 02；首个表头自动选中，Tab 切格与末格自动加行有效；TSV 多行多列挤进一格。 |
| 3 | 表格操作、格式化、退出表格 | 有阻断 | 图 11–14、16；菜单被裁切；单元格选中文字后格式化改到正文开头。 |
| 4 | 插入图片、查看与异常恢复 | 部分可用 | 图 03、06–08；独立图片能显示，表格尾部图片会并入表格；放大层焦点可穿透。 |
| 5 | 综合内容的阅读与编辑展示 | 展示不一致 | 图 04–06、09–11；右对齐丢失、深色对比不足、公式与 Mermaid 未渲染。 |
| 6 | 手机窄屏与工具栏 | 部分可用 | 图 09–13；阅读表格有横向滑动提示，更多格式正常；表格菜单不可见，部分触控区域偏小。 |
| 7 | 模式切换、撤销、刷新恢复 | 保存可用，撤销有缺口 | 图 15、17；刷新恢复正文和 PNG，编辑→阅读→编辑后无法撤销切换前的输入。 |

## 需要优先修复的 4 个问题

### F01 · P1：表格中的格式操作会改写错误位置

复现：在综合笔记的金额单元格中点击，原文字 `12345.67` 自动选中；点击手机底栏的加粗按钮。

实际：单元格不变，正文最前面出现 `**加粗文字**`，插到 YAML 的 `---` 之前，连属性块识别也被破坏。图 14 是结果；已随后通过撤销恢复原文。

原因：表格单元格使用独立 textarea，格式按钮仍调用 CodeMirror 主选区。`insertText()` 没有拿到活动单元格的选区；主编辑器的旧光标还在文首。

建议：建立统一的当前编辑目标分发。加粗、链接、剪切、粘贴、撤销应明确作用于正文还是单元格；不支持的操作应禁用并解释。

验收：表格选中数字加粗后，仅该单元格变成 `**12345.67**`；文首、属性、其他行和正文选区不变；一次撤销可恢复。

实现入口：[markdown-editor.tsx](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-editor.tsx:254)、[markdown-table-widget.ts](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-table-widget.ts:660)。

### F02 · P1：切换阅读模式会丢失撤销历史

复现：正文末尾输入“撤销链路检查标记”→阅读→编辑→点击撤销。

实际：标记仍保留，按钮也没有禁用或给出解释。图 15。直接在同一编辑实例中撤销刚才错误的加粗是有效的，因此问题集中在模式切换后。

原因：阅读与编辑条件渲染不同组件，CodeMirror 卸载后重新创建。只保留正文字符串，没有保留历史状态。

建议：以稳定笔记身份保存编辑会话，模式切换保留 EditorState、选区和历史；标题重命名也不应丢会话。历史不可用时，撤销／重做按钮反映真实状态。

验收：输入→阅读→编辑→撤销能恢复；重做也有效。打开另一篇笔记不会串用上一份历史。

实现入口：[workspace.tsx](/Users/xmly/Swell/code/swell-note/src/components/workspace/workspace.tsx:2162)、[markdown-editor.tsx](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-editor.tsx:491)。

### F03 · P1：表格行列菜单被完全裁切

复现：点击一个单元格，再展开“行列”。桌面和手机尺寸均复现。

实际：按钮显示展开状态，但添加行、添加列、删除行、删除列的面板看不到。图 12、16。DOM 中面板存在，位于工具栏下方；祖先工具栏 `overflow: hidden` 把面板裁掉。

建议：浮层渲染到不被表格工具栏裁切的位置，并处理屏幕边缘、滚动跟随和键盘焦点。不要只增大 z-index，祖先裁切仍然存在。

验收：390px 和 1280px 宽度下菜单可见、可点；最后一行、页面底部、横向滚动后均能操作。再验证水平／垂直菜单的相同路径。

实现入口：[markdown-table.css](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-table.css:15)、[面板定位](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-table.css:36)。

### F04 · P1：表格末尾插入图片被并入表格

复现：用工具栏插入表格，连续 Tab 填表，Escape 退出单元格，点击插入图片并选择 PNG。

实际：图片成为表格新行的第一格，而不是独立图片段落。图 03。相同素材在独立空段落插入正常，见图 07。

原因：附件插入复用通用文本插入，未隔离 Markdown 表格的结束边界。已有“点击表格下方空白补空行”的处理只覆盖鼠标点击，没有覆盖工具栏插入。

建议：表格、图片、代码块、分隔线共用按上下文补足段落边界的插入逻辑；如果当前正在编辑单元格，需要明确区分单元格图片与正文图片。

验收：位于表格末尾、表格后一行及已有空段落时插图，都符合明确的插入目标；阅读态与编辑态位置一致；撤销仅撤销这次插入。

实现入口：[附件流程](/Users/xmly/Swell/code/swell-note/src/components/workspace/workspace.tsx:1752)、[通用插入](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-editor.tsx:254)。

## 体验与展示问题

| 编号 | 优先级 | 已观察到的问题 | 建议与验收 |
| --- | --- | --- | --- |
| F05 | P2 | 新建后焦点仍在新建按钮；首次填写标题回车后焦点落回页面。两篇测试笔记均复现。 | 新建后聚焦标题；标题确认完成且新编辑器就绪后进入正文。必须用“实际改变标题”的路径测试，不能只对未修改标题按 Enter。 |
| F06 | P2 | `---:` 的金额和完成率列在编辑态右对齐、阅读态左对齐。DOM 确认阅读单元格没有 align/style，computed alignment 为 left。图 05、11。 | 阅读态透传解析器给出的对齐信息；比较正数、负数、小数和百分比，确保编辑／阅读一致。 |
| F07 | P2 | 粘贴 `图片\t待验证\n长文本\t说明`，全部进入一个单元格，换行变成 `<br>`，Tab 没有拆列。图 02。 | 识别 TSV／HTML 表格，按起始单元格扩展网格，支持整次撤销；普通单格多行文本提供明确的替代粘贴方式。 |
| F08 | P2 | 深色编辑态的蓝紫／暗红代码和脚注很难读；阅读态黄色高亮继承浅色字，文字几乎消失。图 09、11、15。 | 为 CodeMirror 配置完整深色语法色板；高亮背景与文字成对设置。重点复核代码关键字、字符串、链接、脚注、高亮和选区。 |
| F09 | P2 | 图片编辑入口不足：本轮编辑态点击 PNG 没有出现更换、尺寸或查看原图操作；阅读态才可点击放大。编辑态与阅读态图片显示尺寸也不同。图 07、08、17。 | 点击图片提供轻量工具条：查看、替换、尺寸、删除；拖拽或几档尺寸均可，操作后回到原写作位置。先处理替换和尺寸，不必上复杂图片编辑器。 |
| F10 | P2 | 失效图片只有“无法读取图片”，没有来源、重试、更换或定位 Markdown 的入口。图 06。 | 错误块保留文件名／路径并提供重试、替换、查看源引用；区分未同步附件与不存在的文件。 |
| F11 | P2 | 图片放大层没有明显关闭按钮；按 Tab 后焦点进入背后的脚注返回按钮。图 08 和 AX 焦点记录。 | 使用真正的对话框焦点管理，添加可聚焦关闭按钮、可读名称；Esc 或关闭后焦点返回原图。不能只设置 aria-modal。 |
| F12 | P2（按内容需求） | 阅读态行内／块级公式仍是 `$...$`、`$$...$$`，Mermaid 只显示代码。图 05、10。 | 对技术笔记补数学与 Mermaid 按需渲染、错误回退和查看源码。若暂不支持，应明确能力范围。当前代码块正常显示，不应误判为“图示渲染失败”。 |
| F13 | P3 | 阅读态提示块、高亮、脚注可解析，编辑态仍暴露标记；YAML 在编辑态被表现为普通 Markdown，部分行像标题。图 04、09。 | 统一已支持语法的视觉语义，活动区显示源码，非活动区保留易读呈现；属性区单独处理。 |
| F14 | P3 | 工具栏没有真实撤销可用状态；手机仅 H2 和更多中的 H3，没有 H1；表格操作按钮约 26–30px 高，部分顶部按钮 32–36px。图 01、12、13、15。 | 撤销／重做依历史状态禁用；标题用统一等级入口；优先扩大高频触控区域到约 44px，避免拥挤，真机验证误触。 |
| F15 | P3 | 重命名后元信息显示“刚刚移动”；表格笔记摘要泄漏竖线和 `<br>`；脚注标题为英文 Footnotes。图 02、06，重命名 AX 记录。 | 操作时间文案对应实际动作；表格摘要输出纯文本／表格概述；统一中文标签。 |

关键代码位置：

- F05：[标题键盘路径](/Users/xmly/Swell/code/swell-note/src/components/workspace/workspace.tsx:2120)、[新建笔记](/Users/xmly/Swell/code/swell-note/src/App.tsx:950)。当前 Enter 立即调用旧 editorRef.focus，重命名后的实例重建会让焦点失效。
- F06：[自定义 td/th](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-preview.tsx:358) 仅接收 children/node，丢弃对齐属性。
- F07：[表格 textarea](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-table-widget.ts:660) 使用默认粘贴，没有网格分发路径。
- F08：[高亮颜色](/Users/xmly/Swell/code/swell-note/src/App.css:939) 使用浅黄背景与继承文字色；[CodeMirror 配置](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-editor.tsx:365) 没有传入深色主题。
- F09–F11：[阅读态图片与放大层](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-preview.tsx:79)、[图片加载状态](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-preview.tsx:744)、[编辑态图片](/Users/xmly/Swell/code/swell-note/src/components/editor/live-preview.ts:114)。
- F12：[Markdown 插件配置](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-preview.tsx:46) 当前只有 GFM、Obsidian 扩展与代码高亮。

## 代码审查发现、尚需实际复现的风险

这些不计入上面的 15 个已观察问题。

1. 表格中文输入：单元格 keydown 在 Enter/Escape 前未判断 `isComposing`。可能把确认中文候选词当作下移／提交，应在真实中文输入法与 iOS 上复现。[代码](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-table-widget.ts:714)
2. 异步附件位置：上传开始仅记录笔记 ID，没有记录当前插入位置。同一笔记内移动光标后，完成时可能落到新位置。需要加入可控延迟验证。[代码](/Users/xmly/Swell/code/swell-note/src/components/workspace/workspace.tsx:1752)
3. 异步剪切：复制选区成功后重新读取当前选区；等待期间如果用户变更选区，复制内容与删除范围可能不一致。需使用延迟剪贴板测试。[代码](/Users/xmly/Swell/code/swell-note/src/components/editor/markdown-editor.tsx:237)

## 已经做得较好的部分

- 新建笔记不会进入只有空白的阅读态；空标题、空正文有明确占位。
- 插入表格自动选中第一个表头，Tab 连续输入和末格自动加行有效。
- 数值表格编辑态支持对齐，长表在手机阅读态有“左右滑动”提示。
- 正文、列表、任务、普通引用、阅读态代码高亮、提示块、属性、脚注均有实际呈现。
- 正文独立 PNG 可插入并缓存，阅读态可放大，Esc 可关闭。
- 手机底栏更多格式正常展开，未发生表格菜单同样的裁切。
- 同一编辑会话内撤销可用；刷新后新增正文和图片可以恢复。
- 刷新后的控制台抽查没有 error/warn；这不是长时间稳定性或完整性能结论。

## 推荐分批顺序

| 批次 | 目标 | 内容 | 完成标准 |
| --- | --- | --- | --- |
| A | 写得放心 | F01–F04，连同 F05 | 表格操作不改错正文；菜单可见；插入边界正确；模式切换保留历史；新建与标题确认焦点连贯。 |
| B | 看得清、贴得快 | F06–F08、F10–F11 | 对齐一致，深色可读，多格粘贴有效，图片失败能恢复，放大层键盘可关闭。 |
| C | 少记语法、少切模式 | F09、F12–F15 | 图片轻量操作、常用技术内容展示、编辑与阅读语义接近、标题与按钮状态统一。 |

前三项建议先做：统一活动编辑目标、保留笔记编辑会话、修复表格浮层。它们能解决多个表面问题，避免在每个按钮上分别补丁。

可以新增的便捷能力以内容操作为中心：表格网格选择与 TSV 粘贴、图片替换和尺寸、统一标题等级选择；公式和图示按实际技术笔记使用频率投入。暂不建议优先添加数据库视图、协作评论或复杂模板市场。

## 尚未覆盖

- iOS/Android 真机软键盘、中文候选词、拖选、长按菜单、系统返回与屏幕旋转。
- 超长笔记、数百行表格、连续多图／大图的输入延迟、内存与滚动性能；本轮没有量化帧率或输入耗时。
- PDF、音频、视频、CSV 附件与相机粘贴、跨 App 富文本剪贴板。
- 真实慢网、上传失败重试、多端同步冲突与断电恢复。
- 浅色主题、200% 缩放、屏幕阅读器完整验证。触控尺寸和截图观察不能代表完整无障碍达标。

## 截图证据（按采集顺序）

### 01 · 新建：模式正确，焦点留在按钮

![新建笔记](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/01-new-note.png)

### 02 · 表格：TSV 数据挤入单格

![表格粘贴](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/02-table-paste.png)

### 03 · 图片：表格末尾插图成为表格新行

![图片并入表格](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/03-image-after-table.png)

### 04 · 综合内容编辑态：属性、提示、高亮暴露源码

![综合内容编辑态](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/04-mixed-edit.png)

### 05 · 综合内容阅读态：数值对齐丢失，公式与图示为源码

![综合内容阅读态](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/05-mixed-read.png)

### 06 · 错误图片与脚注：错误缺少恢复入口

![错误图片和脚注](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/06-missing-image-footnotes.png)

### 07 · 独立图片：编辑态显示成功

![独立图片编辑态](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/07-image-edit.png)

### 08 · 图片放大：无明显关闭按钮，Tab 焦点进入背景

![图片放大](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/08-image-zoom-focus.png)

### 09 · 手机阅读首屏：属性、列表与提示块，高亮对比不足

![手机阅读首屏](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/09-mobile-read-top.png)

### 10 · 手机阅读表格：有横向滚动提示

![手机表格阅读](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/10-mobile-table-read.png)

### 11 · 手机表格编辑：数值右对齐，代码暗色难读

![手机表格编辑](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/11-mobile-table-edit.png)

### 12 · 手机表格菜单：显示展开状态却无面板

![手机表格菜单](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/12-mobile-table-menu.png)

### 13 · 手机更多格式：正常展开

![手机更多格式](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/13-mobile-more-formats.png)

### 14 · 表格格式操作：错误地向正文开头插入加粗占位

![格式操作错误目标](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/14-table-format-wrong-target.png)

### 15 · 切换模式后撤销：测试标记仍然保留

![切换模式后撤销](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/15-undo-after-mode-switch.png)

### 16 · 桌面表格菜单：同样被裁切

![桌面表格菜单](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/16-desktop-table-menu.png)

### 17 · 刷新恢复：正文和独立 PNG 仍可显示

![刷新恢复](/Users/xmly/Swell/code/swell-note/docs/editor-audit-2026-09-06/17-persistence-after-reload.png)
