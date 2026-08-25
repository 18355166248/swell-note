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
- Desktop and compact views both initialize at 100%; the official viewport API centers the content while constraining the initial zoom to 1.
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
