import { useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"

import { TooltipProvider } from "../../src/components/ui/tooltip"
import { LibraryPanel, type LibraryPanelProps, type LibraryView } from "../../src/components/workspace/workspace"
import type { FolderContextActions } from "../../src/components/workspace/context-menus"
import type { VaultCacheSummary } from "../../src/services/cache/vault-cache"
import type { VaultFolder } from "../../src/services/search/vault-folders"
import "../../src/App.css"

type Scenario = "normal" | "empty" | "readonly" | "error"

const caches: VaultCacheSummary[] = [
  { activeNoteId: "note-1", id: "cache-primary", label: "坚果云 · /Swell/产品与广告笔记库（名称很长用于截断验收）", lastSyncedAt: Date.now(), noteCount: 102, savedAt: Date.now(), sourceKind: "webdav" },
  { activeNoteId: "note-2", id: "cache-local", label: "本地 · 产品资料库", lastSyncedAt: Date.now() - 36e5, noteCount: 58, savedAt: Date.now() - 36e5, sourceKind: "tauri" },
]

const paths = [
  "XIMA广告",
  "根目录资料",
  "code",
  "code / 小说",
  "code / threejs",
  "code / 游戏",
  "code / 游戏 / 关卡设计",
  "code / 游戏 / 关卡设计 / 2026探索方案与极长文件夹名称验收",
  "code / 3D地图",
  "AI",
  "AI / 模型研究",
  "AI / 模型研究 / 提示词",
  "AI / 图像生成",
  "产品",
  "产品 / 需求文档",
  "产品 / 需求文档 / 已发布",
  "产品 / 用户研究",
  "广告",
  "广告 / 投放",
  "广告 / 投放 / FY26",
  "广告 / 创意",
  "会议记录",
  "会议记录 / 例会",
  "会议记录 / 评审",
  "个人",
  "个人 / 阅读",
  "个人 / 灵感",
  "归档",
  "归档 / 2025",
  "归档 / 2026",
]

const folders: VaultFolder[] = paths.map((path, index) => {
  const segments = path.split(" / ")
  return {
    count: (index * 7 + 2) % 31,
    depth: segments.length - 1,
    hasChildren: paths.some((candidate) => candidate.startsWith(`${path} / `)),
    label: segments.at(-1)!,
    path,
  }
})

function AuditHarness() {
  const [scenario, setScenario] = useState<Scenario>("normal")
  const [width, setWidth] = useState<200 | 230>(230)
  const [height, setHeight] = useState<520 | 720>(720)
  const [activeCacheId, setActiveCacheId] = useState("cache-primary")
  const [libraryView, setLibraryView] = useState<LibraryView>("all")
  const [selectedFolder, setSelectedFolder] = useState<string | null>("XIMA广告")
  const [expanded, setExpanded] = useState(() => new Set(paths))
  const [events, setEvents] = useState<string[]>(["验收页已就绪（所有数据均在内存中）"])
  const record = (message: string) => setEvents((current) => [message, ...current].slice(0, 8))
  const canWrite = scenario !== "readonly"
  const visibleFolders = scenario === "empty" ? [] : folders.filter((folder) => folder.depth === 0 || folder.path.split(" / ").slice(0, -1).every((_, index, segments) => expanded.has(segments.slice(0, index + 1).join(" / "))))
  const folderContextActions = useMemo<FolderContextActions>(() => ({
    canCreateNote: canWrite,
    disabled: !canWrite,
    mode: canWrite ? "webdav" : null,
    onCreateNote: (folderPath) => record(`右键新建笔记：${folderPath}`),
    onOpen: (folderPath) => record(`右键打开：${folderPath}`),
    onRequest: (request) => record(`右键请求：${request.kind}`),
  }), [canWrite])

  const props: LibraryPanelProps = {
    activeCacheId,
    canCreateFolder: canWrite,
    canCreateNote: canWrite,
    connected: scenario !== "readonly",
    connectionLabel: scenario === "readonly" ? "离线只读缓存" : "已连接坚果云",
    expandedFolderPaths: expanded,
    folderContextActions,
    folders: visibleFolders,
    isCreatingNote: false,
    isManagingFolder: false,
    isOpeningVault: false,
    isRefreshingVault: false,
    libraryView,
    localVaultSupported: true,
    noteCount: scenario === "empty" ? 0 : 102,
    starredNoteCount: scenario === "empty" ? 0 : 7,
    onCreateFolder: (name, parent) => record(`新建文件夹：${parent ? `${parent} / ` : ""}${name}`),
    onCreateNote: () => record("新建笔记"),
    onImportNotes: (files) => record(`导入回调：${files.map((file) => file.name).join("、")}`),
    onOpenLocalVault: () => record("打开本地笔记库"),
    onOpenSettings: () => record("打开设置"),
    onRefreshVault: () => record("同步当前笔记库"),
    onSelectFolder: (folder) => { setSelectedFolder(folder); setLibraryView("all"); record(`选择文件夹：${folder ?? "根目录"}`) },
    onSelectLibraryView: (view) => { setLibraryView(view); setSelectedFolder(null); record(`切换视图：${view}`) },
    onSelectVaultCache: (cacheId) => { setActiveCacheId(cacheId); record(`切换库：${cacheId}`) },
    onToggleFolder: (folderPath) => setExpanded((current) => {
      const next = new Set(current)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      record(`展开切换：${folderPath}`)
      return next
    }),
    selectedFolder,
    syncLabel: scenario === "readonly" ? "等待重新连接" : "5 项修改待同步",
    vaultCaches: caches,
    vaultError: scenario === "error" ? "无法连接远端：这是用于检查长错误文本不会挤走文件夹树的模拟信息。请检查网络后重试，现有离线笔记仍然可读。" : null,
  }

  return (
    <main className="sidebar-audit-page">
      <section className="sidebar-audit-controls" aria-label="验收控制台">
        <div><strong>文件夹优先侧栏</strong><small>独立内存验收页，不读写真实笔记库</small></div>
        <label>场景<select aria-label="场景" onChange={(event) => setScenario(event.target.value as Scenario)} value={scenario}><option value="normal">普通</option><option value="empty">空库</option><option value="readonly">只读</option><option value="error">错误</option></select></label>
        <button onClick={() => setWidth((value) => value === 230 ? 200 : 230)} type="button">宽度 {width}px</button>
        <button onClick={() => setHeight((value) => value === 720 ? 520 : 720)} type="button">高度 {height}px</button>
      </section>
      <section className="sidebar-audit-stage" style={{ height }}>
        <div className="sidebar-audit-sidebar" style={{ width }}><LibraryPanel {...props} /></div>
        <aside className="sidebar-audit-events" aria-label="回调记录"><h2>回调观测</h2>{events.map((event, index) => <p key={`${event}-${index}`}>{event}</p>)}</aside>
      </section>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(
  <MemoryRouter><TooltipProvider delayDuration={250}><AuditHarness /></TooltipProvider></MemoryRouter>,
)
