import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Bold,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  CloudOff,
  Code2,
  Database,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image,
  List,
  ListFilter,
  Link,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Eye,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Tag,
  Redo2,
  Italic,
  Quote,
  Undo2,
} from "lucide-react"

import swellNoteLogo from "@/assets/brand/swell-note-logo-ribbon-s.svg"
import { Button } from "@/components/ui/button"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import type { AttachmentWriteResult } from "@/services/vault/attachment-writer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Note, NoteSaveState } from "@/types/note"
import type { VaultAsset } from "@/services/vault/vault-adapter"
import {
  getFolderAncestorPaths,
  getVisibleVaultFolders,
  type VaultFolder,
} from "@/services/search/vault-folders"
import type { NoteSort } from "@/services/search/note-sort"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import type { VaultCacheSummary } from "@/services/cache/vault-cache"
import { getNoteBreadcrumbSegments } from "@/lib/note-routes"

// CodeMirror 体积较大，延迟到编辑区真正渲染时再加载，避免拖慢首屏资料库与列表。
const MarkdownEditor = lazyWithRetry(() => import("@/components/editor/markdown-editor"))
const MarkdownPreview = lazyWithRetry(() => import("@/components/editor/markdown-preview"))

export type MobileScreen = "library" | "notes" | "editor"
export type AppSection = "notes" | "settings" | "todos"
export type LibraryView = "all" | "recent" | "starred"

type WorkspaceProps = {
  activeCacheId: string | null
  activeNote: Note | null
  activeNoteId: string
  availableTags: string[]
  backlinks: Note[]
  connectionLabel: string
  cloudConnected: boolean
  connected: boolean
  canCreateNote: boolean
  canCreateFolder: boolean
  folders: VaultFolder[]
  folderManagementMode: "local" | "webdav" | null
  isOpeningVault: boolean
  isCreatingNote: boolean
  canInsertAttachment: boolean
  isManagingNote: boolean
  isRefreshingVault: boolean
  libraryView: LibraryView
  localVaultSupported: boolean
  mobileScreen: MobileScreen
  mobileConnectionLabel: string
  mobileListStateKey: string
  noteSort: NoteSort
  notes: Note[]
  onCreateNote: () => void
  onCreateFolder: (name: string, parentFolder: string | null) => void
  onFormat: (syntax: string) => void
  onFormatNote: (noteId: string, syntax: string) => void
  onInsertAttachments: (files: File[]) => Promise<AttachmentWriteResult>
  onMobileScreenChange: (screen: MobileScreen) => void
  onDeleteNote: () => void
  onDeleteFolder: (folderPath: string) => void
  onOpenLocalVault: () => void
  onOpenWikiLink: (target: string) => void
  onMoveNote: (folderPath: string | null) => void
  onRenameFolder: (folderPath: string, nextName: string) => void
  onRenameNote: (title: string) => void
  onOpenSettings: () => void
  onNavigate: (path: string) => void
  onQueryChange: (query: string) => void
  onNoteSortChange: (sort: NoteSort) => void
  onReloadNote: () => void
  onRefreshVault: () => void
  onResolveConflict: (strategy: "local" | "remote") => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onSelectFolder: (folder: string | null) => void
  onSelectLibraryView: (view: LibraryView) => void
  onSelectNote: (note: Note) => void
  onSelectTag: (tag: string | null) => void
  onSelectVaultCache: (cacheId: string) => void
  onUpdateNote: (patch: Partial<Note>) => void
  query: string
  saveState: NoteSaveState
  selectedFolder: string | null
  selectedTag: string | null
  starredNoteCount: number
  syncLabel: string
  totalNoteCount: number
  vaultError: string | null
  vaultCaches: VaultCacheSummary[]
}

export function Workspace(props: WorkspaceProps) {
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const ancestors = getFolderAncestorPaths(props.selectedFolder)
    if (ancestors.length === 0) return
    // 地址直达深层目录时展开祖先保证选中项可见；之后仍允许用户主动折叠。
    setExpandedFolderPaths((current) => {
      if (ancestors.every((path) => current.has(path))) return current
      return new Set([...current, ...ancestors])
    })
  }, [props.selectedFolder])
  const visibleFolders = useMemo(
    () => getVisibleVaultFolders(props.folders, expandedFolderPaths),
    [expandedFolderPaths, props.folders],
  )

  const toggleFolder = (folderPath: string) => {
    // 展开状态只记录路径；目录刷新后仍可依赖相同路径恢复，已经消失的路径不会影响渲染。
    setExpandedFolderPaths((current) => {
      const next = new Set(current)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  return (
    <main className="workspace-root">
      <DesktopWorkspace
        {...props}
        expandedFolderPaths={expandedFolderPaths}
        onToggleFolder={toggleFolder}
        visibleFolders={visibleFolders}
      />
      <MobileWorkspace
        {...props}
        expandedFolderPaths={expandedFolderPaths}
        onToggleFolder={toggleFolder}
        visibleFolders={visibleFolders}
      />
    </main>
  )
}

type FolderTreeProps = {
  expandedFolderPaths: ReadonlySet<string>
  onToggleFolder: (folderPath: string) => void
  visibleFolders: VaultFolder[]
}

function DesktopWorkspace(props: WorkspaceProps & FolderTreeProps) {
  return (
    <div className="desktop-workspace">
      <AppNavigationRail
        activeSection="notes"
        connected={props.connected}
        onNavigate={props.onNavigate}
        onOpenSync={props.onOpenSettings}
      />
      <LibraryPanel
        activeCacheId={props.activeCacheId}
        canCreateNote={props.canCreateNote}
        canCreateFolder={props.canCreateFolder}
        connected={props.connected}
        connectionLabel={props.connectionLabel}
        expandedFolderPaths={props.expandedFolderPaths}
        folders={props.visibleFolders}
        libraryView={props.libraryView}
        noteCount={props.totalNoteCount}
        onCreateNote={props.onCreateNote}
        onCreateFolder={props.onCreateFolder}
        onOpenLocalVault={props.onOpenLocalVault}
        onOpenSettings={props.onOpenSettings}
        onRefreshVault={props.onRefreshVault}
        onSelectFolder={props.onSelectFolder}
        onToggleFolder={props.onToggleFolder}
        onSelectLibraryView={props.onSelectLibraryView}
        onSelectVaultCache={props.onSelectVaultCache}
        selectedFolder={props.selectedFolder}
        isManagingFolder={props.isManagingNote}
        isOpeningVault={props.isOpeningVault}
        isCreatingNote={props.isCreatingNote}
        isRefreshingVault={props.isRefreshingVault}
        localVaultSupported={props.localVaultSupported}
        syncLabel={props.syncLabel}
        vaultError={props.vaultError}
        vaultCaches={props.vaultCaches}
      />
      <NoteListPanel
        activeNoteId={props.activeNoteId}
        canCreateNote={props.canCreateNote}
        notes={props.notes}
        noteSort={props.noteSort}
        folderLabel={props.selectedFolder ?? (props.libraryView === "recent" ? "最近更新" : props.libraryView === "starred" ? "收藏" : "全部笔记")}
        folderManagementMode={props.folderManagementMode}
        onOpenSettings={props.onOpenSettings}
        onCreateNote={props.onCreateNote}
        onQueryChange={props.onQueryChange}
        onNoteSortChange={props.onNoteSortChange}
        onDeleteFolder={props.onDeleteFolder}
        onRenameFolder={props.onRenameFolder}
        onSelectNote={props.onSelectNote}
        availableTags={props.availableTags}
        onSelectTag={props.onSelectTag}
        query={props.query}
        selectedTag={props.selectedTag}
        selectedFolder={props.selectedFolder}
        isManagingFolder={props.isManagingNote}
      />
      {props.activeNote ? (
        <NoteEditor
          backlinks={props.backlinks}
          canInsertAttachment={props.canInsertAttachment}
          cloudConnected={props.cloudConnected}
          canManageNote={Boolean(
            props.activeNote.remotePath
            && !props.activeNote.readOnly,
          )}
          isManagingNote={props.isManagingNote}
          moveTargets={props.folders}
          note={props.activeNote}
          onDeleteNote={props.onDeleteNote}
          onFormat={props.onFormat}
          onFormatNote={props.onFormatNote}
          onInsertAttachments={props.onInsertAttachments}
          onOpenWikiLink={props.onOpenWikiLink}
          onMoveNote={props.onMoveNote}
          onRenameNote={props.onRenameNote}
          onSelectNote={props.onSelectNote}
          onUpdateNote={props.onUpdateNote}
          onReloadNote={props.onReloadNote}
          onResolveConflict={props.onResolveConflict}
          onResolveAsset={props.onResolveAsset}
          onSync={props.onRefreshVault}
          saveState={props.saveState}
          syncing={props.isRefreshingVault}
        />
      ) : <EmptyNoteEditor onOpenSettings={props.onOpenSettings} />}
    </div>
  )
}

export function AppNavigationRail({
  activeSection,
  connected,
  onNavigate,
  onOpenSync,
}: {
  activeSection: AppSection
  connected: boolean
  onNavigate: (path: string) => void
  onOpenSync: () => void
}) {
  return (
    <aside className="navigation-rail">
      <img alt="Swell Note" className="rail-logo" src={swellNoteLogo} />
      <nav className="rail-navigation" aria-label="主导航">
        <RailButton active={activeSection === "notes"} icon={FileText} label="笔记" onClick={() => onNavigate("/notes")} />
        <RailButton active={activeSection === "todos"} icon={CheckCircle2} label="待办" onClick={() => onNavigate("/todos")} />
      </nav>
      <div className="rail-footer">
        <RailButton
          indicator={connected}
          icon={Cloud}
          label="同步"
          onClick={onOpenSync}
        />
        <RailButton active={activeSection === "settings"} icon={Settings} label="设置" onClick={() => onNavigate("/settings")} />
        <RailButton icon={CircleHelp} label="关于" onClick={() => onNavigate("/settings/about")} />
      </div>
    </aside>
  )
}

type RailButtonProps = {
  active?: boolean
  icon: typeof FileText
  indicator?: boolean
  label: string
  onClick?: () => void
}

function RailButton({ active = false, icon: Icon, indicator = false, label, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className="rail-button"
          data-active={active}
          onClick={onClick}
          type="button"
        >
          <Icon />
          {indicator ? <span className="rail-indicator" /> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

type LibraryPanelProps = {
  activeCacheId: string | null
  canCreateFolder: boolean
  canCreateNote: boolean
  connected: boolean
  connectionLabel: string
  expandedFolderPaths: ReadonlySet<string>
  folders: VaultFolder[]
  isManagingFolder: boolean
  isOpeningVault: boolean
  isCreatingNote: boolean
  isRefreshingVault: boolean
  libraryView: LibraryView
  localVaultSupported: boolean
  noteCount: number
  onCreateNote: () => void
  onCreateFolder: (name: string, parentFolder: string | null) => void
  onOpenLocalVault: () => void
  onOpenSettings: () => void
  onRefreshVault: () => void
  onSelectFolder: (folder: string | null) => void
  onToggleFolder: (folderPath: string) => void
  onSelectLibraryView: (view: LibraryView) => void
  onSelectVaultCache: (cacheId: string) => void
  selectedFolder: string | null
  syncLabel: string
  vaultError: string | null
  vaultCaches: VaultCacheSummary[]
}

function LibraryPanel({
  activeCacheId,
  connected,
  canCreateNote,
  canCreateFolder,
  connectionLabel,
  expandedFolderPaths,
  folders,
  isManagingFolder,
  isOpeningVault,
  isCreatingNote,
  isRefreshingVault,
  libraryView,
  localVaultSupported,
  noteCount,
  onCreateNote,
  onCreateFolder,
  onOpenLocalVault,
  onOpenSettings,
  onRefreshVault,
  onSelectFolder,
  onToggleFolder,
  onSelectLibraryView,
  onSelectVaultCache,
  selectedFolder,
  syncLabel,
  vaultError,
  vaultCaches,
}: LibraryPanelProps) {
  return (
    <aside className="library-panel">
      <div className="pane-header library-titlebar">
        <div>
          <span className="eyebrow">工作区</span>
          <h1>笔记库</h1>
        </div>
      </div>

      <div className="library-actions">
        <Button className="new-note-button" disabled={!canCreateNote || isCreatingNote} onClick={onCreateNote}>
          {isCreatingNote ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          {isCreatingNote ? "正在创建…" : canCreateNote ? "新建笔记" : "本地 Vault 中可新建"}
        </Button>
        <Button
          className="open-vault-button"
          disabled={!localVaultSupported || isOpeningVault}
          onClick={onOpenLocalVault}
          variant="outline"
        >
          <FolderOpen data-icon="inline-start" />
          {isOpeningVault ? "正在读取…" : "打开本地笔记库"}
        </Button>
        <CacheSwitcher
          activeCacheId={activeCacheId}
          caches={vaultCaches}
          onSelectCache={onSelectVaultCache}
        />
        {vaultError ? <p className="vault-error">{vaultError}</p> : null}
      </div>

      <ScrollArea className="library-scroll">
        <nav className="library-navigation" aria-label="笔记库导航">
          <LibraryRow active={selectedFolder === null && libraryView === "all"} count={noteCount} icon={FileText} label="全部笔记" onClick={() => onSelectLibraryView("all")} />
          <LibraryRow active={libraryView === "recent"} count={Math.min(noteCount, 32)} icon={CheckCircle2} label="最近更新" onClick={() => onSelectLibraryView("recent")} />
          <LibraryRow active={libraryView === "starred"} icon={Star} label="收藏" onClick={() => onSelectLibraryView("starred")} />

          <div className="library-section-title">
            <span>文件夹</span>
            {canCreateFolder ? (
              <CreateFolderButton
                disabled={isManagingFolder}
                onCreate={(name) => onCreateFolder(name, selectedFolder)}
                parentFolder={selectedFolder}
              />
            ) : null}
          </div>

          {folders.map((folder) => (
            <LibraryRow
              active={libraryView === "all" && selectedFolder === folder.path}
              count={folder.count}
              depth={folder.depth}
              expanded={folder.hasChildren ? expandedFolderPaths.has(folder.path) : undefined}
              folderTree
              icon={libraryView === "all" && selectedFolder === folder.path ? FolderOpen : Folder}
              key={folder.path}
              label={folder.label}
              onClick={() => onSelectFolder(folder.path)}
              onToggle={folder.hasChildren ? () => onToggleFolder(folder.path) : undefined}
            />
          ))}
        </nav>
      </ScrollArea>

      <div className="sync-summary-shell">
        <button className="sync-summary" onClick={onOpenSettings} type="button">
          <span className="sync-summary-dot" data-connected={connected} />
          <span className="min-w-0">
            <strong>{connectionLabel}</strong>
            <small>{syncLabel}</small>
          </span>
          <ChevronRight />
        </button>
        <Button
          aria-label={connected ? "同步当前笔记库" : "重新连接并更新"}
          className="sync-refresh-button"
          disabled={isRefreshingVault}
          onClick={onRefreshVault}
          size="sm"
          variant="ghost"
        >
          {isRefreshingVault ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {isRefreshingVault ? "同步中" : connected ? "同步" : "连接"}
        </Button>
      </div>
    </aside>
  )
}

function CacheSwitcher({
  activeCacheId,
  caches,
  mobile = false,
  onSelectCache,
}: {
  activeCacheId: string | null
  caches: VaultCacheSummary[]
  mobile?: boolean
  onSelectCache: (cacheId: string) => void
}) {
  if (caches.length === 0) return null
  const activeCache = caches.find((cache) => cache.id === activeCacheId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={mobile ? "mobile-cache-switcher" : "cache-switcher"} variant="outline">
          <Database data-icon="inline-start" />
          <span>{activeCache?.label ?? "切换离线缓存"}</span>
          <ChevronDown className="cache-switcher-chevron" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="cache-switcher-menu">
        {caches.map((cache) => (
          <DropdownMenuItem
            className="cache-switcher-item"
            key={cache.id}
            onClick={() => onSelectCache(cache.id)}
          >
            <span className="cache-check">{cache.id === activeCacheId ? <Check /> : null}</span>
            <span>
              <strong>{cache.label}</strong>
              <small>{cache.noteCount} 篇 · {formatCacheDate(cache.savedAt)}</small>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type LibraryRowProps = {
  active?: boolean
  count?: number
  depth?: number
  expanded?: boolean
  folderTree?: boolean
  icon: typeof FileText
  label: string
  onClick?: () => void
  onToggle?: () => void
}

function LibraryRow({ active = false, count, depth = 0, expanded, folderTree = false, icon: Icon, label, onClick, onToggle }: LibraryRowProps) {
  return (
    <div className="library-row" data-active={active} data-depth={Math.min(depth, 3)}>
      {folderTree ? (
        onToggle ? (
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "折叠" : "展开"}${label}`}
            className="library-folder-toggle"
            onClick={onToggle}
            type="button"
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
        ) : <span className="library-chevron-placeholder" />
      ) : <span className="library-chevron-placeholder" />}
      <button className="library-row-main" onClick={onClick} type="button">
        <Icon />
        <span>{label}</span>
        {typeof count === "number" ? <small>{count}</small> : null}
      </button>
    </div>
  )
}

type NoteListPanelProps = {
  activeNoteId: string
  availableTags: string[]
  canCreateNote: boolean
  folderLabel: string
  folderManagementMode: "local" | "webdav" | null
  notes: Note[]
  noteSort: NoteSort
  isManagingFolder: boolean
  onCreateNote: () => void
  onOpenSettings: () => void
  onQueryChange: (query: string) => void
  onNoteSortChange: (sort: NoteSort) => void
  onDeleteFolder: (folderPath: string) => void
  onRenameFolder: (folderPath: string, nextName: string) => void
  onSelectNote: (note: Note) => void
  onSelectTag: (tag: string | null) => void
  query: string
  selectedTag: string | null
  selectedFolder: string | null
}

function NoteListPanel({
  activeNoteId,
  availableTags,
  canCreateNote,
  folderLabel,
  folderManagementMode,
  isManagingFolder,
  notes,
  noteSort,
  onCreateNote,
  onOpenSettings,
  onQueryChange,
  onNoteSortChange,
  onDeleteFolder,
  onRenameFolder,
  onSelectNote,
  onSelectTag,
  query,
  selectedTag,
  selectedFolder,
}: NoteListPanelProps) {
  const groups = groupNotes(notes)

  return (
    <section className="note-list-panel">
      <div className="pane-header note-list-titlebar">
        <div>
          <span className="eyebrow">当前目录</span>
          <h2>{folderLabel}</h2>
        </div>
        <div className="note-list-actions">
          {selectedFolder && folderManagementMode ? <FolderRenameButton disabled={isManagingFolder} folderPath={selectedFolder} mode={folderManagementMode} onDelete={onDeleteFolder} onRename={onRenameFolder} /> : null}
          <TagFilterMenu availableTags={availableTags} onChange={onSelectTag} selectedTag={selectedTag} />
          <NoteSortMenu onChange={onNoteSortChange} sort={noteSort} />
        </div>
      </div>

      <div className="note-search-wrap">
        <Search />
        <Input
          aria-label="搜索笔记"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索笔记、标签、内容"
          value={query}
        />
      </div>

      <ScrollArea className="note-list-scroll">
        <div className="note-groups">
          {groups.length > 0 ? groups.map((group) => (
            <section key={group.label}>
              <div className="note-group-label">
                <span>{group.label}</span>
                <small>{group.notes.length}</small>
              </div>
              {group.notes.map((note) => (
                <NoteListRow
                  active={note.id === activeNoteId}
                  key={note.id}
                  note={note}
                  onSelect={onSelectNote}
                />
              ))}
            </section>
          )) : <EmptyNoteList canCreateNote={canCreateNote} onCreateNote={onCreateNote} onOpenSettings={onOpenSettings} selectedFolder={selectedFolder} />}
        </div>
      </ScrollArea>
    </section>
  )
}

function EmptyNoteList({
  canCreateNote,
  onCreateNote,
  onOpenSettings,
  selectedFolder,
}: {
  canCreateNote: boolean
  onCreateNote: () => void
  onOpenSettings: () => void
  selectedFolder: string | null
}) {
  const localEmptyState = selectedFolder || canCreateNote
  return (
    <div className="note-list-empty">
      {localEmptyState ? <FolderOpen /> : <Cloud />}
      <strong>{selectedFolder ? "这个文件夹还是空的" : localEmptyState ? "笔记库还是空的" : "还没有远程笔记"}</strong>
      <p>{localEmptyState ? "可以直接在当前目录新建第一篇 Markdown 笔记。" : "连接坚果云后，这里只展示远端 Vault 中的 Markdown。"}</p>
      <Button onClick={localEmptyState ? onCreateNote : onOpenSettings} size="sm" variant="outline">{localEmptyState ? "新建笔记" : "连接坚果云"}</Button>
    </div>
  )
}

function FolderRenameButton({
  disabled,
  folderPath,
  mode,
  onDelete,
  onRename,
}: {
  disabled: boolean
  folderPath: string
  mode: "local" | "webdav"
  onDelete: (folderPath: string) => void
  onRename: (folderPath: string, nextName: string) => void
}) {
  const folderSegments = folderPath.split(/\s*\/\s*/).filter(Boolean)
  const currentName = folderSegments[folderSegments.length - 1] ?? folderPath
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(currentName)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <Dialog onOpenChange={(nextOpen) => { setOpen(nextOpen); setConfirmingDelete(false); if (nextOpen) setName(currentName) }} open={open}>
      <Button aria-label={`重命名文件夹 ${currentName}`} disabled={disabled} onClick={() => setOpen(true)} size="icon-sm" variant="ghost"><PencilLine /></Button>
      <DialogContent>
        <DialogHeader><DialogTitle>{confirmingDelete ? "删除文件夹" : "重命名文件夹"}</DialogTitle><DialogDescription>{confirmingDelete && mode === "local" ? "文件夹及其中的全部文件会移动到 Swell Note 回收站，可在保留期内恢复。" : confirmingDelete ? "该目录中的笔记将进入待同步删除，可在同步前撤销。" : mode === "local" ? "将直接重命名本地 Vault 中的目录，并同步更新当前笔记索引。" : "该目录及所有子目录中的笔记会先在本机排队，点击同步后才移动坚果云文件。"}</DialogDescription></DialogHeader>
        <Input autoFocus aria-label="新文件夹名称" onChange={(event) => setName(event.target.value)} value={name} />
        <DialogFooter>
          {confirmingDelete ? (
            <>
              <Button onClick={() => setConfirmingDelete(false)} variant="ghost">暂不删除</Button>
              <Button onClick={() => { setOpen(false); onDelete(folderPath) }} variant="destructive">{mode === "local" ? "移入回收站" : "确认移入待删除"}</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setConfirmingDelete(true)} variant="destructive">删除文件夹</Button>
              <Button disabled={!name.trim() || name.trim() === currentName} onClick={() => { setOpen(false); onRename(folderPath, name) }}>确认重命名</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateFolderButton({
  disabled,
  onCreate,
  parentFolder,
}: {
  disabled: boolean
  onCreate: (name: string) => void
  parentFolder: string | null
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")

  return (
    <Dialog onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) setName("") }} open={open}>
      <Button aria-label="新建文件夹" disabled={disabled} onClick={() => setOpen(true)} size="icon-sm" variant="ghost"><FolderPlus /></Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建空文件夹</DialogTitle>
          <DialogDescription>{parentFolder ? `将在“${parentFolder}”下创建子文件夹。` : "将在本地 Vault 根目录创建文件夹。"}</DialogDescription>
        </DialogHeader>
        <Input autoFocus aria-label="文件夹名称" onChange={(event) => setName(event.target.value)} placeholder="例如：项目资料" value={name} />
        <DialogFooter>
          <Button onClick={() => setOpen(false)} variant="ghost">取消</Button>
          <Button disabled={!name.trim()} onClick={() => { setOpen(false); onCreate(name) }}>创建文件夹</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const noteSortOptions: { label: string; value: NoteSort }[] = [
  { label: "最近更新", value: "updated-desc" },
  { label: "最早更新", value: "updated-asc" },
  { label: "标题 A–Z", value: "title-asc" },
]

function NoteSortMenu({
  mobile = false,
  onChange,
  sort,
}: {
  mobile?: boolean
  onChange: (sort: NoteSort) => void
  sort: NoteSort
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="排序笔记" size={mobile ? "icon" : "icon-sm"} variant="ghost"><ListFilter /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {noteSortOptions.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            <Check className={sort === option.value ? "opacity-100" : "opacity-0"} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TagFilterMenu({
  availableTags,
  onChange,
  selectedTag,
}: {
  availableTags: string[]
  onChange: (tag: string | null) => void
  selectedTag: string | null
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="按标签筛选" data-active={Boolean(selectedTag)} size="icon-sm" variant="ghost"><Tag /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        <DropdownMenuItem onClick={() => onChange(null)}><Check className={selectedTag ? "opacity-0" : "opacity-100"} />全部标签</DropdownMenuItem>
        {availableTags.map((tag) => (
          <DropdownMenuItem key={tag} onClick={() => onChange(tag)}>
            <Check className={selectedTag === tag ? "opacity-100" : "opacity-0"} />#{tag}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EmptyNoteEditor({
  onBack,
  onOpenSettings,
}: {
  onBack?: () => void
  onOpenSettings: () => void
}) {
  return (
    <article className="note-editor empty-note-editor">
      {onBack ? (
        <header className="editor-titlebar">
          <Button aria-label="返回全部笔记" onClick={onBack} size="icon" variant="ghost"><ArrowLeft /></Button>
          <span className="mobile-back-label">全部笔记</span>
        </header>
      ) : null}
      <div className="empty-note-content">
        <span className="empty-note-icon"><Cloud /></span>
        <h2>连接后展示远程文档</h2>
        <p>当前没有注入任何 Mock 内容。连接坚果云后，将在这里按需读取并展示真实 Markdown。</p>
        <Button onClick={onOpenSettings}><Cloud data-icon="inline-start" />连接坚果云</Button>
      </div>
    </article>
  )
}

type NoteListRowProps = {
  active: boolean
  note: Note
  onSelect: (note: Note) => void
}

function NoteListRow({ active, note, onSelect }: NoteListRowProps) {
  return (
    <button
      className="note-list-row"
      data-active={active}
      onClick={() => onSelect(note)}
      type="button"
    >
      <div className="note-row-heading">
        <strong>{note.title}</strong>
        {note.starred ? <Star className="starred-icon" /> : null}
      </div>
      <p>{note.preview}</p>
      {note.tags?.length ? <div className="note-row-tags">{note.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
      <div className="note-row-meta">
        <time>{note.updatedAt}</time>
        <span>{note.folder ?? deriveFolder(note)}</span>
        {active ? <span className="unread-dot" /> : null}
      </div>
    </button>
  )
}

type NoteEditorProps = {
  backlinks: Note[]
  canInsertAttachment: boolean
  canManageNote: boolean
  cloudConnected: boolean
  compact?: boolean
  isManagingNote: boolean
  moveTargets: VaultFolder[]
  note: Note
  onBack?: () => void
  onDeleteNote: () => void
  onFormat: (syntax: string) => void
  onFormatNote: (noteId: string, syntax: string) => void
  onInsertAttachments: (files: File[]) => Promise<AttachmentWriteResult>
  onOpenWikiLink: (target: string) => void
  onMoveNote: (folderPath: string | null) => void
  onRenameNote: (title: string) => void
  onReloadNote: () => void
  onResolveConflict: (strategy: "local" | "remote") => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onSelectNote: (note: Note) => void
  onSync: () => void
  onUpdateNote: (patch: Partial<Note>) => void
  saveState: NoteSaveState
  syncing: boolean
}

function NoteEditor({ backlinks, canInsertAttachment, canManageNote, cloudConnected, compact = false, isManagingNote, moveTargets, note, onBack, onDeleteNote, onFormat, onFormatNote, onInsertAttachments, onMoveNote, onOpenWikiLink, onReloadNote, onRenameNote, onResolveAsset, onResolveConflict, onSelectNote, onSync, onUpdateNote, saveState, syncing }: NoteEditorProps) {
  // 同步请求使用点击瞬间的正文快照；请求完成前锁定编辑，避免旧快照回写覆盖新输入。
  const readOnly = (note.readOnly ?? note.source === "webdav") || saveState.status === "saving"
  const titleReadOnly = note.source === "local" || note.source === "webdav"
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const [previewing, setPreviewing] = useState(compact)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState(note.title)
  const [cursorPosition, setCursorPosition] = useState({ column: 1, line: 1 })
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [insertingAttachment, setInsertingAttachment] = useState(false)
  const attachmentBusyRef = useRef(false)
  const currentNoteIdRef = useRef(note.id)
  currentNoteIdRef.current = note.id
  const breadcrumbSegments = getNoteBreadcrumbSegments(note.folder)

  useEffect(() => {
    // 手机进入新文档时默认阅读，避免误触键盘；用户可通过明确按钮进入编辑模式。
    setPreviewing(compact)
  }, [compact, note.id])

  const handleFormat = useCallback((syntax: string) => {
    if (!syntax) return
    if (editorRef.current) {
      editorRef.current.insertText(syntax)
      return
    }
    onFormat(syntax)
  }, [onFormat])

  const handleInsertFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || readOnly || !canInsertAttachment || attachmentBusyRef.current) return
    const uploadNoteId = note.id
    attachmentBusyRef.current = true
    setAttachmentError(null)
    setInsertingAttachment(true)
    try {
      const { errors, markdown } = await onInsertAttachments(files)
      // 部分文件失败时仍插入已写入成功的附件，避免用户重复拖拽整批文件。
      if (markdown) {
        if (currentNoteIdRef.current === uploadNoteId) handleFormat(markdown)
        else onFormatNote(uploadNoteId, markdown)
      }
      setAttachmentError(errors.length > 0 ? errors.join("；") : null)
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "插入附件失败")
    } finally {
      attachmentBusyRef.current = false
      setInsertingAttachment(false)
    }
  }, [canInsertAttachment, handleFormat, note.id, onFormatNote, onInsertAttachments, readOnly])

  return (
    <article className="note-editor" data-compact={compact}>
      <header className="editor-titlebar">
        {onBack ? (
          <Button aria-label="返回全部笔记" onClick={onBack} size="icon" variant="ghost"><ArrowLeft /></Button>
        ) : (
          <div className="editor-breadcrumb">
            <FileText />
            {breadcrumbSegments.map((segment, index) => (
              <span className="editor-breadcrumb-segment" key={`${segment}-${index}`}>
                {index > 0 ? <ChevronRight /> : null}
                <span>{segment}</span>
              </span>
            ))}
          </div>
        )}
        {onBack ? <span className="mobile-back-label">全部笔记</span> : null}
        <div className="editor-actions">
          <SaveStateIndicator cloudConnected={cloudConnected} note={note} state={saveState} />
          {note.source === "webdav" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="同步坚果云笔记库"
                  className="editor-sync-button"
                  disabled={syncing}
                  onClick={onSync}
                  size="sm"
                  variant={saveState.status === "pending" || saveState.status === "error" ? "default" : "ghost"}
                >
                  {syncing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  <span>{syncing ? "同步中" : "同步"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>上传本地修改并拉取远端更新</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={previewing ? "切换到编辑" : "切换到预览"}
                className="preview-toggle"
                data-active={previewing}
                onClick={() => setPreviewing((current) => !current)}
                size="icon-sm"
                variant="ghost"
              >
                {previewing ? <PencilLine /> : <Eye />}
                {compact ? <span>{previewing ? "编辑" : "阅读"}</span> : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{previewing ? "编辑 Markdown" : "预览 Markdown"}</TooltipContent>
          </Tooltip>
          <Button
            aria-label={note.starred ? "取消收藏" : "收藏"}
            onClick={() => onUpdateNote({ starred: !note.starred })}
            size="icon-sm"
            variant="ghost"
          >
            <Star className={note.starred ? "starred-icon" : ""} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="更多操作" size="icon-sm" variant="ghost"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {note.remotePath && !note.pendingOperation ? (
                <DropdownMenuItem
                  disabled={saveState.status === "saving"}
                  onClick={onReloadNote}
                >
                  重新加载源文件
                </DropdownMenuItem>
              ) : null}
              {canManageNote ? (
                <>
                  <DropdownMenuItem onClick={() => { setRenameTitle(note.title); setRenameDialogOpen(true) }}>重命名</DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={isManagingNote || saveState.status === "saving"}>移动到文件夹</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                      <DropdownMenuItem onClick={() => onMoveNote(null)}>根目录</DropdownMenuItem>
                      {moveTargets.map((folder) => (
                        <DropdownMenuItem key={folder.path} onClick={() => onMoveNote(folder.path)}>{folder.path}</DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={isManagingNote || saveState.status === "saving"} onClick={() => setDeleteDialogOpen(true)} variant="destructive">删除笔记</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {saveState.status === "conflict" ? (
        <div className="sync-conflict-banner" role="alert">
          <div>
            <strong>云端版本已变化</strong>
            <span>本地修改仍然安全保留，请选择同步时采用哪个版本。</span>
          </div>
          <Button onClick={() => onResolveConflict("local")} size="sm" variant="outline">保留本地版本</Button>
          <Button onClick={() => onResolveConflict("remote")} size="sm" variant="outline">采用云端版本</Button>
        </div>
      ) : null}

      {!compact && !previewing && !readOnly ? (
        <FormattingToolbar
          attachmentBusy={insertingAttachment}
          canInsertAttachment={canInsertAttachment}
          editorRef={editorRef}
          onFormat={handleFormat}
          onInsertFiles={handleInsertFiles}
        />
      ) : null}

      {attachmentError ? (
        <p className="attachment-error" role="alert">{attachmentError}</p>
      ) : null}

      <ScrollArea className="editor-scroll">
        <div className="document-canvas">
          <input
            aria-label="笔记标题"
            className="document-title"
            onChange={(event) => onUpdateNote({ title: event.target.value })}
            readOnly={titleReadOnly}
            value={note.title}
          />
          <div className="document-meta">
            <span>{note.updatedAt === "刚刚" ? "刚刚编辑" : note.updatedAt}</span>
            <span>·</span>
            <span>{note.content.length} 字符</span>
            <span>·</span>
            <span>{deriveFolder(note)}</span>
          </div>
          {previewing ? (
            <Suspense fallback={<div className="editor-loading">正在生成预览…</div>}>
              <MarkdownPreview
                content={note.content}
                onResolveAsset={onResolveAsset}
                onWikiLink={onOpenWikiLink}
              />
            </Suspense>
          ) : (
            <div className="markdown-editor-shell">
              <Suspense fallback={<div className="editor-loading">正在加载编辑器…</div>}>
                {/* CodeMirror 会在提交后同步受控 value；按笔记重建实例，避免切换瞬间残留上一份正文。 */}
                <MarkdownEditor
                  key={note.id}
                  onChange={(content) => onUpdateNote({
                    content,
                    preview: content.replace(/^#+\s*/gm, "").slice(0, 90),
                  })}
                  onCursorChange={(line, column) => setCursorPosition({ column, line })}
                  onInsertFiles={canInsertAttachment && !insertingAttachment ? handleInsertFiles : undefined}
                  readOnly={readOnly}
                  ref={editorRef}
                  value={note.content}
                />
              </Suspense>
            </div>
          )}
          <BacklinksPanel backlinks={backlinks} onSelectNote={onSelectNote} />
        </div>
      </ScrollArea>

      {compact && !previewing && !readOnly ? (
        <FormattingToolbar
          attachmentBusy={insertingAttachment}
          canInsertAttachment={canInsertAttachment}
          editorRef={editorRef}
          mobile
          onFormat={handleFormat}
          onInsertFiles={handleInsertFiles}
        />
      ) : !compact ? (
        <footer className="editor-statusbar">
          <span>{note.content.length} 字</span>
          <span>Markdown</span>
          <span className="ml-auto">行 {cursorPosition.line}，列 {cursorPosition.column}</span>
        </footer>
      ) : null}
      <Dialog onOpenChange={setDeleteDialogOpen} open={deleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除“{note.title}”？</DialogTitle>
            <DialogDescription>{note.source === "webdav" ? "这会先在本机隐藏笔记，点击同步后再从坚果云删除；保留期内仍可从回收站恢复。" : "对应 Markdown 文件会移动到本地 Vault 的隐藏回收目录，保留期内可以恢复。"}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDeleteDialogOpen(false)} variant="outline">取消</Button>
            <Button disabled={isManagingNote || saveState.status === "saving"} onClick={() => { setDeleteDialogOpen(false); onDeleteNote() }} variant="destructive">确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={setRenameDialogOpen} open={renameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名笔记</DialogTitle>
            <DialogDescription>{note.source === "webdav" ? "名称先保存在本机，点击同步后再更新坚果云。" : "这会同步修改 Markdown 文件名。"}</DialogDescription>
          </DialogHeader>
          <Input autoFocus onChange={(event) => setRenameTitle(event.target.value)} value={renameTitle} />
          <DialogFooter>
            <Button onClick={() => setRenameDialogOpen(false)} variant="outline">取消</Button>
            <Button disabled={!renameTitle.trim() || renameTitle.trim() === note.title} onClick={() => { setRenameDialogOpen(false); onRenameNote(renameTitle) }}>确认重命名</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

type FormattingToolbarProps = {
  attachmentBusy: boolean
  canInsertAttachment: boolean
  editorRef: RefObject<MarkdownEditorHandle | null>
  mobile?: boolean
  onFormat: (syntax: string) => void
  onInsertFiles: (files: File[]) => Promise<void>
}

function FormattingToolbar({
  attachmentBusy,
  canInsertAttachment,
  editorRef,
  mobile = false,
  onFormat,
  onInsertFiles,
}: FormattingToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="formatting-toolbar" data-mobile={mobile}>
      <FormatButton icon={Undo2} label="撤销（⌘/Ctrl+Z）" onClick={() => editorRef.current?.undo()} />
      <FormatButton icon={Redo2} label="重做（⌘/Ctrl+Shift+Z）" onClick={() => editorRef.current?.redo()} />
      <span className="toolbar-divider" />
      <FormatButton label="二级标题" onClick={() => onFormat("\n## ")}>H2</FormatButton>
      <FormatButton label="三级标题" onClick={() => onFormat("\n### ")}>H3</FormatButton>
      <span className="toolbar-divider" />
      <FormatButton icon={Bold} label="加粗" onClick={() => onFormat("**加粗文字**")} />
      <FormatButton icon={Italic} label="斜体" onClick={() => onFormat("*斜体文字*")} />
      <FormatButton icon={Quote} label="引用" onClick={() => onFormat("\n> ")} />
      <FormatButton icon={List} label="无序列表" onClick={() => onFormat("\n- ")} />
      <FormatButton icon={CheckCircle2} label="任务列表" onClick={() => onFormat("\n- [ ] ")} />
      <FormatButton icon={Code2} label="代码" onClick={() => onFormat("\n```\n\n```\n")} />
      <FormatButton icon={Link} label="链接" onClick={() => onFormat("[链接](https://)")} />
      {canInsertAttachment ? (
        <>
          <FormatButton
            busy={attachmentBusy}
            icon={Image}
            label="插入图片或附件"
            onClick={() => fileInputRef.current?.click()}
          />
          <input
            className="attachment-file-input"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              // 清空 value 才能连续两次选择同一个文件。
              event.target.value = ""
              if (files.length > 0) void onInsertFiles(files)
            }}
            ref={fileInputRef}
            tabIndex={-1}
            type="file"
          />
        </>
      ) : null}
    </div>
  )
}

type FormatButtonProps = {
  busy?: boolean
  children?: ReactNode
  icon?: typeof List
  label: string
  onClick: () => void
}

function FormatButton({ busy = false, children, icon: Icon, label, onClick }: FormatButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button aria-label={label} disabled={busy} onClick={onClick} type="button">
          {busy ? <LoaderCircle className="animate-spin" /> : Icon ? <Icon /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function MobileWorkspace(props: WorkspaceProps & FolderTreeProps) {
  const noteListPositionsRef = useRef(new Map<string, number>())
  const libraryPositionsRef = useRef(new Map<string, number>())
  // 使用与实际可见结果一致的延迟搜索键，避免输入态先更新时覆盖原列表滚动位置。
  const listStateKey = `${props.libraryView}\u0000${props.selectedFolder ?? "__all__"}\u0000${props.mobileListStateKey}`
  const libraryStateKey = `${props.totalNoteCount}\u0000${props.folders.map((folder) => folder.path).join("\u0000")}`

  return (
    <div className="mobile-workspace" data-screen={props.mobileScreen}>
      {props.mobileScreen === "library" ? (
        <MobileLibrary
          {...props}
          initialScrollTop={libraryPositionsRef.current.get(libraryStateKey) ?? 0}
          onScrollPositionChange={(scrollTop) => libraryPositionsRef.current.set(libraryStateKey, scrollTop)}
        />
      ) : null}
      {props.mobileScreen === "notes" ? (
        <MobileNoteList
          {...props}
          initialScrollTop={noteListPositionsRef.current.get(listStateKey) ?? 0}
          key={listStateKey}
          onScrollPositionChange={(scrollTop) => noteListPositionsRef.current.set(listStateKey, scrollTop)}
        />
      ) : null}
      {props.mobileScreen === "editor" ? (
        props.activeNote ? (
          <NoteEditor
            backlinks={props.backlinks}
            cloudConnected={props.cloudConnected}
            canManageNote={Boolean(
              props.activeNote.remotePath
              && !props.activeNote.readOnly,
            )}
            canInsertAttachment={props.canInsertAttachment}
            isManagingNote={props.isManagingNote}
            compact
            moveTargets={props.folders}
            note={props.activeNote}
            onBack={() => props.onMobileScreenChange("notes")}
            onDeleteNote={props.onDeleteNote}
            onFormat={props.onFormat}
            onFormatNote={props.onFormatNote}
            onInsertAttachments={props.onInsertAttachments}
            onOpenWikiLink={props.onOpenWikiLink}
            onMoveNote={props.onMoveNote}
            onRenameNote={props.onRenameNote}
            onReloadNote={props.onReloadNote}
            onResolveAsset={props.onResolveAsset}
            onResolveConflict={props.onResolveConflict}
            onSelectNote={props.onSelectNote}
            onSync={props.onRefreshVault}
            onUpdateNote={props.onUpdateNote}
            saveState={props.saveState}
            syncing={props.isRefreshingVault}
          />
        ) : <EmptyNoteEditor onBack={() => props.onMobileScreenChange("notes")} onOpenSettings={props.onOpenSettings} />
      ) : null}
    </div>
  )
}

function BacklinksPanel({ backlinks, onSelectNote }: { backlinks: Note[]; onSelectNote: (note: Note) => void }) {
  return (
    <section className="backlinks-panel">
      <div className="backlinks-title">
        <Link2 />
        <strong>反向链接</strong>
        <span>{backlinks.length}</span>
      </div>
      {backlinks.length > 0 ? (
        <div className="backlinks-list">
          {backlinks.map((note) => (
            <button key={note.id} onClick={() => onSelectNote(note)} type="button">
              <strong>{note.title}</strong>
              <span>{note.preview}</span>
            </button>
          ))}
        </div>
      ) : (
        <p>索引完成后，链接到当前笔记的内容会显示在这里。</p>
      )}
    </section>
  )
}

function SaveStateIndicator({ cloudConnected, note, state }: { cloudConnected: boolean; note: Note; state: NoteSaveState }) {
  const label = state.status === "saving"
    ? note.source === "webdav" ? "正在同步" : "正在保存"
    : state.status === "pending"
      ? "待同步"
      : state.status === "conflict"
        ? "同步冲突"
        : state.status === "error"
          ? note.source === "webdav" ? "同步失败" : "保存失败"
          : state.status === "readonly"
            ? note.source === "webdav" ? "正文未缓存" : "只读"
            : note.source === "webdav" ? cloudConnected ? "已同步" : "仅本机缓存" : "已保存"
  const Icon = state.status === "saving"
    ? LoaderCircle
    : state.status === "pending"
      ? Cloud
      : state.status === "conflict"
        ? AlertTriangle
        : state.status === "error"
          ? AlertCircle
          : note.source === "webdav" && !cloudConnected
            ? CloudOff
            : Check

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="saved-state" data-status={state.status}>
          <Icon className={state.status === "saving" ? "animate-spin" : ""} />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{state.message ?? label}</TooltipContent>
    </Tooltip>
  )
}

type MobileLibraryProps = WorkspaceProps & FolderTreeProps & {
  initialScrollTop: number
  onScrollPositionChange: (scrollTop: number) => void
}

function MobileLibrary(props: MobileLibraryProps) {
  const viewportRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const restore = () => {
      viewport.scrollTop = Math.min(
        props.initialScrollTop,
        Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      )
    }
    restore()
    const frame = window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [props.initialScrollTop, props.totalNoteCount])

  const rememberPosition = () => {
    props.onScrollPositionChange(viewportRef.current?.scrollTop ?? 0)
  }

  const selectFolder = (folder: string | null) => {
    rememberPosition()
    props.onSelectFolder(folder)
  }

  return (
    <section className="mobile-screen mobile-library">
      <MobileBrandHeader
        connected={props.connected}
        isRefreshingVault={props.isRefreshingVault}
        mobileConnectionLabel={props.mobileConnectionLabel}
        onRefreshVault={props.onRefreshVault}
      />
      <ScrollArea className="mobile-scroll-content" viewportRef={viewportRef}>
        <div className="mobile-page-padding">
          <div className="mobile-search-row">
            <div className="note-search-wrap">
              <Search />
              <Input
                onChange={(event) => props.onQueryChange(event.target.value)}
                placeholder="搜索笔记、标签、内容"
                value={props.query}
              />
            </div>
          </div>
          <Button className="mobile-new-note" disabled={!props.canCreateNote || props.isCreatingNote} onClick={() => { rememberPosition(); props.onCreateNote() }}>
            {props.isCreatingNote ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
            {props.isCreatingNote ? "正在创建…" : props.canCreateNote ? "新建笔记" : "本地 Vault 中可新建"}
          </Button>
          <Button
            className="mobile-open-vault"
            disabled={!props.localVaultSupported || props.isOpeningVault}
            onClick={() => { rememberPosition(); props.onOpenLocalVault() }}
            variant="outline"
          >
            <FolderOpen data-icon="inline-start" />
            {props.isOpeningVault ? "正在读取…" : "打开本地笔记库"}
          </Button>
          <CacheSwitcher
            activeCacheId={props.activeCacheId}
            caches={props.vaultCaches}
            mobile
            onSelectCache={(cacheId) => {
              rememberPosition()
              props.onSelectVaultCache(cacheId)
            }}
          />
          {props.vaultError ? <p className="vault-error">{props.vaultError}</p> : null}

          <div className="mobile-library-rows">
            <MobileLibraryRow count={props.totalNoteCount} icon={FileText} label="全部笔记" onClick={() => { rememberPosition(); props.onSelectLibraryView("all") }} />
            <MobileLibraryRow count={Math.min(props.totalNoteCount, 32)} icon={CheckCircle2} label="最近更新" onClick={() => { rememberPosition(); props.onSelectLibraryView("recent") }} />
            <MobileLibraryRow count={props.starredNoteCount} icon={Star} label="收藏" onClick={() => { rememberPosition(); props.onSelectLibraryView("starred") }} />
          </div>

          <div className="mobile-section-heading">
            <span>文件夹</span>
            {props.canCreateFolder ? (
              <CreateFolderButton
                disabled={props.isManagingNote}
                onCreate={(name) => props.onCreateFolder(name, props.selectedFolder)}
                parentFolder={props.selectedFolder}
              />
            ) : null}
          </div>
          <div className="mobile-folder-list">
            {props.visibleFolders.map((folder) => (
              <MobileLibraryRow
                count={folder.count}
                depth={folder.depth}
                expanded={folder.hasChildren ? props.expandedFolderPaths.has(folder.path) : undefined}
                folderTree
                icon={props.selectedFolder === folder.path ? FolderOpen : Folder}
                key={folder.path}
                label={folder.label}
                onClick={() => selectFolder(folder.path)}
                onToggle={folder.hasChildren ? () => props.onToggleFolder(folder.path) : undefined}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
      <AppBottomNav activeSection="notes" onNavigate={props.onNavigate} />
    </section>
  )
}

function formatCacheDate(savedAt: number) {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return "时间未知"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

type MobileLibraryRowProps = {
  count?: number
  depth?: number
  expanded?: boolean
  folderTree?: boolean
  icon: typeof FileText
  label: string
  onClick?: () => void
  onToggle?: () => void
}

function MobileLibraryRow({ count, depth = 0, expanded, folderTree = false, icon: Icon, label, onClick, onToggle }: MobileLibraryRowProps) {
  return (
    <div className="mobile-library-row" data-depth={Math.min(depth, 3)}>
      {folderTree ? (
        onToggle ? (
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "折叠" : "展开"}${label}`}
            className="mobile-folder-toggle"
            onClick={onToggle}
            type="button"
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
        ) : <span className="mobile-folder-toggle-placeholder" />
      ) : null}
      <button className="mobile-library-row-main" onClick={onClick} type="button">
        <Icon />
        <span>{label}</span>
        {typeof count === "number" ? <small>{count}</small> : null}
        {folderTree ? null : <ChevronRight className="mobile-row-navigation" />}
      </button>
    </div>
  )
}

type MobileNoteListProps = WorkspaceProps & {
  initialScrollTop: number
  onScrollPositionChange: (scrollTop: number) => void
}

function MobileNoteList(props: MobileNoteListProps) {
  const groups = groupNotes(props.notes)
  const viewportRef = useRef<HTMLDivElement>(null)
  const title = props.selectedFolder
    ?? (props.libraryView === "recent" ? "最近更新" : props.libraryView === "starred" ? "收藏" : "全部笔记")

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    // 列表重新挂载时在首次绘制前恢复位置，并按当前内容高度收敛，避免返回详情时闪到顶部。
    const restore = () => {
      viewport.scrollTop = Math.min(
        props.initialScrollTop,
        Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      )
    }
    restore()
    // Radix Viewport 在筛选结果切换时可能下一帧才完成尺寸计算，因此再校准一次最终位置。
    const frame = window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [props.initialScrollTop, props.notes.length])

  const selectNote = (note: Note) => {
    props.onScrollPositionChange(viewportRef.current?.scrollTop ?? 0)
    props.onSelectNote(note)
  }

  return (
    <section className="mobile-screen">
      <header className="mobile-titlebar">
        <Button aria-label="返回笔记库" onClick={() => props.onMobileScreenChange("library")} size="icon" variant="ghost"><ArrowLeft /></Button>
        <h1>{title}</h1>
        <div>
          {props.selectedFolder && props.folderManagementMode ? <FolderRenameButton disabled={props.isManagingNote} folderPath={props.selectedFolder} mode={props.folderManagementMode} onDelete={props.onDeleteFolder} onRename={props.onRenameFolder} /> : null}
          <TagFilterMenu availableTags={props.availableTags} onChange={props.onSelectTag} selectedTag={props.selectedTag} />
          <NoteSortMenu mobile onChange={props.onNoteSortChange} sort={props.noteSort} />
        </div>
      </header>
      <div className="mobile-list-search">
        <div className="note-search-wrap"><Search /><Input onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索笔记" value={props.query} /></div>
      </div>
      <ScrollArea
        className="mobile-scroll-content"
        viewportRef={viewportRef}
      >
        <div className="mobile-note-groups">
          {groups.length > 0 ? groups.map((group) => (
            <section key={group.label}>
              <div className="note-group-label"><span>{group.label}</span></div>
              {group.notes.map((note) => (
                <NoteListRow
                  active={note.id === props.activeNoteId}
                  key={note.id}
                  note={note}
                  onSelect={selectNote}
                />
              ))}
            </section>
          )) : <EmptyNoteList canCreateNote={props.canCreateNote} onCreateNote={props.onCreateNote} onOpenSettings={props.onOpenSettings} selectedFolder={props.selectedFolder} />}
        </div>
      </ScrollArea>
      {props.canCreateNote ? <Button aria-label="新建笔记" className="mobile-fab" disabled={props.isCreatingNote} onClick={props.onCreateNote} size="icon-lg">{props.isCreatingNote ? <LoaderCircle className="animate-spin" /> : <Plus />}</Button> : null}
      <AppBottomNav activeSection="notes" onNavigate={props.onNavigate} />
    </section>
  )
}

function MobileBrandHeader({
  connected,
  isRefreshingVault,
  mobileConnectionLabel,
  onRefreshVault,
}: Pick<WorkspaceProps, "connected" | "isRefreshingVault" | "mobileConnectionLabel" | "onRefreshVault">) {
  return (
    <header className="mobile-brand-header">
      <img alt="Swell Note" src={swellNoteLogo} />
      <strong>Swell Note</strong>
      <button
        aria-label={connected ? "同步当前笔记库" : "重新连接并更新"}
        className="mobile-sync-state"
        disabled={isRefreshingVault}
        onClick={onRefreshVault}
        type="button"
      >
        {isRefreshingVault
          ? <LoaderCircle className="animate-spin" />
          : connected ? <CheckCircle2 data-connected /> : <RefreshCw />}
        <span>{mobileConnectionLabel}</span>
      </button>
    </header>
  )
}

export function AppBottomNav({
  activeSection,
  onNavigate,
}: {
  activeSection: AppSection
  onNavigate: (path: string) => void
}) {
  return (
    <nav className="mobile-bottom-nav" aria-label="手机主导航">
      <button className="mobile-tab" data-active={activeSection === "notes"} onClick={() => onNavigate("/notes")} type="button"><FileText /><span>笔记</span></button>
      <button className="mobile-tab" data-active={activeSection === "todos"} onClick={() => onNavigate("/todos")} type="button"><CheckCircle2 /><span>待办</span></button>
      <button className="mobile-tab" data-active={activeSection === "settings"} onClick={() => onNavigate("/settings")} type="button"><Settings /><span>设置</span></button>
    </nav>
  )
}

function groupNotes(notes: Note[]) {
  if (notes.length === 0) return []
  if (notes.length <= 2) return [{ label: "今天", notes }]
  return [
    { label: "今天", notes: notes.slice(0, 2) },
    { label: "昨天", notes: notes.slice(2, 5) },
    { label: "过去 7 天", notes: notes.slice(5) },
  ].filter((group) => group.notes.length > 0)
}

function deriveFolder(note: Note) {
  if (note.folder) return note.folder
  if (!note.remotePath) return "产品规划 / 跨端产品"
  const segments = note.remotePath.split("/").filter(Boolean)
  return segments.slice(0, -1).join(" / ") || "坚果云"
}
