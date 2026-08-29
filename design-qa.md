# Swell Note 设计走查

## 视觉基准

- 桌面选定稿：`design/focused-workspace-desktop.png`
- 手机同风格稿：`design/focused-workspace-mobile.png`
- 综合对照图：`design/design-comparison.png`

## 实现截图

- 桌面 1440 × 1024：`design/implementation-desktop.png`
- 平板 900 × 900：`design/implementation-tablet.png`
- 手机资料库 390 × 844：`design/implementation-mobile-library.png`
- 手机笔记列表 390 × 844：`design/implementation-mobile-list.png`
- 手机编辑器 390 × 844：`design/implementation-mobile-editor.png`

## 对照结论

- 布局：桌面实现 64px 图标导航、资料库、笔记列表和编辑器四栏；平板收敛为导航、列表、编辑器三栏；手机改为资料库 → 列表 → 编辑器三级页面。无重叠、裁切或不可用控件。
- 视觉：沿用选定稿的白色 / 冷灰 / 钴蓝系统，选中项使用淡蓝底和 3px 蓝色指示线，信息区以分隔线组织，没有额外卡片化。
- 字体与密度：Geist 搭配系统中文字体；桌面列表保持紧凑扫描密度，手机正文、列表和 44px 以上触控区域适配手持操作。
- 图标与资源：统一使用 Lucide 图标和项目品牌 SVG，没有文本符号、占位图或手工 CSS 图形替代可见资产。
- 状态与交互：验证了手机资料库 → 列表 → 编辑器 → 列表 → 资料库返回路径，新建笔记、搜索、收藏、格式工具栏和 WebDAV 设置入口可操作。
- WebDAV：配置弹窗保留坚果云服务器地址、账号、第三方应用密码和远端目录；连接后远端 Markdown 替换列表并按需读取正文，密码仅驻留当前运行时会话。
- 响应式：检查 1440 × 1024、900 × 900 和 390 × 844 三个视口；手机编辑器不显示底部主导航，改用独立格式栏。
- 可访问性：主要按钮有可读标签，输入框有标签或占位说明，图标按钮使用 Tooltip/aria-label；移动端主要操作满足实际触摸尺寸。
- 控制台：在全新预览标签页复查，error/warn 为空。

## 修正记录

- P2：手机资料库搜索框最初只呈现样式、未绑定查询状态；已绑定 `query` 和 `onQueryChange`，桌面与手机搜索行为一致。
- P0：无。
- P1：无。
- 未解决的 P2：无。

## Excalidraw 沉浸式预览

### Evidence

- Source reference: `design-qa-assets/excalidraw-obsidian-reference.png`（1920 × 1080 px）
- Implementation route: `#/notes/webdav%3A%2FSwell%2FExcalidraw%2FDrawing%202026-05-25%2014.21.56.excalidraw.md`
- Implementation viewport: 1920 × 1080 CSS px
- Implementation screenshot: `design-qa-assets/excalidraw-immersive-final.jpg`
- Combined comparison: `design-qa-assets/excalidraw-side-by-side.png`
- Tested state: desktop, WebDAV cached Excalidraw note, library sidebar open, editor controls visible, default zoom fixed at 100%

### Full-view comparison

| Surface | Result | Notes |
| --- | --- | --- |
| Overall composition | Passed | The note list and document chrome are removed. The rail plus library sidebar occupy 354 px versus roughly 377 px in the reference, leaving the rest to the canvas. |
| Typography | Passed | Drawing text is rendered by the official Excalidraw package and keeps the authored hand-drawn font and scale. |
| Spacing and sizing | Passed | The immersive canvas fills the available workspace. The later user-selected default is 100% zoom, with content centered without auto-fitting to another scale. |
| Color and decoration | Passed | The canvas and strokes match Excalidraw. Swell Note keeps its existing light navigation theme while using a dark canvas title bar for focus. |
| Assets and controls | Passed | The canvas uses native official Excalidraw rendering and controls; edits are serialized back into the Obsidian Markdown drawing block and enter the local-first sync queue. |

### Comparison history

- Pass 1: `design-qa-assets/excalidraw-immersive-pass-1.jpg`。P2：强制适应内容导致图形过小、留白过多。
- Fix: desktop restores the Excalidraw file's saved zoom and scroll position; compact screens continue to fit content to avoid clipping.
- Pass 2: `design-qa-assets/excalidraw-immersive-final.jpg`。Desktop drawing scale, placement, canvas footprint and navigation-to-canvas ratio now match the reference closely. No P0, P1 or P2 visual mismatch remains.
- Follow-up preference: the saved 200% author viewport was superseded by the requested 100% default. Browser evidence: `design-qa-assets/excalidraw-zoom-100.png`（1200 × 800 CSS px）。

### Interaction and responsive checks

- Excalidraw remains a dynamic plugin chunk, so normal Markdown notes do not download its 4 MB runtime.
- The official canvas remains pannable and zoomable in editor mode.
- The official viewport API centers the content on open and caps zoom at 1, so drawings never open magnified; canvases wider than the viewport (notably on phones) scale down to stay fully visible instead of being clipped.
- Raw Markdown is hidden in immersive mode, preventing horizontal overflow and the previous broken right-side layout.
- TypeScript check, 109 unit tests, and production build passed.

### Toolbar restoration

- Source visual truth: `design-qa-assets/excalidraw-toolbar-reference.png`（770 × 326 px）。
- Implementation screenshot: `design-qa-assets/excalidraw-toolbar-final.png`（375 × 745 px，当前右侧面板视口）。
- Combined comparison: `design-qa-assets/excalidraw-toolbar-side-by-side.png`。
- State: immersive Excalidraw editor, compact right panel, cached WebDAV drawing, local-first save handler connected.
- Full-view evidence: the official shape toolbar is visible above the canvas and the right utility rail remains present; the compact viewport keeps all primary tools on one row.
- Focused-region evidence: the toolbar itself is readable in the combined comparison, so no additional crop was required.
- Fonts/typography: native Excalidraw labels and shortcuts are used; no replacement glyphs were introduced.
- Spacing/layout: toolbar position, rounded container, icon spacing and canvas separation follow the official component and the supplied reference.
- Colors/tokens: native Excalidraw selected-tool tint, borders, shadow and white canvas match the reference.
- Image/assets: all controls come from the official Excalidraw package; no custom or approximate assets are used.
- Copy/content: shape names and shortcuts are provided by the official `zh-CN` locale.
- Interaction check: DOM verification found selection, rectangle, diamond, ellipse, arrow, line, free draw, text, image, eraser, library and hand tools. User-initiated changes are debounced into the local working copy; WebDAV upload still requires the configured sync mode or an explicit sync action.
- Console/build check: TypeScript passed and all 109 tests passed.
- Comparison history: P1 missing toolbar was caused by `viewModeEnabled`; setting it to `false` restored the official editor controls. Post-fix evidence is `design-qa-assets/excalidraw-toolbar-final.png`.

final result: passed

## 移动端文件夹完整展示

**Source visual truth**

- iOS 文件夹管理参考：`/Users/xmly/Downloads/IMG_8708.PNG`
- Source pixels: 1284 × 2778，参考图包含系统状态栏与底部工具栏；本轮只复用其连续文件夹列表和清晰行分隔逻辑。

**Implementation evidence**

- Browser capture: `/private/tmp/design-qa-folder-list-flat.png`
- Implementation pixels / CSS viewport: 324 × 606，device scale factor 1，无密度归一化。
- Route / state: `http://127.0.0.1:4173/#/notes`，移动端浅色模式，文件夹普通浏览态。

**Full-view comparison evidence**

- 首页文件夹区域现在直接连续展示全部 12 个根文件夹，不再限制前 6 个，也不再出现“查看全部 / 收起文件夹”控制。
- 底部“最近笔记”区已移除，文件夹列表成为页面唯一主要内容；新建笔记悬浮按钮仍固定在可触达位置。
- Browser DOM 快照确认从“根目录”到“Excalidraw”的全部文件夹均存在，且页面中不再出现“最近笔记”。

**Focused region comparison evidence**

- 顶部搜索、文件夹标题、管理入口、新建文件夹入口以及连续列表在 324 px 宽截图中均清晰可辨；本轮没有图片资产或精细装饰差异，因此不需要额外局部裁切。

**Findings**

- Fonts and typography: passed. 沿用现有移动端字号、字重与截断规则，长名称不会挤压数量和导航箭头。
- Spacing and layout rhythm: passed. 文件夹行保持统一高度和分隔线，移除折叠控制与最近笔记后没有留下空白区块。
- Colors and visual tokens: passed. 管理、新建、普通文件夹与计数继续复用现有语义色。
- Image quality and asset fidelity: not applicable. 本轮无新增图片；图标继续使用项目现有图标库。
- Copy and content: passed. 删除了“查看全部 / 收起文件夹”和“最近笔记 / 查看全部”文案，其余标题与操作名保持一致。
- Accessibility and interaction: passed. 所有文件夹仍是独立按钮；管理模式的排序、重命名、删除与根目录保护逻辑未改变。

**Comparison history**

- P2 found: 默认仅展示 6 个文件夹，需要额外展开，且最近笔记占用首页纵向空间，不符合本轮“全部展示、不要最近笔记”的目标。
- Fix: 移除 `showAllFolders` 分支、展开按钮及最近笔记区，排序上下文直接使用完整的 `orderedRootFolders`。
- Post-fix evidence: `/private/tmp/design-qa-folder-list-flat.png` 与浏览器 DOM 快照；没有剩余 P0/P1/P2 问题。

**Primary interactions tested**

- 刷新首页后确认文件夹完整渲染。
- 确认列表中包含全部 12 个根文件夹。
- 确认“最近笔记”与文件夹展开/收起按钮均不存在。
- TypeScript、221 项单元测试和生产构建均通过。

**Follow-up polish**

- P3: 文件夹数量继续增长后，可在不恢复折叠的前提下增加首字母索引或快速搜索定位。

final result: passed

## 移动端文件夹排序与删除

**Source visual truth**

- `/Users/xmly/Downloads/IMG_8708.PNG`
- Source pixels: 1284 × 2778 px；参考状态为 iOS 备忘录文件夹编辑页，包含每行更多菜单与拖拽把手。

**Implementation evidence**

- Browser-rendered screenshot: `/private/tmp/design-qa-folder-management-final.png`
- Implementation viewport and pixels: 441 × 606 CSS px / 441 × 606 px，device density 1。
- State: mobile light theme、WebDAV 缓存笔记库、文件夹管理模式、12 个根目录。
- Comparison normalization: 来源截图包含系统状态栏和底部系统导航，且采用更高设备密度；本次以同一输入中的文件夹编辑区域、行操作位置和交互层级进行对照，不把系统栏与产品既有品牌色视为偏差。

**Full-view and focused comparison evidence**

- Full-view: 来源图和最终实现截图已在同一次视觉检查中并列打开，确认编辑态都采用“目录名 + 更多操作 + 右侧拖拽把手”的扫描结构。
- Focused region: 最终实现的首屏完整展示 8 个以上目录行，更多按钮与拖拽把手均保持独立 44 px 触摸区域，因此无需额外裁切。

**Findings**

- Fonts and typography: passed. 沿用 Swell Note 的 Geist/系统中文字体和紧凑字号；“拖动排序”、目录名及数量层级清晰，无异常换行。
- Spacing and layout rhythm: passed. 每行 51 px，操作区固定 88 px；进入管理态不会压缩目录名到不可读，也不会出现横向溢出。拖动项以阴影抬升但不改变行高。
- Colors and visual tokens: passed. 参考图的黄色操作色替换为产品既有主蓝色，删除仍使用语义红色；这是品牌约束下的预期差异。
- Image quality and asset fidelity: passed. 文件夹、更多、拖拽、重命名和删除均使用项目图标库，没有手绘 SVG、文本符号或占位资源。
- Copy and content: passed. “拖动排序”“重命名”“删除”“移入回收站/待删除”与现有本地优先同步语义一致。
- Accessibility and interaction: passed. 拖拽支持触摸/鼠标和键盘；把手、更多菜单、取消与确认均有可读名称。管理态隐藏新建笔记 FAB，避免覆盖目录和误触；虚拟“根目录”固定在顶部并带锁标识，不提供危险的重命名或删除入口。

**Comparison history**

- Pass 1 P2: 新建笔记 FAB 覆盖管理态底部目录行，降低拖拽把手可用区域。
- Fix: 文件夹管理期间隐藏新建笔记 FAB，完成管理后恢复。
- Safety fix: 将系统生成的“根目录”从可排序集合及操作菜单中排除，防止把根目录笔记误当作普通文件夹批量删除。
- Post-fix evidence: `/private/tmp/design-qa-folder-management-final.png`；目录行和两组操作区完整，无 P0/P1/P2 遗留。

**Primary interactions and runtime checks**

- 进入/退出文件夹管理模式。
- 使用键盘抓取 `XIMA广告`，向下移动到 `code` 后放置；刷新页面确认顺序仍保留，再恢复原始顺序。
- 打开更多菜单，验证重命名和删除入口；进入删除确认后取消，未改动远端数据。
- 单元测试：221 passed，1 skipped。TypeScript 与生产构建通过。

**Follow-up polish**

- P3: 二级目录未来可复用同一 Sortable 行组件，在具体目录页提供同级子目录排序；当前首版覆盖主页根目录管理。

final result: passed

## 移动端侧边栏与快捷操作重构

**Source visual truth**

- `/Users/xmly/.codex/generated_images/01a017f9-55e8-7f02-b3c4-1a56bc7cfb80/exec-0affb281-3176-4c27-9428-244e6f0ad479.png`
- Source pixels: 852 × 1846（按 2× 密度解释为 426 × 923 CSS px）。

**Implementation evidence**

- Main page: `/Users/xmly/Swell/code/swell-note/design-qa-mobile.png`
- Drawer state: `/Users/xmly/Swell/code/swell-note/design-qa-mobile-drawer.png`
- Normalized comparison: `/Users/xmly/Swell/code/swell-note/design-qa-comparison.png`
- Browser viewport and implementation pixels: 441 × 606 CSS px / 441 × 606 px，device density 1。
- Normalization: source was interpreted at 426 × 923 CSS px and cropped to its top 606 px; implementation retained its native 441 × 606 capture. The 15 px width difference is recorded and was not treated as design drift.
- State: mobile light theme, cached WebDAV library, offline/not connected, 81 notes, 12 root folders.

**Full-view and focused comparison evidence**

- Full-view: the comparison image verifies the compact header, search, split folder actions, folder rows, collapsed folder affordance, recent-note section, and bottom-right note FAB in one combined input.
- Focused region: a separate crop was unnecessary because the complete header and folder-action region remain readable at native capture size. The drawer is verified in its dedicated full-height screenshot and semantic DOM snapshot.

**Findings**

- Fonts and typography: passed. Geist with the existing Chinese system fallback preserves the compact hierarchy; headings, row labels, counts, and secondary metadata do not wrap unexpectedly.
- Spacing and layout rhythm: passed after iteration. The implementation intentionally uses a denser 51 px folder row than the concept image so more real Vault content remains visible. All primary icon actions retain 44 px touch targets.
- Colors and visual tokens: passed. The implementation reuses the existing white/cool-gray/primary-blue token system. Management and creation locations receive a light primary tint without adding a new visual language.
- Image quality and asset fidelity: passed. The drawer uses the existing Swell Note SVG logo; action and navigation glyphs use the project's Lucide set. No bitmap placeholder, text glyph, CSS drawing, or approximate logo was introduced.
- Copy and content: passed. Drawer labels, source state, folder count, recent notes, and app-section names use current product vocabulary and real cached data.
- Navigation and accessibility: passed. Drawer has a dialog label, modal state, backdrop and Escape close path; icon buttons expose aria labels; Notes, Todos and Settings remain reachable after removing the bottom tab bar.
- State variance: the source concept shows an enabled create-folder action, while this browser capture is an offline WebDAV cache where empty-folder creation is intentionally unavailable. The implementation keeps the shortcut visible and disabled rather than hiding its location.

**Comparison history**

- Pass 1 P2: rendering every root folder pushed the recent-note section entirely below the 606 px viewport, reducing the information-density improvement promised by the selected concept.
- Fix: show the first six root folders, add an explicit `查看全部 12 个文件夹` expansion control, and render five recent notes below them. Management mode automatically expands all folders.
- Post-fix evidence: `design-qa-mobile.png` and `design-qa-comparison.png`; the recent-note heading is now visible above the fold while all remote folders remain one tap away. No P0/P1/P2 issue remains.

**Primary interactions and runtime checks**

- Open/close drawer; switch Notes → Todos → Notes; select note-library shortcuts.
- Enter and exit folder-management mode; verified rename buttons appear without replacing folder navigation.
- Verified create-folder shortcut remains at the far right and new-note FAB remains at the bottom right.
- Browser console: earlier Fast Refresh errors were transient while the old export was being removed. After a full reload the current page produced only Vite debug and React DevTools info messages, with no new runtime error.
- TypeScript: passed. Unit tests: 218 passed, 1 skipped. Production build: passed.

**Follow-up polish**

- P3: after WebDAV empty-directory queueing is implemented, the visible create-folder shortcut can become enabled for offline cached libraries without changing this layout.

final result: passed

## 侧栏同步区与坚果云凭据流程

**Evidence**

- Source visual truth: `/var/folders/7w/hsspqlq52mj2vrwmmpdjptsh0000gn/T/codex-clipboard-172b4f5a-c01e-401e-b22d-bb5d2cb7125d.png`（303 × 235 px，用户标注的桌面侧栏底部裁切状态）。
- Browser-rendered implementation: `/private/tmp/swell-note-sync-layout-final.png`（1280 × 720 px）。
- Implementation viewport: 1280 × 720 CSS px，devicePixelRatio 1；来源是局部裁切图，故按同一可见区域和控件边界判断，不做整体密度对齐。
- State: desktop production preview、WebDAV cached library、offline/not connected、light theme。

**Full-view and focused comparison**

- Full-view evidence shows the original four-column desktop hierarchy is unchanged; the fix only reallocates the bottom sync row's two grid tracks.
- The source already provides the focused region. In the implementation full screenshot, the complete `连接` label and refresh icon are readable at the sidebar bottom, so an extra implementation crop was not needed.
- DOM geometry confirms the 58 px action button is entirely inside the 242 px sync shell (`button: x 246–304`, `shell: x 64–306`). The shell has `scrollWidth === clientWidth === 242`, so no hidden horizontal overflow remains.

**Findings**

- Fonts and typography: passed. The existing compact 10.5–11.5 px sidebar hierarchy and Geist/PingFang stack remain unchanged; `连接` is no longer truncated.
- Spacing and layout rhythm: passed. The action track is 62 px, the button is 58 px, and the summary track keeps the remaining flexible width without overlapping the note list.
- Colors and visual tokens: passed. Existing muted foreground, border, and hover tokens are reused; no new visual language was introduced.
- Image quality and asset fidelity: not applicable. The visible refresh icon remains the project's Lucide icon and no raster asset was added.
- Copy and content: passed. `连接` remains concise, while the accessible label continues to be `重新连接并更新`.
- Accessibility and interaction: passed. The action is a semantic button with a complete accessible label; layout clipping no longer reduces its visible affordance.
- Error and credential flow: native builds persist the verified application password in OS secure storage. Network/offline failures retain both the credential and local sync queue; only an explicit WebDAV 401 clears the rejected credential and opens the password prompt. Browser builds intentionally remain session-only.

**Comparison history**

- P2 found: the original 42 px action track was narrower than the rendered icon-plus-label button, pushing part of `连接` into the adjacent pane and clipping it.
- Fix: increased the action track to 62 px, fixed the action button at 58 px with compact spacing, and constrained the shell overflow.
- Post-fix evidence: `/private/tmp/swell-note-sync-layout-final.png`; browser geometry and visual comparison show no remaining P0/P1/P2 issue.

**Primary interactions and runtime checks**

- Opened the cached WebDAV note library and verified the bottom `连接` action is visible and remains clickable.
- Opened `#/settings/webdav` and verified Web correctly communicates its session-only security boundary.
- Verified the production preview console contains no warnings or errors.
- Unit tests: 218 passed, 1 skipped. Production build: passed.

**Follow-up polish**

- P3: native Keychain / Credential Manager copy is covered by component state and native-store tests; a signed-package smoke test can additionally capture the platform-specific store name before release.

final result: passed

## 阅读 / 编辑模式感知优化


**Source visual truth**

- Edit mode before improvement: `/private/tmp/swell-note-mode-audit/01-edit-mode.png`
- Read mode before improvement: `/private/tmp/swell-note-mode-audit/02-read-mode.png`

**Implementation evidence**

- Desktop edit mode: `/private/tmp/swell-note-mode-qa-edit.png`
- Desktop read mode: `/private/tmp/swell-note-mode-qa-preview.png`
- Mobile edit mode after overflow fix: `/private/tmp/swell-note-mode-qa-mobile-edit-final.png`
- Desktop viewport: 1910 × 1074 CSS px, device scale factor 0.67; source and implementation screenshots are both 2851 × 1603 px, so no density normalization was required.
- State: the same cached WebDAV Markdown note, light theme, read and edit states.

**Full-view comparison evidence**

- The implementation preserves the existing three-pane hierarchy, typography, spacing, document width, and content wrapping.
- Edit mode now adds a stable blue editor edge and an inline `编辑中 · 保存状态` pill without changing the document's usable width.
- Read mode removes the format toolbar and edit-state decoration, keeping the original clean reading surface.
- The persistent segmented control exposes both `阅读` and `编辑`; the active option is represented visually and with `aria-pressed`.

**Focused region comparison evidence**

- A separate crop was not needed because the title metadata, editor edge, toolbar, and mode-control state are legible in the full desktop capture.
- DOM inspection additionally verified the named `笔记显示模式` group, mutually exclusive pressed states, hidden edit status in read mode, and visible formatting toolbar only in edit mode.

**Findings**

- Fonts and typography: passed. Existing Geist/PingFang typography, weights, line heights, and document hierarchy remain unchanged.
- Spacing and layout rhythm: passed after the mobile overflow fix. The new indicators do not reflow the document body or change table/editor width.
- Colors and visual tokens: passed. New states reuse `--primary`, `--blue-soft`, `--border`, and existing semantic error colors.
- Image quality and asset fidelity: not applicable; this interaction contains no new raster or custom visual assets. Icons reuse the project's Lucide set.
- Copy and content: passed. `阅读`, `编辑`, `编辑中`, and the existing save-state vocabulary are concise and consistent.
- Accessibility and interaction: passed. Buttons have explicit labels, `aria-pressed`, a labeled group, keyboard access, and the existing Cmd/Ctrl+E shortcut remains functional.

**Comparison history**

- P2 found: a narrow viewport could allow long editor content to widen the mobile workspace and push title-bar actions outside the usable screen.
- Fix: constrained `.mobile-workspace` and compact `.note-editor` to the viewport and clipped overflow at the page shell, leaving horizontal overflow to the body/editor region.
- Post-fix evidence: `/private/tmp/swell-note-mode-qa-mobile-edit-final.png`; the compact editor is constrained to the mobile viewport and the mode group remains available.

**Primary interactions tested**

- Click `阅读模式` and `编辑模式`.
- Verify only one option is pressed at a time.
- Verify read mode hides the formatting toolbar and edit status.
- Verify Cmd/Ctrl+E returns to edit mode.
- Reload while in edit mode and verify the cached global mode remains edit.
- Browser console checked: no warnings or errors.

**Follow-up polish**

- P3: a future dark theme pass should tune the edit edge and segmented-control shadow against dark surface tokens.

final result: passed

## 侧栏同步与凭据流程最终复核

- 完整证据、五项视觉检查、异常兜底与比较记录见上文“侧栏同步区与坚果云凭据流程”。
- 最终生产预览仍保持按钮完整、无横向溢出，控制台无 warning/error；218 项测试通过，生产构建通过。

final result: passed
