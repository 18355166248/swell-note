import { useMemo, useState } from "react"
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Cloud,
  CloudOff,
  Database,
  FileCheck2,
  Info,
  ListTodo,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react"
import { Outlet, useLocation } from "react-router-dom"

import {
  AppBottomNav,
  AppNavigationRail,
} from "@/components/workspace/workspace"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { extractMarkdownTasks, type MarkdownTask } from "@/services/tasks/markdown-tasks"
import type { VaultCacheSummary } from "@/services/cache/vault-cache"
import { summarizeWebDavSync } from "@/services/sync/sync-summary"
import type { Note } from "@/types/note"

type NavigationProps = {
  connected: boolean
  onNavigate: (path: string) => void
  onOpenSync: () => void
}

export function TodoPage({
  connected,
  notes,
  onNavigate,
  onOpenNote,
  onOpenSync,
  onToggleTask,
}: NavigationProps & {
  notes: Note[]
  onOpenNote: (note: Note) => void
  onToggleTask: (task: MarkdownTask, checked: boolean) => void
}) {
  const [filter, setFilter] = useState<"all" | "completed" | "pending">("pending")
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
            <div className="route-hint">
              <ListTodo />
              <span>自动聚合已读取正文中的 <code>- [ ]</code> 任务；点击任务可回到来源文档。</span>
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
      <AppBottomNav activeSection="todos" onNavigate={onNavigate} />
    </main>
  )
}

const settingsEntries = [
  { description: "查看待同步、冲突和失败项，并手动发起同步", icon: RefreshCw, label: "同步状态", path: "/settings/sync" },
  { description: "坚果云地址、账号、应用密码与远端目录", icon: Cloud, label: "WebDAV 连接", path: "/settings/webdav" },
  { description: "查看并切换保存在本机的 Vault 快照", icon: Database, label: "离线缓存", path: "/settings/cache" },
  { description: "版本、数据边界与开源组件", icon: Info, label: "关于 Swell Note", path: "/settings/about" },
]

export function SettingsLayout({ connected, onNavigate, onOpenSync }: NavigationProps) {
  const location = useLocation()
  const activeEntry = settingsEntries.find((entry) => location.pathname === entry.path)

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
          {activeEntry ? (
            <Button aria-label="返回设置" className="settings-mobile-back" onClick={() => onNavigate("/settings")} size="icon" variant="ghost">
              <ArrowLeft />
            </Button>
          ) : null}
          <div>
            <span className="eyebrow">应用设置</span>
            <h1>{activeEntry?.label ?? "设置"}</h1>
          </div>
        </header>
        <ScrollArea className="route-scroll-area">
          <Outlet />
        </ScrollArea>
      </section>
      <AppBottomNav activeSection="settings" onNavigate={onNavigate} />
    </main>
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
  caches,
  onDeleteCache,
  onSelectCache,
}: {
  activeCacheId: string | null
  caches: VaultCacheSummary[]
  onDeleteCache: (cacheId: string) => void
  onSelectCache: (cacheId: string) => void
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  return (
    <div className="settings-content-card">
      <div className="settings-content-heading">
        <Database />
        <div><h2>本机 Vault 快照</h2><p>已缓存正文可离线阅读和编辑，重新连接后再手动同步。</p></div>
      </div>
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
    </div>
  )
}

export function SyncSettingsPage({
  connected,
  indexProgress,
  isOnline,
  isSyncing,
  lastSyncedAt,
  notes,
  onOpenNote,
  onOpenWebDav,
  onRetry,
  onSync,
  sourceLabel,
}: {
  connected: boolean
  indexProgress: { indexed: number; total: number } | null
  isOnline: boolean
  isSyncing: boolean
  lastSyncedAt?: number
  notes: Note[]
  onOpenNote: (note: Note) => void
  onOpenWebDav: () => void
  onRetry: (noteId: string) => void
  onSync: () => void
  sourceLabel: string
}) {
  const summary = summarizeWebDavSync(notes)
  const problemNotes = notes.filter((note) => note.source === "webdav"
    && (note.syncStatus === "modified" || note.syncStatus === "conflict"))
  const hasCachedNotes = notes.some((note) => note.source === "webdav")
  const indexing = indexProgress && indexProgress.indexed < indexProgress.total
  const canSync = isOnline && !isSyncing

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
        <Button disabled={!canSync} onClick={connected ? onSync : onOpenWebDav}>
          {isSyncing ? <><RefreshCw className="spin" />同步中</> : connected ? "同步全部" : hasCachedNotes ? "重新连接坚果云" : "连接坚果云"}
        </Button>
      </div>

      <div className="sync-stat-grid" aria-label="同步统计">
        <div><strong>{summary.pending}</strong><span>待同步</span></div>
        <div data-tone={summary.conflicts > 0 ? "warning" : undefined}><strong>{summary.conflicts}</strong><span>冲突</span></div>
        <div data-tone={summary.failed > 0 ? "danger" : undefined}><strong>{summary.failed}</strong><span>失败</span></div>
        <div><strong>{summary.synced}</strong><span>{connected ? "已同步" : "最近已同步"}</span></div>
      </div>

      {indexing ? (
        <div className="sync-index-progress">
          <span><RefreshCw className="spin" />正在建立全文索引</span>
          <strong>{indexProgress.indexed}/{indexProgress.total}</strong>
        </div>
      ) : null}

      <section className="sync-problem-section">
        <div className="sync-section-heading">
          <div><h2>需要处理</h2><p>同步前会校验远端版本，冲突文档不会自动覆盖。</p></div>
          <span>{problemNotes.length} 项</span>
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
  return (
    <div className="settings-content-card">
      <div className="settings-content-heading">
        <Info />
        <div><h2>Swell Note</h2><p>跨端、本地优先的 Markdown 笔记客户端。</p></div>
      </div>
      <dl className="about-list">
        <div><dt>当前版本</dt><dd>0.1.0</dd></div>
        <div><dt>数据来源</dt><dd>本地 Vault / WebDAV</dd></div>
        <div><dt>云端策略</dt><dd>本地优先，手动安全同步</dd></div>
        <div><dt>密码策略</dt><dd>Web 仅当前会话 / 原生端可选系统安全存储</dd></div>
      </dl>
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

function formatSyncDate(lastSyncedAt?: number) {
  if (!lastSyncedAt) return "尚未完成"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(lastSyncedAt))
}
