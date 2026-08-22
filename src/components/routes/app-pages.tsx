import { useMemo, useState } from "react"
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  FileCheck2,
  Info,
  ListTodo,
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
        <div><h2>本机 Vault 快照</h2><p>缓存只用于离线展示，打开后始终只读。</p></div>
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
        <div><dt>云端策略</dt><dd>坚果云保持只读</dd></div>
        <div><dt>密码策略</dt><dd>仅保留在当前运行会话</dd></div>
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
