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
