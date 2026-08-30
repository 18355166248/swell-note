import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Database,
  Download,
  FileCheck2,
  FileUp,
  HardDrive,
  Info,
  ListTodo,
  Monitor,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  Trash2,
  Undo2,
} from "lucide-react"
import { Outlet, useLocation } from "react-router-dom"

import {
  AppNavigationRail,
  MobileNavigationDrawer,
} from "@/components/workspace/workspace"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { extractMarkdownTasks, type MarkdownTask } from "@/services/tasks/markdown-tasks"
import {
  deleteVaultAttachments,
  listVaultAttachments,
  type VaultCacheSummary,
} from "@/services/cache/vault-cache"
import { inspectCachedAttachments, type AttachmentMaintenanceReport } from "@/services/vault/attachment-maintenance"
import { inspectStorageQuota, requestPersistentStorage, type StorageQuotaReport } from "@/services/storage/storage-quota"
import { getNativeSearchIndexStatus, supportsNativeSearchIndex, type NativeSearchIndexStatus } from "@/services/search/sqlite-note-index"
import { summarizeWebDavSync } from "@/services/sync/sync-summary"
import type { AutoSyncMode } from "@/services/sync/sync-preferences"
import type { SyncLogEntry } from "@/services/sync/sync-log"
import type { Note } from "@/types/note"
import type { CachePrivacyMode } from "@/services/cache/cache-privacy"
import type { TrashEntry, TrashRetentionDays } from "@/services/trash/trash-entry"
import type { ColorMode } from "@/services/preferences/ui-preferences"
import {
  checkForAppUpdate,
  installAppUpdate,
  supportsAppUpdater,
  type AppUpdate,
} from "@/services/release/app-updater"

type NavigationProps = {
  connected: boolean
  onNavigate: (path: string) => void
  onOpenSync: () => void
}

export function TodoPage({
  connected,
  indexProgress,
  notes,
  onCreateTask,
  onNavigate,
  onOpenNote,
  onOpenSync,
  onToggleTask,
  quickTaskTargetTitle,
}: NavigationProps & {
  indexProgress: { indexed: number; total: number } | null
  notes: Note[]
  onCreateTask: (text: string) => boolean
  onOpenNote: (note: Note) => void
  onToggleTask: (task: MarkdownTask, checked: boolean) => void
  quickTaskTargetTitle: string | null
}) {
  const [filter, setFilter] = useState<"all" | "completed" | "pending">("pending")
  const [newTask, setNewTask] = useState("")
  const tasks = useMemo(() => extractMarkdownTasks(notes), [notes])
  const visibleTasks = filter === "all"
    ? tasks
    : tasks.filter((task) => filter === "completed" ? task.checked : !task.checked)
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])

  return (
    <main className="route-page-shell">
      <AppNavigationRail activeSection="todos" connected={connected} onNavigate={onNavigate} onOpenSync={onOpenSync} />
      <section className="route-main-panel">
        <header className="route-page-header">
          <MobileNavigationDrawer activeSection="todos" connected={connected} onNavigate={onNavigate} />
          <div>
            <span className="eyebrow">Markdown 任务</span>
            <h1>待办</h1>
          </div>
          <span className="route-count">{tasks.filter((task) => !task.checked).length} 项待完成</span>
        </header>
        <div className="todo-filter" role="group" aria-label="待办筛选">
          {(["pending", "all", "completed"] as const).map((value) => (
            <Button
              data-active={filter === value}
              key={value}
              onClick={() => setFilter(value)}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
            >
              {value === "pending" ? "待完成" : value === "all" ? "全部" : "已完成"}
            </Button>
          ))}
        </div>
        <ScrollArea className="route-scroll-area">
          <div className="todo-content">
            <form
              className="todo-quick-create"
              onSubmit={(event) => {
                event.preventDefault()
                const value = newTask.trim()
                if (value && onCreateTask(value)) setNewTask("")
              }}
            >
              <input
                aria-label="新待办内容"
                disabled={!quickTaskTargetTitle}
                onChange={(event) => setNewTask(event.target.value)}
                placeholder={quickTaskTargetTitle
                  ? `快速添加到「${quickTaskTargetTitle}」…`
                  : "没有可写入的 Markdown 笔记"}
                value={newTask}
              />
              <Button disabled={!quickTaskTargetTitle || !newTask.trim()} size="sm" type="submit">添加</Button>
            </form>
            <div className="route-hint">
              <ListTodo />
              <span>{indexProgress && indexProgress.indexed < indexProgress.total
                ? `正在读取全库正文并建立待办索引：${indexProgress.indexed}/${indexProgress.total}`
                : <>已聚合缓存正文中的 <code>- [ ]</code> 任务；点击任务可回到来源文档。</>}</span>
            </div>
            {visibleTasks.length > 0 ? (
              <div className="todo-list">
                {visibleTasks.map((task) => (
                  <div
                    className="todo-row"
                    key={task.id}
                  >
                    <button
                      aria-label={task.checked ? `将“${task.text}”设为未完成` : `完成“${task.text}”`}
                      className="todo-check"
                      data-checked={task.checked}
                      disabled={notesById.get(task.noteId)?.readOnly !== false}
                      onClick={() => onToggleTask(task, !task.checked)}
                      title={notesById.get(task.noteId)?.readOnly !== false ? "只读笔记中的待办不能修改" : undefined}
                      type="button"
                    >
                      {task.checked ? <CheckCircle2 /> : null}
                    </button>
                    <button
                      className="todo-source-link"
                      onClick={() => {
                        const note = notesById.get(task.noteId)
                        if (note) onOpenNote(note)
                      }}
                      type="button"
                    >
                      <span>
                        <strong data-completed={task.checked}>{task.text}</strong>
                        <small>{task.noteTitle} · 第 {task.line} 行</small>
                      </span>
                      <ChevronRight />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="route-empty-state">
                <FileCheck2 />
                <h2>{filter === "pending" ? "当前没有待完成任务" : "没有符合条件的任务"}</h2>
                <p>打开包含 Markdown 任务列表的远程文档后，这里会自动汇总。</p>
                <Button onClick={() => onNavigate("/notes")} variant="outline">返回笔记</Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </section>
    </main>
  )
}

const settingsEntries = [
  { description: "跟随系统或选择浅色、深色界面", icon: Sun, label: "外观", path: "/settings/appearance" },
  { description: "查看待同步、冲突和失败项，并手动发起同步", icon: RefreshCw, label: "同步状态", path: "/settings/sync" },
  { description: "坚果云地址、账号、应用密码与远端目录", icon: Cloud, label: "WebDAV 连接", path: "/settings/webdav" },
  { description: "查看并切换保存在本机的 Vault 快照", icon: Database, label: "离线缓存", path: "/settings/cache" },
  { description: "检查搜索索引与未使用附件缓存", icon: HardDrive, label: "存储维护", path: "/settings/storage" },
  { description: "批量恢复已删除笔记，并设置自动清理期限", icon: Trash2, label: "回收站", path: "/settings/trash" },
  { description: "版本、数据边界与开源组件", icon: Info, label: "关于 Swell Note", path: "/settings/about" },
]

export function SettingsLayout({ connected, onNavigate, onOpenSync }: NavigationProps) {
  const location = useLocation()
  const activeEntry = settingsEntries.find((entry) => location.pathname === entry.path)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    // 二级路由切换后把读屏与键盘焦点送到新页面标题，避免焦点停在已经卸载的菜单按钮上。
    if (activeEntry) headingRef.current?.focus({ preventScroll: true })
  }, [activeEntry])

  return (
    <main className="settings-route-shell">
      <AppNavigationRail activeSection="settings" connected={connected} onNavigate={onNavigate} onOpenSync={onOpenSync} />
      <aside className="settings-sidebar">
        <div className="settings-sidebar-title"><Settings /><strong>设置</strong></div>
        <nav aria-label="设置导航">
          {settingsEntries.map((entry) => (
            <button
              data-active={location.pathname === entry.path}
              key={entry.path}
              onClick={() => onNavigate(entry.path)}
              type="button"
            >
              <entry.icon />
              <span>{entry.label}</span>
              <ChevronRight />
            </button>
          ))}
        </nav>
      </aside>
      <section className="settings-detail-panel">
        <header className="settings-detail-header">
          {!activeEntry ? <MobileNavigationDrawer activeSection="settings" connected={connected} onNavigate={onNavigate} /> : null}
          {activeEntry ? (
            <Button aria-label="返回设置" className="settings-mobile-back" onClick={() => onNavigate("/settings")} size="icon" variant="ghost">
              <ArrowLeft />
            </Button>
          ) : null}
          <div>
            <span className="eyebrow">应用设置</span>
            <h1 ref={headingRef} tabIndex={-1}>{activeEntry?.label ?? "设置"}</h1>
          </div>
        </header>
        <ScrollArea className="route-scroll-area">
          <Outlet />
        </ScrollArea>
      </section>
    </main>
  )
}

const colorModeOptions = [
  { description: "自动使用设备当前的浅色或深色外观", icon: Monitor, label: "跟随系统", value: "system" },
  { description: "始终使用明亮、清晰的浅色界面", icon: Sun, label: "浅色", value: "light" },
  { description: "始终使用适合弱光环境的深色界面", icon: Moon, label: "深色", value: "dark" },
] as const

export function AppearanceSettingsPage({
  colorMode,
  onColorModeChange,
}: {
  colorMode: ColorMode
  onColorModeChange: (mode: ColorMode) => void
}) {
  return (
    <div className="settings-content-card">
      <div className="settings-content-heading">
        <Sun />
        <div><h2>界面外观</h2><p>选择会保存在当前设备，刷新页面和重新打开应用后继续生效。</p></div>
      </div>
      <div aria-label="界面颜色模式" className="appearance-options" role="radiogroup">
        {colorModeOptions.map((option) => (
          <button
            aria-checked={colorMode === option.value}
            data-active={colorMode === option.value}
            key={option.value}
            onClick={() => onColorModeChange(option.value)}
            role="radio"
            type="button"
          >
            <span className="appearance-option-icon"><option.icon /></span>
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
            {colorMode === option.value ? <Check /> : null}
          </button>
        ))}
      </div>
    </div>
  )
}

export function StorageMaintenancePage({
  activeCacheId,
  notes,
  onExportBackup,
  onRebuildSearchIndex,
  onRestoreBackup,
}: {
  activeCacheId: string | null
  notes: Note[]
  onExportBackup: () => Promise<boolean>
  onRebuildSearchIndex: () => Promise<void>
  onRestoreBackup: (file: File) => Promise<boolean>
}) {
  const [attachments, setAttachments] = useState<AttachmentMaintenanceReport | null>(null)
  const [indexStatus, setIndexStatus] = useState<NativeSearchIndexStatus | null>(null)
  const [storageQuota, setStorageQuota] = useState<StorageQuotaReport | null>(null)
  const [busyAction, setBusyAction] = useState<"attachments" | "backup" | "index" | "persist" | "restore" | null>(null)
  const [message, setMessage] = useState("")
  const restoreInputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    const [entries, nativeStatus, quota] = await Promise.all([
      activeCacheId ? listVaultAttachments(activeCacheId) : Promise.resolve([]),
      getNativeSearchIndexStatus(),
      inspectStorageQuota(),
    ])
    setAttachments(inspectCachedAttachments(notes, entries))
    setIndexStatus(nativeStatus)
    setStorageQuota(quota)
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      activeCacheId ? listVaultAttachments(activeCacheId) : Promise.resolve([]),
      getNativeSearchIndexStatus(),
      inspectStorageQuota(),
    ]).then(([entries, nativeStatus, quota]) => {
      if (cancelled) return
      setAttachments(inspectCachedAttachments(notes, entries))
      setIndexStatus(nativeStatus)
      setStorageQuota(quota)
    }).catch(() => {
      if (!cancelled) setMessage("读取存储状态失败，请稍后重试")
    })
    return () => { cancelled = true }
  }, [activeCacheId, notes])

  const cleanupAttachments = async () => {
    if (!attachments || attachments.orphaned.length === 0) return
    if (!window.confirm(`将删除 ${attachments.orphaned.length} 个未被正文引用的本机附件缓存，不会删除坚果云文件。是否继续？`)) return
    setBusyAction("attachments")
    setMessage("")
    try {
      await deleteVaultAttachments(attachments.orphaned.map((entry) => entry.key))
      await refresh()
      setMessage("未使用的本机附件缓存已清理")
    } catch {
      setMessage("附件缓存清理失败，现有文件未受影响")
    } finally {
      setBusyAction(null)
    }
  }

  const rebuildIndex = async () => {
    if (!window.confirm("搜索索引会从当前已缓存的 Markdown 正文重新建立，不会修改任何笔记。是否继续？")) return
    setBusyAction("index")
    setMessage("")
    try {
      await onRebuildSearchIndex()
      await refresh()
      setMessage("搜索索引已重新建立")
    } catch {
      setMessage("搜索索引重建失败，可以重新打开笔记库后再试")
    } finally {
      setBusyAction(null)
    }
  }

  const exportBackup = async () => {
    setBusyAction("backup")
    setMessage("")
    try {
      const completed = await onExportBackup()
      setMessage(completed ? "整库备份已生成，请妥善保管下载的 ZIP 文件" : "整库备份未完成，请查看错误提示后重试")
    } finally {
      setBusyAction(null)
    }
  }

  const restoreBackup = async (file: File) => {
    setBusyAction("restore")
    setMessage("")
    try {
      const completed = await onRestoreBackup(file)
      setMessage(completed ? "备份恢复流程已完成；同名文件会保留原文件并跳过" : "恢复已取消或失败，现有同名文件未被覆盖")
    } finally {
      setBusyAction(null)
      if (restoreInputRef.current) restoreInputRef.current.value = ""
    }
  }

  const persistStorage = async () => {
    setBusyAction("persist")
    setMessage("")
    try {
      const granted = await requestPersistentStorage()
      await refresh()
      setMessage(granted
        ? "离线数据已获得持久化保护，系统不会在空间紧张时自动清理"
        : "当前平台未授予持久化；建议定期导出整库备份")
    } catch {
      setMessage("申请持久化存储失败，现有离线数据未受影响")
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="settings-content-card storage-maintenance-page">
      <div className="settings-content-heading">
        <HardDrive />
        <div><h2>本机数据状态</h2><p>这里只清理可重建索引和本机附件缓存，不会直接修改 Vault 或坚果云文件。</p></div>
      </div>
      <div className="maintenance-card-list">
        <section>
          <div>
            <strong>离线存储容量</strong>
            <small>{!storageQuota
              ? "正在读取应用存储配额…"
              : !storageQuota.supported
                ? "当前平台不提供容量查询，由系统管理应用数据"
                : `${formatBytes(storageQuota.usageBytes ?? 0)} / ${formatBytes(storageQuota.quotaBytes ?? 0)}${storageQuota.usagePercent !== null ? ` · ${storageQuota.usagePercent}%` : ""} · ${storageQuota.persisted ? "已持久化" : "可能被系统清理"}`}</small>
            {storageQuota?.usagePercent !== null && storageQuota?.usagePercent !== undefined ? (
              <progress aria-label="离线存储占用" max="100" value={storageQuota.usagePercent} />
            ) : null}
          </div>
          <Button
            disabled={!storageQuota?.supported || storageQuota.persisted === true || busyAction !== null}
            onClick={() => void persistStorage()}
            variant="outline"
          >
            {busyAction === "persist" ? <RefreshCw className="spin" /> : <HardDrive />}
            {storageQuota?.persisted ? "已持久化" : "保护离线数据"}
          </Button>
        </section>
        <section>
          <div><strong>全文搜索索引</strong><small>{supportsNativeSearchIndex()
            ? indexStatus
              ? `${indexStatus.indexedNotes} 条 · ${formatBytes(indexStatus.databaseSizeBytes)} · 结构版本 ${indexStatus.schemaVersion}`
              : "正在读取索引状态…"
            : "Web 端使用内存索引，重新打开笔记库即可重建"}</small></div>
          <Button disabled={!supportsNativeSearchIndex() || busyAction !== null} onClick={() => void rebuildIndex()} variant="outline">
            {busyAction === "index" ? <RefreshCw className="spin" /> : null}重建索引
          </Button>
        </section>
        <section>
          <div><strong>附件离线缓存</strong><small>{attachments
            ? attachments.scanComplete
              ? `${attachments.entries.length} 个 · ${formatBytes(attachments.bytes)} · ${attachments.orphaned.length} 个未使用`
              : `${attachments.entries.length} 个 · ${formatBytes(attachments.bytes)} · 正文索引完成后可巡检`
            : "正在检查附件引用…"}</small></div>
          <Button disabled={!attachments?.scanComplete || !attachments.orphaned.length || busyAction !== null} onClick={() => void cleanupAttachments()} variant="outline">
            {busyAction === "attachments" ? <RefreshCw className="spin" /> : null}清理未使用缓存
          </Button>
        </section>
        <section>
          <div><strong>整库备份与恢复</strong><small>ZIP 保留 Markdown 目录结构和已缓存/可读取附件；恢复遇到同名文件会跳过，不覆盖。</small></div>
          <div className="storage-backup-actions">
            <Button disabled={!activeCacheId || busyAction !== null} onClick={() => void exportBackup()} variant="outline">
              {busyAction === "backup" ? <RefreshCw className="spin" /> : <Download />}备份 ZIP
            </Button>
            <Button disabled={!activeCacheId || busyAction !== null} onClick={() => restoreInputRef.current?.click()} variant="outline">
              {busyAction === "restore" ? <RefreshCw className="spin" /> : <FileUp />}恢复 ZIP
            </Button>
            <input
              accept=".zip,.swell.zip,application/zip"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void restoreBackup(file)
              }}
              ref={restoreInputRef}
              type="file"
            />
          </div>
        </section>
      </div>
      {message ? <p aria-live="polite" className="maintenance-message">{message}</p> : null}
    </div>
  )
}

export function SettingsOverview({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="settings-overview">
      <p>连接、缓存和应用信息都放在独立页面中。地址栏会记录当前层级，刷新后仍停留在原页面。</p>
      <div className="settings-card-list">
        {settingsEntries.map((entry) => (
          <button key={entry.path} onClick={() => onNavigate(entry.path)} type="button">
            <span className="settings-card-icon"><entry.icon /></span>
            <span><strong>{entry.label}</strong><small>{entry.description}</small></span>
            <ChevronRight />
          </button>
        ))}
      </div>
    </div>
  )
}

export function CacheSettingsPage({
  activeCacheId,
  cachePrivacyMode,
  caches,
  onClearActiveCache,
  onDeleteCache,
  onPrivacyModeChange,
  onSelectCache,
}: {
  activeCacheId: string | null
  cachePrivacyMode: CachePrivacyMode
  caches: VaultCacheSummary[]
  onClearActiveCache: () => void
  onDeleteCache: (cacheId: string) => void
  onPrivacyModeChange: (mode: CachePrivacyMode) => void
  onSelectCache: (cacheId: string) => void
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  return (
    <div className="settings-content-card">
      <div className="settings-content-heading">
        <Database />
        <div><h2>本机 Vault 快照</h2><p>已缓存正文可离线阅读和编辑，重新连接后再手动同步。</p></div>
      </div>
      <fieldset className="cache-privacy-options">
        <legend>离线缓存隐私</legend>
        <label>
          <input checked={cachePrivacyMode === "full"} name="cache-privacy" onChange={() => onPrivacyModeChange("full")} type="radio" />
          <span><strong>完整离线缓存</strong><small>保存已读取正文和附件，断网时仍可阅读。</small></span>
        </label>
        <label>
          <input checked={cachePrivacyMode === "metadata"} name="cache-privacy" onChange={() => onPrivacyModeChange("metadata")} type="radio" />
          <span><strong>仅保存目录</strong><small>移除已同步正文和附件；未同步草稿会保留，避免丢失修改。</small></span>
        </label>
      </fieldset>
      {caches.length > 0 ? (
        <div className="settings-cache-list">
          {caches.map((cache) => (
            <div className="settings-cache-row" data-active={cache.id === activeCacheId} key={cache.id}>
              <button onClick={() => onSelectCache(cache.id)} type="button">
                <span><strong>{cache.label}</strong><small>{cache.noteCount} 篇 · {formatCacheDate(cache.savedAt)}</small></span>
                {cache.id === activeCacheId ? <span className="settings-active-badge">当前</span> : <ChevronRight />}
              </button>
              {cache.id !== activeCacheId ? (
                pendingDeleteId === cache.id ? (
                  <span className="cache-delete-confirm">
                    <Button onClick={() => setPendingDeleteId(null)} size="sm" variant="ghost">取消</Button>
                    <Button onClick={() => { onDeleteCache(cache.id); setPendingDeleteId(null) }} size="sm" variant="destructive">确认删除</Button>
                  </span>
                ) : (
                  <Button aria-label={`删除缓存 ${cache.label}`} onClick={() => setPendingDeleteId(cache.id)} size="icon-sm" variant="ghost"><Trash2 /></Button>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : <p className="settings-empty-copy">还没有离线缓存。连接坚果云或打开本地 Vault 后会自动创建。</p>}

      {activeCacheId ? (
        <div className="cache-danger-zone">
          <div>
            <strong>断开并清除当前缓存</strong>
            <small>
              移除本机保存的正文、目录、回收站与附件队列，并结束当前连接会话。
              服务器地址和账号会保留，重新连接后可再次下载；未同步的本地修改会一并丢失。
            </small>
          </div>
          {clearing ? (
            <span className="cache-delete-confirm">
              <Button onClick={() => setClearing(false)} size="sm" variant="ghost">取消</Button>
              <Button onClick={() => { onClearActiveCache(); setClearing(false) }} size="sm" variant="destructive">
                确认清除
              </Button>
            </span>
          ) : (
            <Button onClick={() => setClearing(true)} size="sm" variant="outline">断开并清除</Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

const retentionOptions: { label: string; value: TrashRetentionDays }[] = [
  { label: "7 天", value: 7 },
  { label: "30 天", value: 30 },
  { label: "90 天", value: 90 },
  { label: "永久保留", value: "forever" },
]

export function TrashSettingsPage({
  busy,
  entries,
  onPurge,
  onRestore,
  onRetentionChange,
  retention,
}: {
  busy: boolean
  entries: TrashEntry[]
  onPurge: (entryIds: ReadonlySet<string>) => void
  onRestore: (entryIds: ReadonlySet<string>) => void
  onRetentionChange: (retention: TrashRetentionDays) => void
  retention: TrashRetentionDays
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [confirmingPurge, setConfirmingPurge] = useState(false)
  const selectedCount = selectedIds.size
  const allSelected = entries.length > 0 && selectedCount === entries.length

  useEffect(() => {
    const availableIds = new Set(entries.map((entry) => entry.id))
    setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))))
  }, [entries])

  const toggleEntry = (entryId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
    setConfirmingPurge(false)
  }

  return (
    <div className="settings-content-card trash-page">
      <div className="trash-toolbar">
        <div>
          <h2>回收站</h2>
          <p>删除项保存在当前 Vault 的本机快照中；本地文件会移动到隐藏目录 `.swell-trash`。</p>
        </div>
        <div className="trash-retention">
          <span id="trash-retention-label">自动清理</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-labelledby="trash-retention-label" size="sm" variant="outline">
                {/* 保留期若不在预设内（旧版本或被改写的本机配置），显示真实天数而不是谎报默认值。 */}
                {retentionOptions.find((option) => option.value === retention)?.label
                  ?? (retention === "forever" ? "永久保留" : `${retention} 天`)}
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {retentionOptions.map((option) => (
                <DropdownMenuItem key={String(option.value)} onClick={() => onRetentionChange(option.value)}>
                  <Check className={retention === option.value ? "opacity-100" : "opacity-0"} />
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {entries.length > 0 ? (
        <>
          <div className="trash-batch-actions">
            <label><input checked={allSelected} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(entries.map((entry) => entry.id)))} type="checkbox" />全选</label>
            <span>已选择 {selectedCount} 项</span>
            <Button disabled={busy || selectedCount === 0} onClick={() => { onRestore(selectedIds); setSelectedIds(new Set()) }}><Undo2 />批量恢复</Button>
            {confirmingPurge ? (
              <>
                <Button onClick={() => setConfirmingPurge(false)} variant="ghost">取消</Button>
                <Button disabled={busy} onClick={() => { onPurge(selectedIds); setSelectedIds(new Set()); setConfirmingPurge(false) }} variant="destructive">确认永久删除</Button>
              </>
            ) : <Button disabled={busy || selectedCount === 0} onClick={() => setConfirmingPurge(true)} variant="outline">永久删除</Button>}
          </div>
          <div className="trash-list">
            {entries.map((entry) => (
              <label className="trash-row" key={entry.id}>
                <input checked={selectedIds.has(entry.id)} onChange={() => toggleEntry(entry.id)} type="checkbox" />
                <span className="trash-row-icon">{entry.kind === "folder" ? <Database /> : <FileCheck2 />}</span>
                <span><strong>{entry.kind === "folder" ? entry.folderPath : entry.notes[0]?.title ?? "未命名笔记"}</strong><small>{entry.source === "local" ? "本地 Vault" : "坚果云"} · {entry.notes.length} 篇 · {formatTrashDate(entry.deletedAt)}</small></span>
              </label>
            ))}
          </div>
        </>
      ) : <div className="sync-empty-state"><Trash2 /><span><strong>回收站为空</strong><small>删除的笔记和文件夹会显示在这里。</small></span></div>}
    </div>
  )
}

export function SyncSettingsPage({
  autoSyncMode,
  connected,
  indexProgress,
  isOnline,
  isSyncing,
  lastSyncedAt,
  notes,
  failedAttachmentCount,
  pendingAttachmentCount,
  onAutoSyncModeChange,
  onCancelSync,
  onClearSyncLog,
  onOpenNote,
  onOpenWebDav,
  onRetry,
  onRetryFailed,
  onRestoreDeletedNote,
  onSync,
  sourceLabel,
  syncProgress,
  syncLogs,
}: {
  autoSyncMode: AutoSyncMode
  connected: boolean
  indexProgress: { indexed: number; total: number } | null
  isOnline: boolean
  isSyncing: boolean
  lastSyncedAt?: number
  notes: Note[]
  failedAttachmentCount: number
  pendingAttachmentCount: number
  onAutoSyncModeChange: (mode: AutoSyncMode) => void
  onCancelSync: () => void
  onClearSyncLog: () => void
  onOpenNote: (note: Note) => void
  onOpenWebDav: () => void
  onRetry: (noteId: string) => void
  onRetryFailed: () => void
  onRestoreDeletedNote: (noteId: string) => void
  onSync: () => void
  sourceLabel: string
  syncProgress: {
    completed: number
    currentLabel: string
    phase: "attachments" | "notes" | "refreshing"
    total: number
  } | null
  syncLogs: SyncLogEntry[]
}) {
  const summary = summarizeWebDavSync(notes)
  const problemNotes = notes.filter((note) => note.source === "webdav"
    && note.pendingOperation !== "delete"
    && (note.syncStatus === "modified" || note.syncStatus === "conflict"))
  const hasCachedNotes = notes.some((note) => note.source === "webdav")
  const deletedNotes = notes.filter((note) => note.source === "webdav" && note.pendingOperation === "delete")
  const indexing = indexProgress && indexProgress.indexed < indexProgress.total
  const canSync = isOnline && !isSyncing
  const failedCount = summary.failed + failedAttachmentCount
  const syncWorkCount = summary.pending + summary.failed + pendingAttachmentCount + failedAttachmentCount
  const syncPercent = syncProgress
    ? syncProgress.phase === "refreshing"
      ? 100
      : syncProgress.total === 0
        ? 0
        : Math.round((syncProgress.completed / syncProgress.total) * 100)
    : 0

  return (
    <div className="settings-content-card sync-center">
      <div className="sync-overview-card" data-online={isOnline}>
        <div className="sync-overview-icon">{isOnline ? <Cloud /> : <CloudOff />}</div>
        <div className="sync-overview-copy">
          <strong>{connected ? sourceLabel : hasCachedNotes ? `${sourceLabel} · 离线缓存` : "尚未建立云端会话"}</strong>
          <small>{!isOnline
            ? "当前离线，本地修改会继续保留"
            : connected
              ? `最近同步：${formatSyncDate(lastSyncedAt)}`
              : hasCachedNotes
                ? `上次同步：${formatSyncDate(lastSyncedAt)} · 重新连接后可上传修改`
                : "配置或重新输入应用密码后即可同步"}</small>
        </div>
        {isSyncing ? (
          <Button disabled={syncProgress?.phase === "refreshing"} onClick={onCancelSync} variant="outline">
            {syncProgress?.phase === "refreshing" ? "正在完成" : "取消同步"}
          </Button>
        ) : (
          <Button disabled={!canSync} onClick={connected ? onSync : onOpenWebDav}>
            {connected
              ? syncWorkCount > 0 ? `同步 ${syncWorkCount} 项` : "检查云端更新"
              : hasCachedNotes ? "重新连接坚果云" : "连接坚果云"}
          </Button>
        )}
      </div>

      {syncProgress ? (
        <div className="sync-operation-progress" role="status">
          <div>
            <span><RefreshCw className="spin" />{syncProgress.currentLabel}</span>
            <strong>{syncPercent}%</strong>
          </div>
          <progress max="100" value={syncPercent} />
          <small>{syncProgress.phase === "refreshing"
            ? "正在刷新云端目录"
            : `已处理 ${syncProgress.completed}/${syncProgress.total} 项；取消会在当前请求完成后生效`}</small>
        </div>
      ) : null}

      <div className="sync-stat-grid" aria-label="同步统计">
        <div><strong>{summary.pending + pendingAttachmentCount}</strong><span>待同步</span></div>
        <div data-tone={summary.conflicts > 0 ? "warning" : undefined}><strong>{summary.conflicts}</strong><span>冲突</span></div>
        <div data-tone={failedCount > 0 ? "danger" : undefined}><strong>{failedCount}</strong><span>失败</span></div>
        <div><strong>{summary.synced}</strong><span>{connected ? "已同步" : "已缓存"}</span></div>
      </div>

      {indexing ? (
        <div className="sync-index-progress">
          <span><RefreshCw className="spin" />正在建立全文索引</span>
          <strong>{indexProgress.indexed}/{indexProgress.total}</strong>
        </div>
      ) : null}

      <section className="sync-problem-section">
        <div className="sync-section-heading">
          <div><h2>自动同步</h2><p>修改只会先保存在本机；按所选时机发起安全同步。</p></div>
        </div>
        <div className="sync-mode-grid" role="radiogroup" aria-label="自动同步方式">
          {([
            ["manual", "仅手动", "只在点击同步时连接云端"],
            ["reconnect", "联网后", "网络恢复时同步待处理修改"],
            ["background", "后台自动", "停止编辑后延迟同步"],
          ] as const).map(([mode, label, description]) => (
            <button
              aria-checked={autoSyncMode === mode}
              data-active={autoSyncMode === mode}
              key={mode}
              onClick={() => onAutoSyncModeChange(mode)}
              role="radio"
              type="button"
            >
              <strong>{label}</strong><small>{description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="sync-problem-section">
        <div className="sync-section-heading">
          <div><h2>需要处理</h2><p>同步前会校验远端版本，冲突文档不会自动覆盖。</p></div>
          <div className="sync-heading-actions">
            <span>{problemNotes.length + failedAttachmentCount} 项</span>
            {failedCount > 0 ? <Button disabled={!canSync} onClick={onRetryFailed} size="sm" variant="outline">重试全部失败</Button> : null}
          </div>
        </div>
        {problemNotes.length > 0 ? (
          <div className="sync-problem-list">
            {problemNotes.map((note) => {
              const conflict = note.syncStatus === "conflict"
              const failed = Boolean(note.syncError)
              return (
                <div className="sync-problem-row" key={note.id}>
                  <button onClick={() => onOpenNote(note)} type="button">
                    <span className="sync-problem-icon"><AlertTriangle /></span>
                    <span><strong>{note.title}</strong><small>{note.folder || "根目录"} · {conflict ? "版本冲突" : failed ? note.syncError : getPendingOperationLabel(note)}</small></span>
                    <ChevronRight />
                  </button>
                  {failed && !conflict ? (
                    <Button disabled={!canSync} onClick={() => onRetry(note.id)} size="sm" variant="outline">重试</Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="sync-empty-state"><CheckCircle2 /><span><strong>{connected ? "当前没有待处理项" : "缓存中没有待处理项"}</strong><small>{connected ? "本地工作副本与最近一次远端状态一致。" : "这是最近一次同步记录，重新连接后会再次校验远端版本。"}</small></span></div>
        )}
      </section>

      {deletedNotes.length > 0 ? (
        <section className="sync-problem-section">
          <div className="sync-section-heading">
            <div><h2>待删除</h2><p>同步前仍可撤销；同步后才会从坚果云删除。</p></div>
            <span>{deletedNotes.length} 项</span>
          </div>
          <div className="sync-problem-list">
            {deletedNotes.map((note) => (
              <div className="sync-problem-row" key={note.id}>
                <button onClick={() => onOpenNote(note)} type="button">
                  <span className="sync-problem-icon"><Trash2 /></span>
                  <span><strong>{note.title}</strong><small>{note.folder || "根目录"} · 等待同步删除</small></span>
                  <ChevronRight />
                </button>
                <Button onClick={() => onRestoreDeletedNote(note.id)} size="sm" variant="outline"><Undo2 />撤销</Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="sync-problem-section">
        <div className="sync-section-heading">
          <div><h2>同步日志</h2><p>只保存在当前设备，不记录账号、正文或完整路径。</p></div>
          {syncLogs.length > 0 ? <Button onClick={onClearSyncLog} size="sm" variant="ghost">清空</Button> : null}
        </div>
        {syncLogs.length > 0 ? (
          <div className="sync-log-list">
            {syncLogs.slice(0, 10).map((entry) => (
              <div data-status={entry.status} key={entry.id}>
                <span>{entry.status === "success" ? <CheckCircle2 /> : <AlertTriangle />}</span>
                <strong>{entry.message}</strong>
                <time>{formatLogDate(entry.timestamp)}</time>
              </div>
            ))}
          </div>
        ) : <div className="sync-empty-state"><RefreshCw /><span><strong>此设备暂无同步日志</strong><small>{lastSyncedAt ? "上方时间来自当前 Vault 快照；下一次主动同步会在这里记录结果。" : "下一次同步结果会显示在这里。"}</small></span></div>}
      </section>
    </div>
  )
}

function getPendingOperationLabel(note: Note) {
  if (note.pendingOperation === "create") return "本机新建 · 待上传"
  if (note.pendingOperation === "move") return "重命名或移动 · 待同步"
  if (note.pendingOperation === "delete") return "本机已删除 · 待同步"
  return "本地修改待同步"
}

export function AboutSettingsPage() {
  const [update, setUpdate] = useState<AppUpdate | null>(null)
  const [updateState, setUpdateState] = useState<"checking" | "downloading" | "idle">("idle")
  const [updateMessage, setUpdateMessage] = useState("")
  const [updateProgress, setUpdateProgress] = useState(0)
  const updaterSupported = supportsAppUpdater()

  const checkUpdate = async () => {
    setUpdateState("checking")
    setUpdateMessage("")
    try {
      const nextUpdate = await checkForAppUpdate()
      setUpdate(nextUpdate)
      setUpdateMessage(nextUpdate ? `发现新版本 ${nextUpdate.version}` : "当前已经是最新版本")
    } catch {
      setUpdateMessage("当前安装包未启用自动更新，仍可从 GitHub Releases 手动下载安装")
    } finally {
      setUpdateState("idle")
    }
  }

  const installUpdate = async () => {
    if (!update || !window.confirm(`将下载并安装 Swell Note ${update.version}，完成后应用会重新启动。是否继续？`)) return
    setUpdateState("downloading")
    setUpdateMessage("正在下载更新…")
    try {
      await installAppUpdate(update, ({ downloaded, total }) => {
        setUpdateProgress(total ? Math.round((downloaded / total) * 100) : 0)
      })
    } catch {
      setUpdateMessage("更新安装失败，现有版本不受影响")
      setUpdateState("idle")
    }
  }

  return (
    <div className="settings-content-card">
      <div className="settings-content-heading">
        <Info />
        <div><h2>Swell Note</h2><p>跨端、本地优先的 Markdown 笔记客户端。</p></div>
      </div>
      <dl className="about-list">
        <div><dt>当前版本</dt><dd>0.1.0</dd></div>
        <div><dt>数据来源</dt><dd>本地 Vault / WebDAV</dd></div>
        <div><dt>云端策略</dt><dd>本地优先，可配置安全同步</dd></div>
        <div><dt>密码策略</dt><dd>Web 仅当前会话 / 原生端可选系统安全存储</dd></div>
      </dl>
      <div className="about-update-row">
        <div><strong>版本更新</strong><small>{updaterSupported ? updateMessage || "桌面正式版可安全检查签名更新" : "Web 端随站点更新；移动端由应用商店更新"}</small></div>
        {updaterSupported ? update ? (
          <Button disabled={updateState !== "idle"} onClick={() => void installUpdate()}><Download />{updateState === "downloading" ? `下载 ${updateProgress || ""}%` : `安装 ${update.version}`}</Button>
        ) : (
          <Button disabled={updateState !== "idle"} onClick={() => void checkUpdate()} variant="outline">{updateState === "checking" ? <RefreshCw className="spin" /> : null}检查更新</Button>
        ) : null}
      </div>
    </div>
  )
}

function formatCacheDate(savedAt: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(savedAt))
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatSyncDate(lastSyncedAt?: number) {
  if (!lastSyncedAt) return "尚未完成"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(lastSyncedAt))
}

function formatLogDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

function formatTrashDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
}
