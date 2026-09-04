import { memo, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS as DndCss } from "@dnd-kit/utilities"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Cloud,
  CloudOff,
  History,
  Database,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderCog,
  FolderPlus,
  FolderTree,
  GripVertical,
  ListTree,
  ListFilter,
  Link2,
  LockKeyhole,
  LoaderCircle,
  MoreHorizontal,
  Menu,
  Eye,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react"

import swellNoteLogo from "@/assets/brand/swell-note-logo-ribbon-s.svg"
import { Button } from "@/components/ui/button"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { useOptionalStableCallback, useStableCallback } from "@/lib/use-stable-callback"
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
import type { EmbeddedWikiNoteResult } from "@/components/editor/markdown-preview"
import type { VaultAsset } from "@/services/vault/vault-adapter"
import { isExcalidrawMarkdown } from "@/services/markdown/markdown-preview-utils"
import {
  getDirectChildVaultFolders,
  getFolderAncestorPaths,
  getParentFolderPath,
  getVisibleVaultFolders,
  noteBelongsDirectlyToFolder,
  type VaultFolder,
} from "@/services/search/vault-folders"
import { buildNotePreview } from "@/services/markdown/note-preview"
import { extractNoteOutline } from "@/services/markdown/note-outline"
import { buildMarkdownNoteLink, buildRelativeMarkdownHref } from "@/services/markdown/markdown-link"
import { getLocalDayIndex, groupNotesByDate } from "@/services/search/note-groups"
import { sortNotes, type NoteSort } from "@/services/search/note-sort"
import { loadUiPreferences, saveUiPreferences, type NoteViewMode } from "@/services/preferences/ui-preferences"
import { applyFolderOrder, loadFolderOrder, saveFolderOrder } from "@/services/preferences/folder-order-preferences"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import { FormattingToolbar } from "@/components/workspace/formatting-toolbar"
import { NoteVersionHistoryDialog } from "@/components/workspace/note-version-history-dialog"
import type { VaultCacheSummary } from "@/services/cache/vault-cache"
import { getNoteBreadcrumbSegments } from "@/lib/note-routes"
import { stableNoteRenderIdentity } from "@/lib/note-route-resolution"
import { MobileNoteSearch } from "@/components/workspace/mobile-note-search"
import { MobileFolderActionSheet, MobileNoteActionSheet } from "@/components/workspace/mobile-action-sheets"
import { SelectionActionBar } from "@/components/workspace/selection-action-bar"
import { isSelectionDismissTap, keepsSelectionAlive, type PointerOrigin } from "@/components/workspace/selection-dismiss"
import { hasOpenModal, isTextEntryElement, selectElementContents } from "@/components/workspace/shortcut-scope"
import {
  ContextMenuRequestDialog,
  FolderRowContextMenu,
  NoteRowContextMenu,
  type ContextMenuRequest,
  type FolderContextActions,
  type NoteContextActions,
} from "@/components/workspace/context-menus"
import { useLongPress } from "@/components/workspace/use-long-press"
import { useEdgeSwipeAction } from "@/components/workspace/use-edge-swipe-action"
import { SyncActivityToast } from "@/components/workspace/sync-activity-toast"
import { mobileLibraryScrollMemory, mobileNoteListScrollMemory, noteEditorScrollMemory } from "@/services/navigation/mobile-scroll-memory"
import type { SyncProgress } from "@/services/sync/sync-progress"
import { shouldShowFloatingSyncProgress } from "@/services/sync/sync-progress"
import { SyncFailureToast } from "./sync-failure-toast"

// CodeMirror 体积较大，延迟到编辑区真正渲染时再加载，避免拖慢首屏资料库与列表。
const MarkdownEditor = lazyWithRetry(() => import("@/components/editor/markdown-editor"))
const MarkdownPreview = lazyWithRetry(() => import("@/components/editor/markdown-preview"))
const CanvasPreview = lazyWithRetry(() => import("@/components/editor/canvas-preview"))

export type MobileScreen = "library" | "notes" | "editor"

// 手机端两层页面的渲染单元：key 是页面身份，交接时靠它决定复用还是重建。
type MobileScreenLayer = { key: string; node: ReactNode }

// 手机端三级页面的层级深浅，用来判断这次切换是往里走还是往回退。
const MOBILE_SCREEN_DEPTH: Record<MobileScreen, number> = { editor: 2, library: 0, notes: 1 }

export type AppSection = "notes" | "settings" | "todos"
export type LibraryView = "all" | "recent" | "starred"

type WorkspaceProps = {
  activeCacheId: string | null
  activeNote: Note | null
  activeNoteId: string
  activeNoteLoadError: string | null
  activeNoteLoading: boolean
  availableTags: string[]
  backlinks: Note[]
  connectionLabel: string
  cloudConnected: boolean
  connected: boolean
  canCreateNote: boolean
  canCreateFolder: boolean
  folders: VaultFolder[]
  allNotes: Note[]
  folderManagementMode: "local" | "webdav" | null
  includeNestedFolderNotes: boolean
  isOpeningVault: boolean
  isCreatingNote: boolean
  canInsertAttachment: boolean
  isManagingNote: boolean
  isNoteDetailRoute: boolean
  missingNoteRoute: boolean
  missingNoteSuggestions: Note[]
  isRefreshingVault: boolean
  libraryView: LibraryView
  localVaultSupported: boolean
  mobileScreen: MobileScreen
  mobileConnectionLabel: string
  mobileListStateKey: string
  noteViewMode: NoteViewMode
  noteSort: NoteSort
  notes: Note[]
  onCreateNote: () => void
  onCreateNoteInFolder: (folderPath: string) => void
  onCreateFolder: (name: string, parentFolder: string | null) => void
  onFormat: (syntax: string) => void
  onFormatNote: (noteId: string, syntax: string) => void
  onInsertAttachments: (files: File[]) => Promise<AttachmentWriteResult>
  onIncludeNestedFolderNotesChange: (include: boolean) => void
  onImportNotes: (files: File[]) => void
  onMobileScreenChange: (screen: MobileScreen) => void
  onNoteViewModeChange: (mode: NoteViewMode) => void
  onDeleteNote: () => void
  onDeleteNoteById: (noteId: string) => void
  onDeleteFolder: (folderPath: string) => void
  onExportNote: () => void
  onOpenLocalVault: () => void
  onLoadWikiNote: (target: string) => void
  onOpenWikiLink: (target: string) => void
  onOpenSourceFile: () => void
  onMoveNote: (folderPath: string | null) => void
  onMoveNoteById: (noteId: string, folderPath: string | null) => void
  onRenameFolder: (folderPath: string, nextName: string) => void
  onRenameNote: (title: string) => void
  onRenameNoteById: (noteId: string, title: string) => void
  onOpenSettings: () => void
  onNavigate: (path: string) => void
  onQueryChange: (query: string) => void
  onNoteSortChange: (sort: NoteSort) => void
  onReloadNote: () => void
  onRetryNoteLoad: () => void
  onRefreshVault: () => void
  onResolveConflict: (strategy: "local" | "merge" | "remote") => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onResolveWikiNote: (target: string) => EmbeddedWikiNoteResult
  onRestoreNoteVersion: (content: string) => void
  onToggleNoteStar: (noteId: string) => void
  onToggleNoteTask?: (noteId: string, line: number, checked: boolean) => void
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
  syncFailure: string | null
  syncProgress: SyncProgress | null
  totalNoteCount: number
  onCancelSync: () => void
  onDismissSyncFailure: () => void
  onRetrySync: () => void
  vaultError: string | null
  vaultCaches: VaultCacheSummary[]
}

export function Workspace(props: WorkspaceProps) {
  const mobileLayout = useMobileWorkspaceLayout()
  const showSyncProgressToast = shouldShowFloatingSyncProgress(props.syncProgress, mobileLayout)
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(() => new Set())
  const activeNoteUsesSpecialPreview = Boolean(
    props.activeNote
    && (props.activeNote.format === "canvas" || isExcalidrawMarkdown(props.activeNote.content)),
  )

  useEffect(() => {
    if (!props.activeNote || activeNoteUsesSpecialPreview) return
    const toggleViewMode = (event: KeyboardEvent) => {
      // 与其他桌面快捷键一致地忽略长按重复：按住不放会连着翻转视图，来回闪。
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return
      if (event.key.toLocaleLowerCase() !== "e" || hasOpenModal()) return
      event.preventDefault()
      props.onNoteViewModeChange(props.noteViewMode === "preview" ? "edit" : "preview")
    }
    // 桌面与移动布局会同时挂载，快捷键统一放在 Workspace，避免两个编辑器各触发一次相互抵消。
    document.addEventListener("keydown", toggleViewMode)
    return () => document.removeEventListener("keydown", toggleViewMode)
  }, [activeNoteUsesSpecialPreview, props.activeNote?.id, props.noteViewMode, props.onNoteViewModeChange])

  useEffect(() => {
    const handleDesktopShortcut = (event: KeyboardEvent) => {
      if (window.matchMedia("(max-width: 767px)").matches) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return
      // 弹窗开着时这些动作都会打断当前操作：抢走焦点、在背后新建笔记或触发同步。
      if (hasOpenModal()) return
      const key = event.key.toLocaleLowerCase()
      if (key === "k") {
        event.preventDefault()
        const search = document.querySelector<HTMLInputElement>(".desktop-workspace .note-search-wrap input")
        search?.focus()
        search?.select()
        return
      }
      if (key === "n" && !event.shiftKey && props.canCreateNote && !props.isCreatingNote) {
        event.preventDefault()
        props.onCreateNote()
        return
      }
      if (key === "s" && event.shiftKey && !props.isRefreshingVault) {
        event.preventDefault()
        props.onRefreshVault()
      }
    }
    // 桌面端高频动作统一由工作区分发，避免输入框和编辑器各自重复注册全局快捷键。
    document.addEventListener("keydown", handleDesktopShortcut)
    return () => document.removeEventListener("keydown", handleDesktopShortcut)
  }, [props.canCreateNote, props.isCreatingNote, props.isRefreshingVault, props.onCreateNote, props.onRefreshVault])

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

  const toggleFolder = useCallback((folderPath: string) => {
    // 展开状态只记录路径；目录刷新后仍可依赖相同路径恢复，已经消失的路径不会影响渲染。
    setExpandedFolderPaths((current) => {
      const next = new Set(current)
      if (next.has(folderPath)) next.delete(folderPath)
      else {
        const folder = props.folders.find(({ path }) => path === folderPath)
        if (folder?.depth === 0) {
          // 一级目录使用手风琴规则，避免多个大型子树同时展开挤满侧栏；目标分支内的二级展开状态继续保留。
          for (const path of next) {
            if (!path.startsWith(`${folderPath} / `)) next.delete(path)
          }
        }
        next.add(folderPath)
      }
      return next
    })
  }, [props.folders])

  return (
    <main className="workspace-root">
      {mobileLayout ? (
        <MobileWorkspace
          {...props}
          expandedFolderPaths={expandedFolderPaths}
          onToggleFolder={toggleFolder}
          visibleFolders={visibleFolders}
        />
      ) : (
        <DesktopWorkspace
          {...props}
          expandedFolderPaths={expandedFolderPaths}
          onToggleFolder={toggleFolder}
          visibleFolders={visibleFolders}
        />
      )}
      {showSyncProgressToast && props.syncProgress ? <SyncActivityToast onCancel={props.onCancelSync} progress={props.syncProgress} /> : null}
      {!showSyncProgressToast && props.syncFailure ? (
        <SyncFailureToast
          message={props.syncFailure}
          onDismiss={props.onDismissSyncFailure}
          onRetry={props.onRetrySync}
        />
      ) : null}
    </main>
  )
}

function useMobileWorkspaceLayout() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches)

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)")
    const update = () => setMobile(media.matches)
    // 只挂载当前断点的工作区，避免隐藏布局继续解析 Markdown、创建编辑器和读取图片。
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  return mobile
}

type FolderTreeProps = {
  expandedFolderPaths: ReadonlySet<string>
  onToggleFolder: (folderPath: string) => void
  visibleFolders: VaultFolder[]
}

function DesktopWorkspace(props: WorkspaceProps & FolderTreeProps) {
  const [paneWidths, setPaneWidths] = useState(() => {
    const preferences = loadUiPreferences()
    return {
      library: preferences.libraryPaneWidth,
      noteList: preferences.noteListPaneWidth,
    }
  })
  useEffect(() => {
    // 拖拽时宽度会高频变化，延迟落盘避免每个 pointermove 都同步写 localStorage。
    const timer = window.setTimeout(() => {
      saveUiPreferences({
        libraryPaneWidth: paneWidths.library,
        noteListPaneWidth: paneWidths.noteList,
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [paneWidths])
  const workspaceStyle = {
    "--library-pane-width": `${paneWidths.library}px`,
    "--note-list-pane-width": `${paneWidths.noteList}px`,
  } as CSSProperties
  // 只有详情路由才进入沉浸画布；切到目录/列表路由时必须立即恢复笔记列表，即使 activeNote 仍保留上一条笔记。
  const immersiveExcalidraw = Boolean(
    props.isNoteDetailRoute
    && props.activeNote
    && isExcalidrawMarkdown(props.activeNote.content),
  )
  // 右键菜单里的重命名、删除都要接着弹对话框；请求集中放在工作区，行随虚拟列表回收也不会打断。
  const [contextRequest, setContextRequest] = useState<ContextMenuRequest | null>(null)
  // 与移动端长按面板一致：只有笔记正在被重命名/移动/删除时才禁用，同步刷新不挡住菜单。
  const contextActionsDisabled = props.isManagingNote
  // 列表行靠 memo 跳过重渲染，传进去的回调和菜单配置必须引用稳定，
  // 否则编辑正文时每次按键都会把整屏笔记行重画一遍。
  const selectNote = useStableCallback(props.onSelectNote)
  const selectFolder = useStableCallback(props.onSelectFolder)
  const moveNoteById = useStableCallback(props.onMoveNoteById)
  const toggleNoteStar = useStableCallback(props.onToggleNoteStar)
  const createNoteInFolder = useStableCallback(props.onCreateNoteInFolder)
  // 编辑器面板与搜索、目录树毫无关系，却因为回调每次重建而跟着整屏重渲染。
  // 这一组把它的入参全部固定下来，memo 才拦得住。
  const deleteNote = useStableCallback(props.onDeleteNote)
  const exportNote = useStableCallback(props.onExportNote)
  const formatNote = useStableCallback(props.onFormat)
  const formatNoteById = useStableCallback(props.onFormatNote)
  const insertAttachments = useStableCallback(props.onInsertAttachments)
  const loadWikiNote = useStableCallback(props.onLoadWikiNote)
  const openWikiLink = useStableCallback(props.onOpenWikiLink)
  const openSourceFile = useStableCallback(props.onOpenSourceFile)
  const moveNote = useStableCallback(props.onMoveNote)
  const changeNoteViewMode = useStableCallback(props.onNoteViewModeChange)
  const renameNote = useStableCallback(props.onRenameNote)
  const updateNote = useStableCallback(props.onUpdateNote)
  const reloadNote = useStableCallback(props.onReloadNote)
  const resolveConflict = useStableCallback(props.onResolveConflict)
  const resolveAsset = useStableCallback(props.onResolveAsset)
  const resolveWikiNote = useStableCallback(props.onResolveWikiNote)
  const restoreNoteVersion = useStableCallback(props.onRestoreNoteVersion)
  const refreshVault = useStableCallback(props.onRefreshVault)
  const activeNoteId = props.activeNoteId
  // 上游传的是内联箭头，不先稳定住，下面按笔记绑定的那层每次渲染都会换新函数，memo 就白加了。
  const toggleNoteTask = useOptionalStableCallback(props.onToggleNoteTask)
  // 侧栏与搜索、正文同样无关；这些回调固定后 memo 才能把它挡在重渲染之外。
  const createNote = useStableCallback(props.onCreateNote)
  const createFolder = useStableCallback(props.onCreateFolder)
  const importNotes = useStableCallback(props.onImportNotes)
  const openLocalVault = useStableCallback(props.onOpenLocalVault)
  const openSettings = useStableCallback(props.onOpenSettings)
  const toggleFolder = useStableCallback(props.onToggleFolder)
  const selectLibraryView = useStableCallback(props.onSelectLibraryView)
  const selectVaultCache = useStableCallback(props.onSelectVaultCache)
  const toggleActiveNoteTask = useMemo(
    () => toggleNoteTask
      ? (line: number, checked: boolean) => toggleNoteTask(activeNoteId, line, checked)
      : undefined,
    [activeNoteId, toggleNoteTask],
  )
  const noteContextActions = useMemo<NoteContextActions>(() => ({
    disabled: contextActionsDisabled,
    folders: props.folders,
    onMove: moveNoteById,
    onOpen: selectNote,
    onRequest: setContextRequest,
    onToggleStar: toggleNoteStar,
  }), [contextActionsDisabled, moveNoteById, props.folders, selectNote, toggleNoteStar])
  const folderContextActions = useMemo<FolderContextActions>(() => ({
    canCreateNote: props.canCreateNote && !props.isCreatingNote,
    disabled: contextActionsDisabled,
    mode: props.folderManagementMode,
    onCreateNote: createNoteInFolder,
    onOpen: selectFolder,
    onRequest: setContextRequest,
  }), [contextActionsDisabled, createNoteInFolder, props.canCreateNote, props.folderManagementMode, props.isCreatingNote, selectFolder])
  return (
    <div className="desktop-workspace" data-immersive-excalidraw={immersiveExcalidraw} style={workspaceStyle}>
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
        folderContextActions={folderContextActions}
        folders={props.visibleFolders}
        libraryView={props.libraryView}
        noteCount={props.totalNoteCount}
        starredNoteCount={props.starredNoteCount}
        onCreateNote={createNote}
        onCreateFolder={createFolder}
        onImportNotes={importNotes}
        onOpenLocalVault={openLocalVault}
        onOpenSettings={openSettings}
        onRefreshVault={refreshVault}
        onSelectFolder={selectFolder}
        onToggleFolder={toggleFolder}
        onSelectLibraryView={selectLibraryView}
        onSelectVaultCache={selectVaultCache}
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
      {!immersiveExcalidraw ? (
        <DesktopPaneResizeHandle
          className="library-pane-resizer"
          label="调整笔记库侧栏宽度"
          max={340}
          min={205}
          onChange={(library) => setPaneWidths((current) => ({ ...current, library }))}
          value={paneWidths.library}
        />
      ) : null}
      {!immersiveExcalidraw ? <NoteListPanel
        activeNoteId={props.activeNoteId}
        canCreateNote={props.canCreateNote}
        folderContextActions={folderContextActions}
        folders={props.folders}
        noteContextActions={noteContextActions}
        includeNestedFolderNotes={props.includeNestedFolderNotes}
        notes={props.notes}
        noteSort={props.noteSort}
        folderLabel={props.selectedFolder ?? (props.libraryView === "recent" ? "最近更新" : props.libraryView === "starred" ? "收藏" : "全部笔记")}
        folderManagementMode={props.folderManagementMode}
        onOpenSettings={props.onOpenSettings}
        onCreateNote={props.onCreateNote}
        onIncludeNestedFolderNotesChange={props.onIncludeNestedFolderNotesChange}
        onQueryChange={props.onQueryChange}
        onNoteSortChange={props.onNoteSortChange}
        onDeleteFolder={props.onDeleteFolder}
        onRenameFolder={props.onRenameFolder}
        onSelectNote={selectNote}
        onSelectFolder={selectFolder}
        availableTags={props.availableTags}
        onSelectTag={props.onSelectTag}
        query={props.query}
        selectedTag={props.selectedTag}
        selectedFolder={props.selectedFolder}
        isManagingFolder={props.isManagingNote}
        isLoading={props.isRefreshingVault}
      /> : null}
      {!immersiveExcalidraw ? (
        <DesktopPaneResizeHandle
          className="note-list-pane-resizer"
          label="调整笔记列表宽度"
          max={440}
          min={280}
          onChange={(noteList) => setPaneWidths((current) => ({ ...current, noteList }))}
          value={paneWidths.noteList}
        />
      ) : null}
      {props.activeNote ? props.activeNoteLoading || props.activeNoteLoadError ? (
        <NoteDocumentState
          error={props.activeNoteLoadError}
          loading={props.activeNoteLoading}
          onRetry={props.onRetryNoteLoad}
          title={props.activeNote.title}
        />
      ) : (
        <NoteEditor
          activeCacheId={props.activeCacheId}
          backlinks={props.backlinks}
          onSelectFolder={selectFolder}
          canInsertAttachment={props.canInsertAttachment}
          cloudConnected={props.cloudConnected}
          canManageNote={Boolean(
            props.activeNote.remotePath
            && !props.activeNote.readOnly,
          )}
          isManagingNote={props.isManagingNote}
          moveTargets={props.folders}
          note={props.activeNote}
          // 补全候选取整库而不是当前筛选结果：搜索时列表被裁短，链接候选不该跟着一起消失。
          wikiLinkNotes={props.allNotes}
          noteViewMode={props.noteViewMode}
          onDeleteNote={deleteNote}
          onExportNote={exportNote}
          onFormat={formatNote}
          onFormatNote={formatNoteById}
          onInsertAttachments={insertAttachments}
          onLoadWikiNote={loadWikiNote}
          onOpenWikiLink={openWikiLink}
          onOpenSourceFile={openSourceFile}
          onMoveNote={moveNote}
          onNoteViewModeChange={changeNoteViewMode}
          onRenameNote={renameNote}
          onSelectNote={selectNote}
          onUpdateNote={updateNote}
          onReloadNote={reloadNote}
          onResolveConflict={resolveConflict}
          onResolveAsset={resolveAsset}
          onResolveWikiNote={resolveWikiNote}
          onRestoreNoteVersion={restoreNoteVersion}
          onSync={refreshVault}
          onToggleTask={toggleActiveNoteTask}
          saveState={props.saveState}
          syncing={props.isRefreshingVault}
        />
      ) : <EmptyNoteEditor canCreateNote={props.canCreateNote} canRefresh={Boolean(props.activeCacheId)} hasNotes={props.totalNoteCount > 0} isLoading={props.isRefreshingVault} missing={props.missingNoteRoute} onBack={props.missingNoteRoute ? () => props.onMobileScreenChange("notes") : undefined} onOpenSettings={props.onOpenSettings} onRefresh={props.onRefreshVault} onSelectNote={props.onSelectNote} suggestions={props.missingNoteSuggestions} />}
      <ContextMenuRequestDialog
        folderMode={props.folderManagementMode}
        onClose={() => setContextRequest(null)}
        onCreateFolder={props.onCreateFolder}
        onDeleteFolder={props.onDeleteFolder}
        onDeleteNote={props.onDeleteNoteById}
        onRenameFolder={props.onRenameFolder}
        onRenameNote={props.onRenameNoteById}
        request={contextRequest}
      />
    </div>
  )
}

type DesktopPaneResizeHandleProps = {
  className: string
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}

function DesktopPaneResizeHandle({ className, label, max, min, onChange, value }: DesktopPaneResizeHandleProps) {
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => {
    cleanupRef.current?.()
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    cleanupRef.current?.()
    const startX = event.clientX
    const startWidth = value
    const move = (moveEvent: PointerEvent) => onChange(Math.min(max, Math.max(min, startWidth + moveEvent.clientX - startX)))
    const finish = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", finish)
      window.removeEventListener("blur", finish)
      document.documentElement.removeAttribute("data-resizing-pane")
      cleanupRef.current = null
    }
    document.documentElement.setAttribute("data-resizing-pane", "true")
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish, { once: true })
    window.addEventListener("pointercancel", finish, { once: true })
    window.addEventListener("blur", finish, { once: true })
    cleanupRef.current = finish
  }

  return (
    <button
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={`desktop-pane-resizer ${className}`}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        onChange(Math.min(max, Math.max(min, value + (event.key === "ArrowLeft" ? -12 : 12))))
      }}
      onPointerDown={startResize}
      role="separator"
      type="button"
    />
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
  folderContextActions: FolderContextActions
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
  starredNoteCount: number
  onCreateNote: () => void
  onCreateFolder: (name: string, parentFolder: string | null) => void
  onImportNotes: (files: File[]) => void
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

// 侧栏只关心目录树与笔记库状态，搜索输入和正文编辑都不该惊动它。
const LibraryPanel = memo(function LibraryPanel({
  activeCacheId,
  connected,
  canCreateNote,
  canCreateFolder,
  connectionLabel,
  expandedFolderPaths,
  folderContextActions,
  folders,
  isManagingFolder,
  isOpeningVault,
  isCreatingNote,
  isRefreshingVault,
  libraryView,
  localVaultSupported,
  noteCount,
  starredNoteCount,
  onCreateNote,
  onCreateFolder,
  onImportNotes,
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
        <ImportMarkdownButton disabled={!canCreateNote || isCreatingNote} onImport={onImportNotes} />
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
          <LibraryRow active={libraryView === "starred"} count={starredNoteCount} icon={Star} label="收藏" onClick={() => onSelectLibraryView("starred")} />

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
              contextActions={folderContextActions}
              contextFolder={folder}
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
})

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
  contextActions?: FolderContextActions
  contextFolder?: VaultFolder
  count?: number
  depth?: number
  expanded?: boolean
  folderTree?: boolean
  icon: typeof FileText
  label: string
  onClick?: () => void
  onToggle?: () => void
}

function LibraryRow({ active = false, contextActions, contextFolder, count, depth = 0, expanded, folderTree = false, icon: Icon, label, onClick, onToggle }: LibraryRowProps) {
  const row = (
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
            {/* 展开态靠 CSS 旋转同一个图标，换组件会让箭头直接跳变，接不上折叠动画。 */}
            <ChevronRight />
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
  return contextActions && contextFolder
    ? <FolderRowContextMenu actions={contextActions} folder={contextFolder}>{row}</FolderRowContextMenu>
    : row
}

type NoteListPanelProps = {
  activeNoteId: string
  availableTags: string[]
  canCreateNote: boolean
  folderContextActions: FolderContextActions
  noteContextActions: NoteContextActions
  folders: VaultFolder[]
  folderLabel: string
  folderManagementMode: "local" | "webdav" | null
  includeNestedFolderNotes: boolean
  notes: Note[]
  noteSort: NoteSort
  isManagingFolder: boolean
  isLoading: boolean
  onCreateNote: () => void
  onIncludeNestedFolderNotesChange: (include: boolean) => void
  onOpenSettings: () => void
  onQueryChange: (query: string) => void
  onNoteSortChange: (sort: NoteSort) => void
  onDeleteFolder: (folderPath: string) => void
  onRenameFolder: (folderPath: string, nextName: string) => void
  onSelectNote: (note: Note) => void
  onSelectFolder: (folder: string | null) => void
  onSelectTag: (tag: string | null) => void
  query: string
  selectedTag: string | null
  selectedFolder: string | null
}

function NoteListPanel({
  activeNoteId,
  availableTags,
  canCreateNote,
  folderContextActions,
  noteContextActions,
  folders,
  folderLabel,
  folderManagementMode,
  includeNestedFolderNotes,
  isManagingFolder,
  isLoading,
  notes,
  noteSort,
  onCreateNote,
  onIncludeNestedFolderNotesChange,
  onOpenSettings,
  onQueryChange,
  onNoteSortChange,
  onDeleteFolder,
  onRenameFolder,
  onSelectNote,
  onSelectFolder,
  onSelectTag,
  query,
  selectedTag,
  selectedFolder,
}: NoteListPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportReady, setViewportReady] = useState(false)
  const setViewportRef = useCallback((viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport
    // 沉浸画布会卸载整个列表；等待新的 ScrollArea 真正挂载后再创建 virtualizer，避免首次返回得到空行集。
    if (viewport) setViewportReady(true)
  }, [])
  const childFolders = useMemo(
    () => selectedFolder ? getDirectChildVaultFolders(folders, selectedFolder) : [],
    [folders, selectedFolder],
  )

  return (
    <section className="note-list-panel">
      <div className="pane-header note-list-titlebar">
        <div>
          <span className="eyebrow">当前目录</span>
          <h2>{folderLabel}</h2>
        </div>
        <div className="note-list-actions">
          {selectedFolder && folderManagementMode ? <FolderRenameButton disabled={isManagingFolder} folderPath={selectedFolder} mode={folderManagementMode} onDelete={onDeleteFolder} onRename={onRenameFolder} /> : null}
          {childFolders.length > 0 ? (
            <NestedNotesToggle
              includeNested={includeNestedFolderNotes}
              onChange={onIncludeNestedFolderNotesChange}
            />
          ) : null}
          <TagFilterMenu availableTags={availableTags} onChange={onSelectTag} selectedTag={selectedTag} />
          <NoteSortMenu onChange={onNoteSortChange} sort={noteSort} />
        </div>
      </div>

      <div className="note-search-wrap">
        <Search />
        <Input
          aria-label="搜索笔记"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            // 搜索框没有清空按钮，键盘用户只能靠 Esc 退出：先清空关键词，已经空了就交还焦点。
            if (event.key !== "Escape") return
            if (query) onQueryChange("")
            else event.currentTarget.blur()
          }}
          placeholder="搜索笔记、标签、内容"
          value={query}
        />
        <kbd aria-hidden="true">⌘K</kbd>
      </div>

      <ScrollArea className="note-list-scroll" viewportRef={setViewportRef}>
        <div className="note-groups">
          {viewportReady && (notes.length > 0 || childFolders.length > 0) ? (
            <VirtualNoteRows
              activeNoteId={activeNoteId}
              folderContextActions={folderContextActions}
              folders={childFolders}
              noteContextActions={noteContextActions}
              noteSort={noteSort}
              notes={notes}
              onSelectFolder={onSelectFolder}
              onSelectNote={onSelectNote}
              viewportRef={viewportRef}
            />
          ) : viewportReady ? <EmptyNoteList canCreateNote={canCreateNote} isLoading={isLoading} onCreateNote={onCreateNote} onOpenSettings={onOpenSettings} selectedFolder={selectedFolder} /> : null}
        </div>
      </ScrollArea>
    </section>
  )
}

function NestedNotesToggle({
  includeNested,
  onChange,
}: {
  includeNested: boolean
  onChange: (include: boolean) => void
}) {
  const label = includeNested ? "仅显示当前目录" : "包含子目录笔记"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          aria-pressed={includeNested}
          data-active={includeNested}
          onClick={() => onChange(!includeNested)}
          size="icon-sm"
          variant="ghost"
        >
          <FolderTree />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function EmptyNoteList({
  canCreateNote,
  isLoading,
  onCreateNote,
  onOpenSettings,
  selectedFolder,
}: {
  canCreateNote: boolean
  isLoading: boolean
  onCreateNote: () => void
  onOpenSettings: () => void
  selectedFolder: string | null
}) {
  if (isLoading) {
    return (
      <div className="note-list-empty" data-status="loading" role="status" aria-live="polite">
        <LoaderCircle className="app-loading-spinner" />
        <strong>正在读取笔记</strong>
        <p>正在检查远端目录和本机缓存，完成后会在这里显示结果。</p>
      </div>
    )
  }

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
          <DialogDescription>{parentFolder ? `将在“${parentFolder}”下创建子文件夹。` : "将在当前笔记库根目录创建文件夹；坚果云目录会先保存在本机，点击同步后上传。"}</DialogDescription>
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

function NoteDocumentState({
  backLabel,
  error,
  loading,
  onBack,
  onRetry,
  title,
}: {
  backLabel?: string
  error: string | null
  loading: boolean
  onBack?: () => void
  onRetry: () => void
  title: string
}) {
  return (
    <article className="note-editor empty-note-editor">
      <header className="editor-titlebar">
        {onBack ? <Button aria-label={`返回${backLabel ?? "笔记列表"}`} onClick={onBack} size="icon" variant="ghost"><ArrowLeft /></Button> : null}
        <span className="editor-breadcrumb"><FileText /><span className="editor-breadcrumb-current">{title}</span></span>
      </header>
      <div className="empty-note-content" data-status={error ? "error" : "loading"} role={error ? "alert" : "status"} aria-live="polite">
        <span className="empty-note-icon">{error ? <AlertTriangle /> : <LoaderCircle className="app-loading-spinner" />}</span>
        <h2>{error ? "正文没有加载成功" : "正在读取正文"}</h2>
        <p>{error ?? "正在从笔记库读取完整内容，请稍候。"}</p>
        {error && !loading ? <Button onClick={onRetry}><RefreshCw data-icon="inline-start" />重新读取</Button> : null}
      </div>
    </article>
  )
}

export function EmptyNoteEditor({
  backLabel = "全部笔记",
  canCreateNote,
  canRefresh = false,
  hasNotes,
  isLoading,
  missing = false,
  onBack,
  onOpenSettings,
  onRefresh,
  onSelectNote,
  suggestions = [],
}: {
  backLabel?: string
  canCreateNote: boolean
  canRefresh?: boolean
  hasNotes: boolean
  isLoading: boolean
  missing?: boolean
  onBack?: () => void
  onOpenSettings: () => void
  onRefresh?: () => void
  onSelectNote?: (note: Note) => void
  suggestions?: Note[]
}) {
  const suggestionsTitleId = useId()
  const title = missing ? "找不到这篇笔记" : isLoading ? "正在读取笔记" : hasNotes ? "选择一篇笔记" : canCreateNote ? "笔记库还是空的" : "连接或打开笔记库"
  const description = missing
    ? isLoading
      ? "正在重新连接笔记库并查找这篇文档，当前候选结果会继续保留。"
      : "这篇笔记可能已被删除、移动，或尚未同步到当前缓存。可以重新连接查找，或从候选结果继续。"
    : isLoading
      ? "正在检查远端内容和本机缓存，请稍候。"
    : hasNotes
      ? "从左侧列表选择一篇笔记，即可在这里阅读或编辑。"
      : canCreateNote
        ? "可以从左侧新建第一篇 Markdown 笔记。"
        : "连接坚果云或打开本地 Vault 后，即可读取真实 Markdown 文档。"

  return (
    <article className="note-editor empty-note-editor">
      {onBack ? (
        <header className="editor-titlebar">
          <Button aria-label={`返回${backLabel}`} onClick={onBack} size="icon" variant="ghost"><ArrowLeft /></Button>
          <span className="mobile-back-label">{backLabel}</span>
        </header>
      ) : null}
      <div className="empty-note-content" data-status={missing ? "error" : isLoading ? "loading" : hasNotes ? "idle" : "empty"}>
        <div className="empty-note-message" role={missing ? "alert" : isLoading ? "status" : undefined} aria-live={isLoading || missing ? "polite" : undefined}>
          <span className="empty-note-icon">{missing ? <AlertTriangle /> : isLoading ? <LoaderCircle className="app-loading-spinner" /> : hasNotes ? <FileText /> : <Cloud />}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {missing && suggestions.length > 0 && onSelectNote ? (
          <section aria-labelledby={suggestionsTitleId} className="missing-note-suggestions">
            <h3 id={suggestionsTitleId}>可能是这些笔记</h3>
            <div className="missing-note-suggestion-list">
              {suggestions.map((note) => (
                <button key={note.id} onClick={() => onSelectNote(note)} type="button">
                  <FileText />
                  <span><strong>{note.title}</strong><small>{note.folder || "根目录"}</small></span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {missing ? (
          <div className="missing-note-actions">
            {canRefresh && onRefresh ? (
              <Button disabled={isLoading} onClick={onRefresh}>
                {isLoading ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                {isLoading ? "正在查找" : "重新连接并查找"}
              </Button>
            ) : null}
            {onBack ? <Button onClick={onBack} variant="outline"><ArrowLeft data-icon="inline-start" />返回笔记列表</Button> : null}
          </div>
        ) : null}
        {!isLoading && !hasNotes && !canCreateNote ? <Button onClick={onOpenSettings}><Cloud data-icon="inline-start" />连接坚果云</Button> : null}
      </div>
    </article>
  )
}

type NoteListRowProps = {
  active: boolean
  contextActions?: NoteContextActions
  note: Note
  onLongPress?: (note: Note) => void
  onSelect: (note: Note) => void
}

// 列表是最容易掉帧的地方：编辑正文、切换选中都会刷新整个 notes 数组，
// 但真正变了的只有一两行。这里 memo 掉其余行，让每次输入只重渲染受影响的那几行。
const NoteListRow = memo(function NoteListRow({ active, contextActions, note, onLongPress, onSelect }: NoteListRowProps) {
  const handleLongPress = useMemo(
    () => onLongPress ? () => onLongPress(note) : undefined,
    [note, onLongPress],
  )
  const longPressProps = useLongPress(handleLongPress)
  const row = (
    <button
      className="note-list-row"
      data-active={active}
      onClick={() => onSelect(note)}
      type="button"
      {...longPressProps}
    >
      <div className="note-row-heading">
        <strong>{note.title || "未命名笔记"}</strong>
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
  // 移动端用长按弹操作面板，桌面端才把这一行接到右键菜单上。
  return contextActions ? <NoteRowContextMenu actions={contextActions} note={note}>{row}</NoteRowContextMenu> : row
})

type NoteEditorProps = {
  activeCacheId: string | null
  backLabel?: string
  onSelectFolder?: (folder: string) => void
  backlinks: Note[]
  canInsertAttachment: boolean
  canManageNote: boolean
  cloudConnected: boolean
  compact?: boolean
  isManagingNote: boolean
  moveTargets: VaultFolder[]
  note: Note
  noteViewMode: NoteViewMode
  onBack?: () => void
  onDeleteNote: () => void
  onExportNote: () => void
  onFormat: (syntax: string) => void
  onFormatNote: (noteId: string, syntax: string) => void
  onInsertAttachments: (files: File[]) => Promise<AttachmentWriteResult>
  onLoadWikiNote: (target: string) => void
  onOpenWikiLink: (target: string) => void
  onOpenSourceFile: () => void
  onMoveNote: (folderPath: string | null) => void
  onNoteViewModeChange: (mode: NoteViewMode) => void
  onRenameNote: (title: string) => void
  onReloadNote: () => void
  onResolveConflict: (strategy: "local" | "merge" | "remote") => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onResolveWikiNote: (target: string) => EmbeddedWikiNoteResult
  onRestoreNoteVersion: (content: string) => void
  onSelectNote: (note: Note) => void
  onSync: () => void
  onToggleTask?: (line: number, checked: boolean) => void
  onUpdateNote: (patch: Partial<Note>) => void
  saveState: NoteSaveState
  syncing: boolean
  wikiLinkNotes: Note[]
}

// 对位最多跟一秒：长笔记分帧铺完约需十几帧，懒加载的编辑器再慢也在这个范围内。
const ANCHOR_ALIGN_FRAMES = 60

// 输入停顿多久才认为正文稳定下来，可以做那些不必逐键跟进的全文计算。
const SETTLE_DELAY = 400

// 返回一份「打字停下来之后」的正文；换笔记时立刻跟上，免得菜单里短暂显示上一篇的内容。
function useSettledContent(noteId: string, content: string) {
  const [settled, setSettled] = useState({ content, noteId })
  if (settled.noteId !== noteId) setSettled({ content, noteId })
  const current = settled.noteId === noteId ? settled.content : content
  useEffect(() => {
    if (current === content) return
    const timer = window.setTimeout(() => setSettled({ content, noteId }), SETTLE_DELAY)
    return () => window.clearTimeout(timer)
  }, [content, current, noteId])
  return current
}

// 阅读态里把源码行对应的块顶到可视区顶端。预览元素按文档顺序排列，行号随之递增，
// 因此取最后一个不超过目标行的块即可，遇到更大的行号就可以收手。
function alignPreviewToSourceLine(viewport: HTMLElement, article: HTMLElement | null, line: number) {
  const elements = article?.querySelectorAll<HTMLElement>(".markdown-preview [data-source-line]")
  if (!elements?.length) return false
  let anchor: HTMLElement | null = null
  for (const element of elements) {
    const value = Number(element.dataset.sourceLine)
    if (!Number.isFinite(value)) continue
    if (value > line) break
    anchor = element
  }
  if (!anchor) return false
  const delta = anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  if (Math.abs(delta) >= 1) viewport.scrollTop += delta
  return true
}

// 搜索、切目录、展开侧栏统统与正文无关，但它们每一次都把编辑器整棵子树重画一遍
// （实测搜索敲 6 个字，编辑器白渲染 11 次）。上面已经把入参固定住，这里收口。
const NoteEditor = memo(function NoteEditor({ activeCacheId, backLabel = "全部笔记", backlinks, canInsertAttachment, canManageNote, cloudConnected, compact = false, isManagingNote, moveTargets, note, noteViewMode, onBack, onSelectFolder, onDeleteNote, onExportNote, onFormat, onFormatNote, onInsertAttachments, onLoadWikiNote, onMoveNote, onNoteViewModeChange, onOpenSourceFile, onOpenWikiLink, onReloadNote, onRenameNote, onResolveAsset, onResolveConflict, onResolveWikiNote, onRestoreNoteVersion, onSelectNote, onSync, onToggleTask, onUpdateNote, saveState, syncing, wikiLinkNotes }: NoteEditorProps) {
  const noteRenderIdentity = stableNoteRenderIdentity(note.id, note.remotePath)
  const assetScope = `${activeCacheId ?? "session"}:${noteRenderIdentity}`
  // 同步请求使用点击瞬间的正文快照；请求完成前锁定编辑，避免旧快照回写覆盖新输入。
  const isCanvas = note.format === "canvas"
  const isExcalidraw = isExcalidrawMarkdown(note.content)
  const isSpecialPreview = isCanvas || isExcalidraw
  const readOnly = isCanvas || (note.readOnly ?? note.source === "webdav") || saveState.status === "saving"
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const editorArticleRef = useRef<HTMLElement>(null)
  const dismissSelectionOriginRef = useRef<PointerOrigin | null>(null)
  const editorViewportRef = useRef<HTMLDivElement>(null)
  // 特殊画布始终使用专属预览；普通 Markdown 读取 App 级偏好，切换笔记或路由不会重置。
  const previewing = isSpecialPreview || noteViewMode === "preview"
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState(note.title)
  const [cursorPosition, setCursorPosition] = useState({ column: 1, line: 1 })
  const [hasSelection, setHasSelection] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [findReplacement, setFindReplacement] = useState("")
  const [findResult, setFindResult] = useState({ current: 0, total: 0 })
  const findInputRef = useRef<HTMLInputElement>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [insertingAttachment, setInsertingAttachment] = useState(false)
  const attachmentBusyRef = useRef(false)
  const currentNoteIdRef = useRef(note.id)
  currentNoteIdRef.current = note.id
  // 根目录笔记没有可跳转的目录段；标题单独作为末段，让沉浸画布也能看到当前打开的是哪张图。
  const folderSegments = note.folder ? getNoteBreadcrumbSegments(note.folder) : []
  // Canvas 正文是绘图 JSON，按字符计数没有意义，改用节点数量描述文档规模。
  const documentSize = useMemo(() => {
    if (!isCanvas) return `${note.content.length} 字符`
    try {
      const nodes = (JSON.parse(note.content) as { nodes?: unknown[] }).nodes
      return `${Array.isArray(nodes) ? nodes.length : 0} 个节点`
    } catch {
      return "无法解析的画布"
    }
  }, [isCanvas, note.content])
  // 大纲只在菜单里用，却跟着每一次按键把全文扫一遍：长笔记上这一遍要占掉近四成的按键开销。
  // 改成停顿下来再算，菜单是手动打开的，拿到的照样是最新内容。
  const outlineSource = useSettledContent(note.id, note.content)
  const noteOutline = useMemo(() => isSpecialPreview ? [] : extractNoteOutline(outlineSource), [isSpecialPreview, outlineSource])
  const editorScrollKey = `${activeCacheId ?? "session"}:${note.id}`

  // 切换阅读/编辑时用来对位：滚动过程中随手记下可视区顶端落在哪一源码行。
  // 用命中测试而不是遍历整篇，长笔记里滚动才不会为此多花时间。
  const anchorLineRef = useRef<number | null>(null)
  const previewingRef = useRef(previewing)
  previewingRef.current = previewing
  const readTopSourceLine = useCallback(() => {
    const viewport = editorViewportRef.current
    if (!viewport || viewport.clientHeight <= 0) return null
    const bounds = viewport.getBoundingClientRect()
    if (!previewingRef.current) return editorRef.current?.lineAtViewportTop(bounds.top) ?? null
    const x = bounds.left + bounds.width / 2
    // 顶端可能正落在两个块之间的空白上，往下多探两次再放弃。
    for (const offset of [2, 16, 36]) {
      const element = document.elementFromPoint(x, bounds.top + offset)
      const line = Number(element?.closest<HTMLElement>("[data-source-line]")?.dataset.sourceLine)
      if (Number.isFinite(line)) return line
    }
    return null
  }, [])
  // 换了笔记就丢掉上一篇的锚点，否则下一次切视图会按别的文档的行号对位。
  useEffect(() => { anchorLineRef.current = null }, [note.id])

  useLayoutEffect(() => {
    const viewport = editorViewportRef.current
    if (!viewport) return
    const target = noteEditorScrollMemory.get(editorScrollKey)
    let latestScrollTop = viewport.scrollTop
    let frame = 0
    let settlingFrame = 0
    let anchorFrame = 0
    const restore = () => {
      const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      viewport.scrollTop = Math.min(target, maximum)
      latestScrollTop = viewport.scrollTop
    }
    const rememberVisiblePosition = () => {
      // 断点切换会先用 CSS 隐藏旧布局，再卸载组件；隐藏阶段产生的 0 不能覆盖真实阅读位置。
      if (viewport.clientHeight <= 0) return
      latestScrollTop = viewport.scrollTop
      // 阅读与编辑两侧的排版高度不一样，切换视图时只有源码行才是共同的坐标。
      // 推迟一帧再问：编辑器要等自己的滚动处理跑完才会渲染新位置的行，
      // 在滚动事件里当场问，拿到的是按估算高度换算出来的旧位置。
      if (anchorFrame) return
      anchorFrame = window.requestAnimationFrame(() => {
        anchorFrame = 0
        const line = readTopSourceLine()
        if (line !== null) anchorLineRef.current = line
      })
    }
    viewport.addEventListener("scroll", rememberVisiblePosition, { passive: true })
    // 先在绘制前恢复，再等 Markdown/Suspense 完成本帧布局后校准，避免返回长笔记时先闪到顶部。
    restore()
    frame = window.requestAnimationFrame(() => {
      restore()
      settlingFrame = window.requestAnimationFrame(() => {
        restore()
        // 恢复到位后先记一次锚点：读者还没滚动就直接切视图时，另一侧也有位置可对。
        rememberVisiblePosition()
      })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(settlingFrame)
      window.cancelAnimationFrame(anchorFrame)
      viewport.removeEventListener("scroll", rememberVisiblePosition)
      noteEditorScrollMemory.set(editorScrollKey, latestScrollTop)
    }
  }, [editorScrollKey])

  // 切换视图不会重建滚动容器，像素偏移被原样带到另一侧；但同一段正文在两边的高度并不相同
  // （图片、表格在编辑态还是源码），沿用像素等于换个地方落地。这里按切换前记下的源码行重新对位。
  useEffect(() => {
    const line = anchorLineRef.current
    const viewport = editorViewportRef.current
    // 断点切换时两套布局会同时挂载，被 CSS 隐藏的那一份没有可视区，不参与对位。
    if (line === null || !viewport || viewport.clientHeight <= 0 || isSpecialPreview) return
    let frame = 0
    let attempts = 0
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      viewport.removeEventListener("wheel", stop)
      viewport.removeEventListener("touchstart", stop)
    }
    const align = () => {
      frame = 0
      attempts += 1
      const article = editorArticleRef.current
      // 阅读态是分帧铺开的、编辑器是懒加载的，目标位置要一直跟到内容就位为止。
      const ready = previewing ? !article?.querySelector(".markdown-preview-pending") : Boolean(editorRef.current)
      const applied = previewing
        ? alignPreviewToSourceLine(viewport, article, line)
        : editorRef.current?.scrollLineToTop(line) === true
      if ((ready && applied) || attempts >= ANCHOR_ALIGN_FRAMES) return stop()
      frame = window.requestAnimationFrame(align)
    }
    // 读者自己动手了就别再抢滚动条。
    viewport.addEventListener("wheel", stop, { passive: true })
    viewport.addEventListener("touchstart", stop, { passive: true })
    frame = window.requestAnimationFrame(align)
    return stop
  }, [isSpecialPreview, previewing])

  // Vault 笔记的标题对应文件名：编辑时先落草稿，失焦或回车再走统一的重命名链路，避免每次按键触发文件操作。
  const isVaultNote = note.source === "local" || note.source === "webdav"
  const [titleDraft, setTitleDraft] = useState(note.title)
  useEffect(() => { setTitleDraft(note.title) }, [note.id, note.title])

  const commitTitle = () => {
    const trimmed = titleDraft.trim()
    if (!isVaultNote) return
    if (!trimmed || trimmed === note.title) {
      setTitleDraft(note.title)
      return
    }
    onRenameNote(trimmed)
  }

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

  const saveStateLabel = getSaveStateLabel(cloudConnected, note, saveState)
  const getWikiLinkSuggestions = useCallback(() => wikiLinkNotes
    .filter((candidate) => candidate.pendingOperation !== "delete" && Boolean(candidate.remotePath))
    .map((candidate) => {
      const title = candidate.title || "未命名笔记"
      const target = candidate.remotePath!
      const href = noteRelativeHref(note, target)
      return { detail: target, markdown: buildMarkdownNoteLink(title, href), target, title }
    }), [note.remotePath, wikiLinkNotes])

  const runFind = useCallback((direction: "next" | "previous" = "next", fromStart = false) => {
    setFindResult(editorRef.current?.findText(findQuery, direction, fromStart) ?? { current: 0, total: 0 })
  }, [findQuery])

  useEffect(() => {
    setFindOpen(false)
    setFindQuery("")
    setFindReplacement("")
    setFindResult({ current: 0, total: 0 })
  }, [note.id])

  useEffect(() => {
    if (!findOpen) return
    const frame = window.requestAnimationFrame(() => findInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [findOpen, previewing])

  useEffect(() => {
    if (!findOpen) return
    // 查找栏挂在编辑器下沿，点回正文改内容是常事；Esc 只绑在查找框上的话，
    // 焦点一离开输入框就收不起来了，只能回去点关闭按钮。
    const closeOnEscape = (event: KeyboardEvent) => {
      // 弹窗自己要用 Esc 关闭，别把它的这一下抢过来。
      if (event.key !== "Escape" || hasOpenModal()) return
      setFindOpen(false)
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [findOpen])

  useEffect(() => {
    if (isSpecialPreview) return
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLocaleLowerCase() !== "f") return
      if (hasOpenModal()) return
      event.preventDefault()
      // 阅读状态下先切到编辑器再打开查找，确保选中结果可以滚动到可见区域。
      if (previewing) onNoteViewModeChange("edit")
      setFindOpen(true)
    }
    window.addEventListener("keydown", handleFindShortcut)
    return () => window.removeEventListener("keydown", handleFindShortcut)
  }, [isSpecialPreview, onNoteViewModeChange, previewing])

  useEffect(() => {
    // 画布有自己的全选语义（选中所有图形），不接管。
    if (isSpecialPreview) return
    const handleSelectAll = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLocaleLowerCase() !== "a") return
      // 输入框与可编辑正文的全选范围本来就是对的，只有焦点漂到正文之外时才需要接管。
      // 弹窗开着时更不能接管：焦点可能停在按钮上，此时去全选背后的笔记正文没有意义。
      if (isTextEntryElement(document.activeElement) || hasOpenModal()) return
      event.preventDefault()
      if (previewing) {
        selectElementContents(editorArticleRef.current?.querySelector(".markdown-preview") ?? null)
        return
      }
      editorRef.current?.selectAll()
    }
    document.addEventListener("keydown", handleSelectAll)
    return () => document.removeEventListener("keydown", handleSelectAll)
  }, [isSpecialPreview, previewing])

  const revealOutlineHeading = (heading: (typeof noteOutline)[number], index: number) => {
    setOutlineDialogOpen(false)
    if (!previewing) {
      editorRef.current?.revealLine(heading.line)
      return
    }
    const sameAnchorIndex = noteOutline.slice(0, index).filter((item) => item.anchor === heading.anchor).length
    const target = Array.from(editorArticleRef.current?.querySelectorAll<HTMLElement>(".markdown-preview [id]") ?? [])
      .filter((element) => element.id === heading.anchor)[sameAnchorIndex]
    target?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <article
      className="note-editor"
      data-compact={compact}
      data-excalidraw={isExcalidraw}
      data-view-mode={previewing ? "preview" : "edit"}
      onPointerDownCapture={compact ? (event) => {
        dismissSelectionOriginRef.current = { at: event.timeStamp, x: event.clientX, y: event.clientY }
      } : undefined}
      onPointerUpCapture={compact && hasSelection ? (event) => {
        const origin = dismissSelectionOriginRef.current
        dismissSelectionOriginRef.current = null
        if (!isSelectionDismissTap(origin, { at: event.timeStamp, x: event.clientX, y: event.clientY })) return
        if (keepsSelectionAlive(event.target as Element)) return
        editorRef.current?.collapseSelection()
      } : undefined}
      ref={editorArticleRef}
    >
      <header className="editor-titlebar">
        {onBack ? (
          <Button aria-label={`返回${backLabel}`} onClick={onBack} size="icon" variant="ghost"><ArrowLeft /></Button>
        ) : (
          <div className="editor-breadcrumb">
            <FileText />
            {folderSegments.map((segment, index) => (
              <span className="editor-breadcrumb-segment" key={`${segment}-${index}`}>
                {index > 0 ? <ChevronRight /> : null}
                <button
                  className="editor-breadcrumb-link"
                  onClick={() => onSelectFolder?.(folderSegments.slice(0, index + 1).join(" / "))}
                  type="button"
                >
                  {segment}
                </button>
              </span>
            ))}
            <span className="editor-breadcrumb-segment">
              {folderSegments.length > 0 ? <ChevronRight /> : null}
              <span className="editor-breadcrumb-current">{note.title || "未命名笔记"}</span>
            </span>
          </div>
        )}
        {onBack ? <span className="mobile-back-label">{backLabel}</span> : null}
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
          {!isSpecialPreview ? (
            <NoteViewModeSwitch mode={noteViewMode} onChange={onNoteViewModeChange} />
          ) : null}
          {!compact && !isSpecialPreview ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="文档大纲" size="icon-sm" variant="ghost"><ListTree /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="note-outline-menu">
                {noteOutline.length > 0 ? noteOutline.map((heading, index) => (
                  <DropdownMenuItem
                    className="note-outline-item"
                    key={`${heading.line}-${index}`}
                    onClick={() => revealOutlineHeading(heading, index)}
                    style={{ paddingLeft: `${8 + Math.max(0, heading.level - 1) * 12}px` }}
                  >
                    <span>{heading.text}</span>
                    <small>H{heading.level}</small>
                  </DropdownMenuItem>
                )) : <DropdownMenuItem disabled>当前笔记没有标题</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {!compact ? (
            <Button
              aria-label={note.starred ? "取消收藏" : "收藏"}
              onClick={() => onUpdateNote({ starred: !note.starred })}
              size="icon-sm"
              variant="ghost"
            >
              <Star className={note.starred ? "starred-icon" : ""} />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="更多操作" size="icon-sm" variant="ghost"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {compact && !isSpecialPreview ? (
                <DropdownMenuItem onClick={() => setOutlineDialogOpen(true)}>
                  <ListTree /> 文档大纲{noteOutline.length > 0 ? `（${noteOutline.length}）` : ""}
                </DropdownMenuItem>
              ) : null}
              {compact ? (
                <DropdownMenuItem onClick={() => onUpdateNote({ starred: !note.starred })}>
                  <Star className={note.starred ? "starred-icon" : ""} /> {note.starred ? "取消收藏" : "收藏笔记"}
                </DropdownMenuItem>
              ) : null}
              {compact ? <DropdownMenuSeparator /> : null}
              {note.remotePath && !note.pendingOperation ? (
                <DropdownMenuItem
                  disabled={saveState.status === "saving"}
                  onClick={onReloadNote}
                >
                  重新加载源文件
                </DropdownMenuItem>
              ) : null}
              {note.remotePath && isExcalidrawMarkdown(note.content) ? (
                <DropdownMenuItem onClick={onOpenSourceFile}>打开 / 下载 Excalidraw 原始文件</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={onExportNote}>导出 Markdown 文件</DropdownMenuItem>
              <DropdownMenuItem disabled={!activeCacheId} onClick={() => setHistoryDialogOpen(true)}>
                <History /> 本地版本历史
              </DropdownMenuItem>
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
            <span>{note.mergeConflictCount
              ? `合并稿仍有 ${note.mergeConflictCount} 处重叠修改；编辑标记后可保留本地版本。`
              : "本地修改仍然安全保留，可先尝试合并两台设备的修改。"}</span>
          </div>
          <Button onClick={() => onResolveConflict("merge")} size="sm">合并修改</Button>
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

      {findOpen && !previewing && !isSpecialPreview ? (
        <div className="editor-find-bar" role="search">
          <div className="editor-find-field">
            <Search />
            <input
              aria-label="查找当前笔记"
              onChange={(event) => {
                const query = event.target.value
                setFindQuery(query)
                window.requestAnimationFrame(() => {
                  setFindResult(editorRef.current?.findText(query, "next", true) ?? { current: 0, total: 0 })
                })
              }}
              onKeyDown={(event) => {
                // Esc 由查找栏统一接管，输入框这里只管翻匹配项。
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                event.preventDefault()
                runFind(event.shiftKey ? "previous" : "next")
              }}
              placeholder="查找"
              ref={findInputRef}
              value={findQuery}
            />
            <span aria-live="polite">{findQuery ? `${findResult.current}/${findResult.total}` : "0/0"}</span>
          </div>
          <button aria-label="上一个匹配项" disabled={!findResult.total} onClick={() => runFind("previous")} type="button"><ChevronUp /></button>
          <button aria-label="下一个匹配项" disabled={!findResult.total} onClick={() => runFind("next")} type="button"><ChevronDown /></button>
          {!readOnly ? (
            <>
              <input
                aria-label="替换为"
                className="editor-replace-input"
                onChange={(event) => setFindReplacement(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  setFindResult(editorRef.current?.replaceCurrent(findQuery, findReplacement) ?? { current: 0, total: 0 })
                }}
                placeholder="替换为"
                value={findReplacement}
              />
              <button disabled={!findResult.total} onClick={() => setFindResult(editorRef.current?.replaceCurrent(findQuery, findReplacement) ?? { current: 0, total: 0 })} type="button">替换</button>
              <button
                disabled={!findResult.total}
                onClick={() => {
                  editorRef.current?.replaceAll(findQuery, findReplacement)
                  setFindResult({ current: 0, total: 0 })
                }}
                type="button"
              >全部</button>
            </>
          ) : null}
          <button aria-label="关闭查找" onClick={() => setFindOpen(false)} type="button"><X /></button>
        </div>
      ) : null}

      {attachmentError ? (
        <p className="attachment-error" role="alert">{attachmentError}</p>
      ) : null}

      {isExcalidraw ? (
        <div className="excalidraw-workspace">
          <Suspense fallback={<EditorLoadingState label="Excalidraw 画布" />}>
            <MarkdownPreview
              assetScope={assetScope}
              content={note.content}
              editable={!readOnly}
              immersive
              noteId={note.id}
              onContentChange={(content) => onUpdateNote({
                content,
                preview: buildNotePreview(content, note.format),
              })}
              onLoadWikiNote={onLoadWikiNote}
              onResolveAsset={onResolveAsset}
              onResolveWikiNote={onResolveWikiNote}
              onWikiLink={onOpenWikiLink}
            />
          </Suspense>
        </div>
      ) : <ScrollArea className="editor-scroll" viewportRef={editorViewportRef}>
        <div className="document-canvas">
          {previewing || note.readOnly === true ? (
            <h1 className="document-title document-title-readonly">{note.title || "未命名笔记"}</h1>
          ) : (
            <input
              aria-label="笔记标题"
              className="document-title"
              onBlur={commitTitle}
              onChange={(event) => {
                if (isVaultNote) {
                  setTitleDraft(event.target.value)
                  return
                }
                onUpdateNote({ title: event.target.value })
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== "Escape") return
                event.preventDefault()
                if (event.key === "Escape") setTitleDraft(note.title)
                ;(event.target as HTMLInputElement).blur()
              }}
              placeholder="输入标题"
              value={isVaultNote ? titleDraft : note.title}
            />
          )}
          <div className="document-meta">
            <span>{note.updatedAt === "刚刚" ? "刚刚编辑" : note.updatedAt}</span>
            <span>·</span>
            <span>{documentSize}</span>
            <span>·</span>
            <span>{deriveFolder(note)}</span>
            {!previewing && !readOnly ? (
              <span aria-live="polite" className="note-edit-mode-status" data-status={saveState.status} role="status">
                <PencilLine />
                <strong>编辑中</strong>
                <span>· {saveStateLabel}</span>
              </span>
            ) : null}
          </div>
          {isCanvas ? (
            <Suspense fallback={<EditorLoadingState label="Canvas 画布" />}>
              <CanvasPreview key={note.id} content={note.content} onResolveAsset={onResolveAsset} onWikiLink={onOpenWikiLink} />
            </Suspense>
          ) : previewing ? (
            <Suspense fallback={<EditorLoadingState label="Markdown 预览" />}>
              <MarkdownPreview
                assetScope={assetScope}
                content={note.content}
                editable={!readOnly}
                key={noteRenderIdentity}
                onLoadWikiNote={onLoadWikiNote}
                onResolveAsset={onResolveAsset}
                onResolveWikiNote={onResolveWikiNote}
                onToggleTask={readOnly ? undefined : onToggleTask}
                onWikiLink={onOpenWikiLink}
              />
            </Suspense>
          ) : (
            <div className="markdown-editor-shell">
              <Suspense fallback={<EditorLoadingState label="Markdown 编辑器" />}>
                {/* CodeMirror 会在提交后同步受控 value；按笔记重建实例，避免切换瞬间残留上一份正文。 */}
                <MarkdownEditor
                  compact={compact}
                  getWikiLinkSuggestions={getWikiLinkSuggestions}
                  key={noteRenderIdentity}
                  onChange={(content) => onUpdateNote({
                    content,
                    preview: buildNotePreview(content, note.format),
                  })}
                  onCursorChange={(line, column) => setCursorPosition({ column, line })}
                  onInsertFiles={canInsertAttachment && !insertingAttachment ? handleInsertFiles : undefined}
                  onOpenWikiLink={onOpenWikiLink}
                  onResolveAsset={onResolveAsset}
                  onSelectionChange={setHasSelection}
                  readOnly={readOnly}
                  ref={editorRef}
                  storageKey={note.id}
                  value={note.content}
                />
              </Suspense>
            </div>
          )}
          <BacklinksPanel backlinks={backlinks} onSelectNote={onSelectNote} />
        </div>
      </ScrollArea>}

      {/* 只读笔记同样要能复制，操作条不跟着格式工具栏一起被 readOnly 关掉，只是收起改写类按钮。 */}
      {compact && !previewing && hasSelection ? (
        <SelectionActionBar editorRef={editorRef} readOnly={readOnly} />
      ) : null}
      {compact && !previewing && !readOnly ? (
        <FormattingToolbar
          attachmentBusy={insertingAttachment}
          canInsertAttachment={canInsertAttachment}
          editorRef={editorRef}
          mobile
          onFormat={handleFormat}
          onInsertFiles={handleInsertFiles}
        />
      ) : !compact && !isExcalidraw ? (
        <footer className="editor-statusbar">
          <span>{documentSize}</span>
          <span>{isCanvas ? "Canvas" : "Markdown"}</span>
          {/* 预览与 Canvas 都没有可编辑光标，此时展示行列位置只会误导。 */}
          {!isCanvas && !previewing ? (
            <span className="ml-auto">行 {cursorPosition.line}，列 {cursorPosition.column}</span>
          ) : null}
        </footer>
      ) : null}
      <NoteVersionHistoryDialog
        cacheId={activeCacheId}
        currentContent={note.content}
        noteId={note.id}
        onOpenChange={setHistoryDialogOpen}
        onRestore={onRestoreNoteVersion}
        open={historyDialogOpen}
      />
      <Dialog onOpenChange={setOutlineDialogOpen} open={outlineDialogOpen}>
        <DialogContent className="mobile-outline-dialog">
          <DialogHeader>
            <DialogTitle>文档大纲</DialogTitle>
            <DialogDescription>选择标题后跳转到对应位置。</DialogDescription>
          </DialogHeader>
          <div className="mobile-outline-list">
            {noteOutline.length > 0 ? noteOutline.map((heading, index) => (
              <button
                key={`${heading.line}-${index}`}
                onClick={() => revealOutlineHeading(heading, index)}
                style={{ paddingLeft: `${14 + Math.max(0, heading.level - 1) * 14}px` }}
                type="button"
              >
                <span>{heading.text}</span>
                <small>H{heading.level}</small>
              </button>
            )) : <p>当前笔记没有标题。</p>}
          </div>
        </DialogContent>
      </Dialog>
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
})

function EditorLoadingState({ label }: { label: string }) {
  return (
    <div className="editor-loading" role="status" aria-live="polite">
      <LoaderCircle className="app-loading-spinner" />
      <span>
        <strong>正在加载{label}</strong>
        <small>笔记内容已保留，组件准备完成后会自动显示。</small>
      </span>
    </div>
  )
}

function ImportMarkdownButton({ disabled, onImport }: { disabled: boolean; onImport: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label="导入 Markdown" disabled={disabled} onClick={() => inputRef.current?.click()} size="icon" variant="ghost">
            <FileUp />
          </Button>
        </TooltipTrigger>
        <TooltipContent>导入 Markdown 到当前目录</TooltipContent>
      </Tooltip>
      <input
        accept=".md,text/markdown"
        className="attachment-file-input"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ""
          if (files.length > 0) onImport(files)
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
    </>
  )
}

function MobileWorkspace(props: WorkspaceProps & FolderTreeProps) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  // 使用与实际可见结果一致的延迟搜索键，避免输入态先更新时覆盖原列表滚动位置。
  const listRouteKey = `${props.libraryView}\u0000${props.selectedFolder ?? "__all__"}`
  const listStateKey = `${listRouteKey}\u0000${props.mobileListStateKey}`
  const libraryStateKey = `${props.totalNoteCount}\u0000${props.folders.map((folder) => folder.path).join("\u0000")}`
  // 返回按钮会回到来源列表，文案必须跟着来源变化，否则从目录进入时会谎称回到「全部笔记」。
  const backLabel = getMobileBackLabel(props.libraryView, props.selectedFolder)
  // 手势已经把页面跟着手指送到位，交接路由后不能再补一段入场动画，否则会二次位移。
  // 相位在同一批更新里就回到 idle，光看 edgeSwipe.active 判断不出这次导航来自手势。
  const swipeNavigationRef = useRef(false)
  const handleEdgeSwipe = useCallback(() => {
    const isRootNoteList = props.mobileScreen === "notes"
      && (!props.selectedFolder || props.selectedFolder === "根目录")
    if (props.mobileScreen === "library" || isRootNoteList) {
      setNavigationOpen(true)
      return
    }
    if (props.mobileScreen === "editor") {
      swipeNavigationRef.current = true
      props.onMobileScreenChange("notes")
      return
    }
    if (props.mobileScreen !== "notes") return
    const parentFolder = props.selectedFolder ? getParentFolderPath(props.selectedFolder) : null
    if (parentFolder) props.onSelectFolder(parentFolder)
    else {
      swipeNavigationRef.current = true
      props.onMobileScreenChange("library")
    }
  }, [props.mobileScreen, props.onMobileScreenChange, props.onSelectFolder, props.selectedFolder])
  const isRootSwipe = props.mobileScreen === "library"
    || (props.mobileScreen === "notes" && (!props.selectedFolder || props.selectedFolder === "根目录"))
  const edgeSwipe = useEdgeSwipeAction(handleEdgeSwipe, !navigationOpen, isRootSwipe ? "drawer" : "back")
  // 侧滑返回是跟手的，点击进入却是硬切，同一个层级切换会给出两种观感。
  // 这里给点击路径补一段方向一致的入场动画；手势自己已经把页面送到位，就不再叠加。
  // 用 Web Animations API 而不是 CSS class：连续两次同方向切换时，属性值不变的 CSS 动画不会重播。
  const currentPageRef = useRef<HTMLDivElement | null>(null)
  const screenAnimationRef = useRef<Animation | null>(null)
  const previousScreenRef = useRef(props.mobileScreen)
  useEffect(() => {
    const previous = previousScreenRef.current
    if (previous === props.mobileScreen) return
    previousScreenRef.current = props.mobileScreen
    const bySwipe = swipeNavigationRef.current
    swipeNavigationRef.current = false
    const element = currentPageRef.current
    if (!element || bySwipe) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const forward = MOBILE_SCREEN_DEPTH[props.mobileScreen] > MOBILE_SCREEN_DEPTH[previous]
    // 连点两级时上一段还没播完，不取消的话两个 transform 会叠在同一个元素上。
    screenAnimationRef.current?.cancel()
    screenAnimationRef.current = element.animate(
      [
        { opacity: forward ? 0.45 : 0.55, transform: `translate3d(${forward ? "15%" : "-9%"},0,0)` },
        { opacity: 1, transform: "translate3d(0,0,0)" },
      ],
      { duration: forward ? 210 : 195, easing: "cubic-bezier(.22,.8,.25,1)" },
    )
  }, [props.mobileScreen])

  useEffect(() => () => screenAnimationRef.current?.cancel(), [])
  const previousFolder = props.mobileScreen === "notes" && props.selectedFolder
    ? getParentFolderPath(props.selectedFolder)
    : null
  const previousFolderNotes = useMemo(() => previousFolder
    ? sortNotes(props.allNotes.filter((note) => noteBelongsDirectlyToFolder(note, previousFolder)), props.noteSort)
    : [], [previousFolder, props.allNotes, props.noteSort])

  // 底层与当前层用同一个数组渲染，页面身份进 key。
  // 侧滑交接时两层互换角色，key 不变的那个页面会被 React 复用；分成两棵子树写的话，
  // 底层那份笔记列表会连同虚拟列表一起卸载、当前层再挂载一份一模一样的，
  // 返回时「整页刷新一下」正是这次重建。
  const previousLayer: MobileScreenLayer | null = edgeSwipe.kind === "back"
    ? props.mobileScreen === "editor"
      ? {
          key: `notes:${listRouteKey}`,
          node: (
            <MobileNoteList
              {...props}
              initialScrollTop={mobileNoteListScrollMemory.get(listStateKey)}
              navigationOpen={false}
              onNavigationOpenChange={() => undefined}
              onScrollPositionChange={() => undefined}
            />
          ),
        }
      : previousFolder
        ? {
            key: `notes:${props.libraryView}\u0000${previousFolder}`,
            node: (
              <MobileNoteList
                {...props}
                includeNestedFolderNotes={false}
                initialScrollTop={mobileNoteListScrollMemory.get(`${props.libraryView}\u0000${previousFolder}\u0000`)}
                navigationOpen={false}
                notes={previousFolderNotes}
                onNavigationOpenChange={() => undefined}
                onScrollPositionChange={() => undefined}
                query=""
                selectedFolder={previousFolder}
                selectedTag={null}
              />
            ),
          }
        : {
            key: "library",
            node: (
              <MobileLibrary
                {...props}
                initialScrollTop={mobileLibraryScrollMemory.get(libraryStateKey)}
                navigationOpen={false}
                onNavigationOpenChange={() => undefined}
                onScrollPositionChange={() => undefined}
              />
            ),
          }
    : null

  const currentLayer: MobileScreenLayer = {
    key: props.mobileScreen === "library"
      ? "library"
      : props.mobileScreen === "notes"
        ? `notes:${listRouteKey}`
        : `editor:${props.activeNote?.id ?? "__empty__"}`,
    node: props.mobileScreen === "library" ? (
        <MobileLibrary
          {...props}
          initialScrollTop={mobileLibraryScrollMemory.get(libraryStateKey)}
          navigationOpen={navigationOpen}
          onNavigationOpenChange={setNavigationOpen}
          onScrollPositionChange={(scrollTop) => mobileLibraryScrollMemory.set(libraryStateKey, scrollTop)}
        />
      ) : props.mobileScreen === "notes" ? (
        <MobileNoteList
          {...props}
          initialScrollTop={mobileNoteListScrollMemory.get(listStateKey)}
          navigationOpen={navigationOpen}
          onNavigationOpenChange={setNavigationOpen}
          onScrollPositionChange={(scrollTop) => mobileNoteListScrollMemory.set(listStateKey, scrollTop)}
        />
      ) : (
        props.activeNote ? props.activeNoteLoading || props.activeNoteLoadError ? (
          <NoteDocumentState
            backLabel={backLabel}
            error={props.activeNoteLoadError}
            loading={props.activeNoteLoading}
            onBack={() => props.onMobileScreenChange("notes")}
            onRetry={props.onRetryNoteLoad}
            title={props.activeNote.title}
          />
        ) : (
          <NoteEditor
            activeCacheId={props.activeCacheId}
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
            wikiLinkNotes={props.allNotes}
            noteViewMode={props.noteViewMode}
            backLabel={backLabel}
            onSelectFolder={props.onSelectFolder}
            onBack={() => props.onMobileScreenChange("notes")}
            onDeleteNote={props.onDeleteNote}
            onExportNote={props.onExportNote}
            onFormat={props.onFormat}
            onFormatNote={props.onFormatNote}
            onInsertAttachments={props.onInsertAttachments}
            onLoadWikiNote={props.onLoadWikiNote}
            onOpenWikiLink={props.onOpenWikiLink}
            onOpenSourceFile={props.onOpenSourceFile}
            onMoveNote={props.onMoveNote}
            onNoteViewModeChange={props.onNoteViewModeChange}
            onRenameNote={props.onRenameNote}
            onReloadNote={props.onReloadNote}
            onResolveAsset={props.onResolveAsset}
            onResolveConflict={props.onResolveConflict}
            onResolveWikiNote={props.onResolveWikiNote}
            onRestoreNoteVersion={props.onRestoreNoteVersion}
            onSelectNote={props.onSelectNote}
            onSync={props.onRefreshVault}
            onToggleTask={props.onToggleNoteTask
              ? (line, checked) => {
                  const noteId = props.activeNote?.id
                  if (noteId) props.onToggleNoteTask?.(noteId, line, checked)
                }
              : undefined}
            onUpdateNote={props.onUpdateNote}
            saveState={props.saveState}
            syncing={props.isRefreshingVault}
          />
        ) : <EmptyNoteEditor backLabel={backLabel} canCreateNote={props.canCreateNote} canRefresh={Boolean(props.activeCacheId)} hasNotes={props.totalNoteCount > 0} isLoading={props.isRefreshingVault} missing={props.missingNoteRoute} onBack={() => props.onMobileScreenChange("notes")} onOpenSettings={props.onOpenSettings} onRefresh={props.onRefreshVault} onSelectNote={props.onSelectNote} suggestions={props.missingNoteSuggestions} />
      ),
  }

  return (
    <div className="mobile-workspace" data-screen={props.mobileScreen} {...edgeSwipe.bind}>
      {(previousLayer ? [
        { ...previousLayer, role: "previous" as const },
        { ...currentLayer, role: "current" as const },
      ] : [{ ...currentLayer, role: "current" as const }]).map((layer) => (
        <div
          aria-hidden={layer.role === "previous" || undefined}
          className={`mobile-edge-swipe-${layer.role}`}
          inert={layer.role === "previous" || undefined}
          key={layer.key}
          ref={layer.role === "current" ? currentPageRef : undefined}
        >
          {layer.node}
        </div>
      ))}
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
              <strong>{note.title || "未命名笔记"}</strong>
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

function NoteViewModeSwitch({ mode, onChange }: { mode: NoteViewMode; onChange: (mode: NoteViewMode) => void }) {
  const options: Array<{ icon: typeof Eye; label: string; mode: NoteViewMode }> = [
    { icon: Eye, label: "阅读", mode: "preview" },
    { icon: PencilLine, label: "编辑", mode: "edit" },
  ]

  return (
    <div aria-label="笔记显示模式" className="note-view-mode-switch" role="group">
      {options.map((option) => {
        const Icon = option.icon
        const active = mode === option.mode
        return (
          <Tooltip key={option.mode}>
            <TooltipTrigger asChild>
              <Button
                aria-label={`${option.label}模式`}
                aria-pressed={active}
                className="note-view-mode-button"
                data-mode={option.mode}
                onClick={() => onChange(option.mode)}
                size="sm"
                variant="ghost"
              >
                <Icon />
                <span>{option.label}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{active ? `当前为${option.label}模式` : `切换到${option.label}模式（⌘/Ctrl+E）`}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function getSaveStateLabel(cloudConnected: boolean, note: Note, state: NoteSaveState) {
  return state.status === "saving"
    ? note.source === "webdav" ? "正在同步" : "正在保存"
    : state.status === "pending"
      ? "待同步"
      : state.status === "conflict"
        ? "同步冲突"
        : state.status === "error"
          ? note.source === "webdav" ? "同步失败" : "保存失败"
          : state.status === "readonly"
            // Canvas 是按格式只读，正文其实已经完整缓存；只有真正没读到正文才提示未缓存。
            ? note.format === "canvas"
              ? "只读画布"
              : note.source === "webdav" && !note.contentLoaded ? "正文未缓存" : "只读"
            : note.source === "webdav" ? cloudConnected ? "已同步" : "仅本机缓存" : "已保存"
}

function SaveStateIndicator({ cloudConnected, note, state }: { cloudConnected: boolean; note: Note; state: NoteSaveState }) {
  const label = getSaveStateLabel(cloudConnected, note, state)
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
        <span
          aria-label={state.message ?? label}
          aria-live="polite"
          className="saved-state"
          data-status={state.status}
          role="status"
        >
          <Icon className={state.status === "saving" ? "animate-spin" : ""} />
          <span>{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{state.message ?? label}</TooltipContent>
    </Tooltip>
  )
}

type MobileLibraryProps = WorkspaceProps & FolderTreeProps & {
  initialScrollTop: number
  navigationOpen: boolean
  onNavigationOpenChange: (open: boolean) => void
  onScrollPositionChange: (scrollTop: number) => void
}

function MobileLibrary(props: MobileLibraryProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [managingFolders, setManagingFolders] = useState(false)
  const [actionFolder, setActionFolder] = useState<VaultFolder | null>(null)
  const folderOrderKey = props.activeCacheId ?? `library:${props.connectionLabel}`
  const [folderOrder, setFolderOrder] = useState<string[]>(() => loadFolderOrder(folderOrderKey))
  const rootFolders = useMemo(
    () => getDirectChildVaultFolders(props.folders, null),
    [props.folders],
  )
  const orderedRootFolders = useMemo(
    () => {
      const systemRoot = rootFolders.find((folder) => folder.path === "根目录")
      const regularFolders = applyFolderOrder(
        rootFolders.filter((folder) => folder.path !== "根目录"),
        folderOrder,
      )
      return systemRoot ? [systemRoot, ...regularFolders] : regularFolders
    },
    [folderOrder, rootFolders],
  )
  const folderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    setFolderOrder(loadFolderOrder(folderOrderKey))
  }, [folderOrderKey])

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
  const handleFolderDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const paths = orderedRootFolders
      .filter((folder) => folder.path !== "根目录")
      .map((folder) => folder.path)
    const previousIndex = paths.indexOf(String(active.id))
    const nextIndex = paths.indexOf(String(over.id))
    if (previousIndex < 0 || nextIndex < 0) return
    const nextOrder = arrayMove(paths, previousIndex, nextIndex)
    setFolderOrder(nextOrder)
    saveFolderOrder(folderOrderKey, nextOrder)
  }

  return (
    <section className="mobile-screen mobile-library">
      <header className="mobile-library-header">
        <MobileNavigationDrawer
          activeSection="notes"
          connected={props.connected}
          connectionLabel={props.connectionLabel}
          isRefreshingVault={props.isRefreshingVault}
          mobileConnectionLabel={props.mobileConnectionLabel}
          open={props.navigationOpen}
          noteCount={props.totalNoteCount}
          starredNoteCount={props.starredNoteCount}
          onNavigate={props.onNavigate}
          onOpenChange={props.onNavigationOpenChange}
          onRefreshVault={props.onRefreshVault}
          onSelectLibraryView={(view) => {
            rememberPosition()
            props.onSelectLibraryView(view)
          }}
        />
        <h1>笔记库</h1>
        <div className="mobile-library-header-actions">
          <ImportMarkdownButton disabled={!props.canCreateNote || props.isCreatingNote} onImport={props.onImportNotes} />
          <Button
            aria-label={props.connected ? "同步当前笔记库" : "重新连接并更新"}
            disabled={props.isRefreshingVault}
            onClick={props.onRefreshVault}
            size="icon"
            variant="ghost"
          >
            {props.isRefreshingVault ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          </Button>
          <Button aria-label="搜索笔记" onClick={() => searchRef.current?.focus()} size="icon" variant="ghost"><Search /></Button>
        </div>
      </header>
      <ScrollArea className="mobile-scroll-content" viewportRef={viewportRef}>
        <div className="mobile-page-padding">
          <div className="mobile-search-row">
            <MobileNoteSearch
              inputRef={searchRef}
              onClear={() => props.onQueryChange("")}
              onSearch={(query) => {
                props.onSelectLibraryView("all")
                // 菜单切换默认会清理旧搜索；根目录主动搜索要在导航后写入本次新关键词。
                props.onQueryChange(query)
              }}
              placeholder="搜索笔记、标签、内容"
              value={props.query}
            />
          </div>
          {props.vaultError ? <p className="vault-error">{props.vaultError}</p> : null}

          <div className="mobile-section-heading">
            <Button
              aria-label={managingFolders ? "完成文件夹管理" : "管理文件夹"}
              aria-pressed={managingFolders}
              className="mobile-folder-manage"
              disabled={!props.folderManagementMode}
              onClick={() => setManagingFolders((value) => !value)}
              size="icon"
              variant="ghost"
            >
              {managingFolders ? <Check /> : <FolderCog />}
            </Button>
            <span>{managingFolders ? "拖动排序" : "文件夹"}</span>
            <CreateFolderButton
              disabled={!props.canCreateFolder || props.isManagingNote}
              onCreate={(name) => props.onCreateFolder(name, null)}
              parentFolder={null}
            />
          </div>
          <div className="mobile-folder-list">
            <DndContext collisionDetection={closestCenter} onDragEnd={handleFolderDragEnd} sensors={folderSensors}>
              <SortableContext items={orderedRootFolders.filter((folder) => folder.path !== "根目录").map((folder) => folder.path)} strategy={verticalListSortingStrategy}>
                {orderedRootFolders.map((folder) => managingFolders && folder.path === "根目录" ? (
                  <MobileLibraryRow
                    count={folder.count}
                    icon={Folder}
                    key={folder.path}
                    label={folder.label}
                    trailing={<span aria-label="系统目录，不可编辑" className="mobile-system-folder"><LockKeyhole /></span>}
                  />
                ) : managingFolders && props.folderManagementMode ? (
                  <SortableMobileFolderRow
                    disabled={props.isManagingNote}
                    folder={folder}
                    key={folder.path}
                    mode={props.folderManagementMode}
                    onDelete={props.onDeleteFolder}
                    onRename={props.onRenameFolder}
                  />
                ) : (
                  <MobileLibraryRow
                    count={folder.count}
                    icon={Folder}
                    key={folder.path}
                    label={folder.label}
                    onLongPress={folder.path === "根目录" || !props.folderManagementMode ? undefined : () => setActionFolder(folder)}
                    onClick={() => selectFolder(folder.path)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      </ScrollArea>
      <MobileFolderActionSheet
        disabled={props.isManagingNote}
        folder={actionFolder}
        mode={props.folderManagementMode}
        onClose={() => setActionFolder(null)}
        onDelete={props.onDeleteFolder}
        onOpen={(folderPath) => { setActionFolder(null); selectFolder(folderPath) }}
        onRename={props.onRenameFolder}
      />
      {props.canCreateNote && !managingFolders ? (
        <Button
          aria-label="在根目录新建笔记"
          className="mobile-fab"
          disabled={props.isCreatingNote}
          onClick={() => { rememberPosition(); props.onCreateNote() }}
          size="icon-lg"
          title="新建到：根目录"
        >
          {props.isCreatingNote ? <LoaderCircle className="animate-spin" /> : <Plus />}
        </Button>
      ) : null}
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
  onLongPress?: () => void
  onToggle?: () => void
  trailing?: ReactNode
}

function MobileLibraryRow({ count, depth = 0, expanded, folderTree = false, icon: Icon, label, onClick, onLongPress, onToggle, trailing }: MobileLibraryRowProps) {
  const longPressProps = useLongPress(onLongPress)
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
            <ChevronRight />
          </button>
        ) : <span className="mobile-folder-toggle-placeholder" />
      ) : null}
      <button className="mobile-library-row-main" onClick={onClick} type="button" {...longPressProps}>
        <Icon />
        <span>{label}</span>
        {typeof count === "number" ? <small>{count}</small> : null}
        {folderTree || trailing ? null : <ChevronRight className="mobile-row-navigation" />}
      </button>
      {trailing ? <div className="mobile-library-row-action">{trailing}</div> : null}
    </div>
  )
}

function SortableMobileFolderRow({
  disabled,
  folder,
  mode,
  onDelete,
  onRename,
}: {
  disabled: boolean
  folder: VaultFolder
  mode: "local" | "webdav"
  onDelete: (folderPath: string) => void
  onRename: (folderPath: string, nextName: string) => void
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ disabled, id: folder.path })
  const style: CSSProperties = {
    transform: DndCss.Transform.toString(transform),
    transition,
  }

  return (
    <div
      className="mobile-folder-sortable"
      data-dragging={isDragging}
      ref={setNodeRef}
      style={style}
    >
      <MobileLibraryRow
        count={folder.count}
        icon={Folder}
        label={folder.label}
        trailing={(
          <div className="mobile-folder-edit-actions">
            <MobileFolderActions
              disabled={disabled}
              folderPath={folder.path}
              mode={mode}
              onDelete={onDelete}
              onRename={onRename}
            />
            <button
              aria-label={`拖动排序 ${folder.label}`}
              className="mobile-folder-drag-handle"
              disabled={disabled}
              type="button"
              {...attributes}
              {...listeners}
            >
              <GripVertical />
            </button>
          </div>
        )}
      />
    </div>
  )
}

function MobileFolderActions({
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
  const [dialogMode, setDialogMode] = useState<"delete" | "rename" | null>(null)
  const [name, setName] = useState(currentName)

  const openRename = () => {
    setName(currentName)
    setDialogMode("rename")
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={`更多文件夹操作 ${currentName}`} disabled={disabled} size="icon-sm" variant="ghost">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="mobile-folder-actions-menu">
          <DropdownMenuItem onSelect={openRename}><PencilLine />重命名</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="mobile-folder-delete-action" onSelect={() => setDialogMode("delete")}><Trash2 />删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={(open) => { if (!open) setDialogMode(null) }} open={dialogMode !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode === "delete" ? `删除“${currentName}”` : "重命名文件夹"}</DialogTitle>
            <DialogDescription>
              {dialogMode === "delete"
                ? mode === "local"
                  ? "文件夹及其中的全部文件会移动到 Swell Note 回收站，可在保留期内恢复。"
                  : "该目录中的笔记将进入待同步删除；同步前仍可从回收站恢复。"
                : mode === "local"
                  ? "将重命名本地 Vault 目录，并同步更新当前笔记索引。"
                  : "目录和子目录中的笔记会先在本机排队，点击同步后才移动坚果云文件。"}
            </DialogDescription>
          </DialogHeader>
          {dialogMode === "rename" ? (
            <Input autoFocus aria-label="新文件夹名称" onChange={(event) => setName(event.target.value)} value={name} />
          ) : null}
          <DialogFooter>
            <Button onClick={() => setDialogMode(null)} variant="ghost">取消</Button>
            {dialogMode === "delete" ? (
              <Button onClick={() => { setDialogMode(null); onDelete(folderPath) }} variant="destructive">
                {mode === "local" ? "移入回收站" : "确认移入待删除"}
              </Button>
            ) : (
              <Button disabled={!name.trim() || name.trim() === currentName} onClick={() => { setDialogMode(null); onRename(folderPath, name) }}>
                保存
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type MobileNoteListProps = WorkspaceProps & {
  initialScrollTop: number
  navigationOpen: boolean
  onNavigationOpenChange: (open: boolean) => void
  onScrollPositionChange: (scrollTop: number) => void
}

function MobileNoteList(props: MobileNoteListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportReady, setViewportReady] = useState(false)
  const [actionFolder, setActionFolder] = useState<VaultFolder | null>(null)
  const [actionNote, setActionNote] = useState<Note | null>(null)
  const setViewportRef = useCallback((viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport
    // 直达二级目录时，缓存和列表会在同一轮恢复。等滚动容器挂载后再创建 virtualizer，
    // 避免它首次读取到 null 后不再测量，表现为“有笔记但列表空白”。
    if (viewport) setViewportReady(true)
  }, [])
  const childFolders = useMemo(
    () => props.selectedFolder ? getDirectChildVaultFolders(props.folders, props.selectedFolder) : [],
    [props.folders, props.selectedFolder],
  )
  const folderSegments = props.selectedFolder?.split(/\s*\/\s*/).filter(Boolean) ?? []
  const folderPaths = folderSegments.map((_, index) => folderSegments.slice(0, index + 1).join(" / "))
  const parentFolder = props.selectedFolder ? getParentFolderPath(props.selectedFolder) : null
  const title = folderSegments[folderSegments.length - 1]
    ?? (props.libraryView === "recent" ? "最近更新" : props.libraryView === "starred" ? "收藏" : "全部笔记")

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    let attempts = 0
    // 虚拟列表需要等缓存和目录行完成测量；在可滚动高度就绪前不把目标位置错误收敛为 0。
    const restoreWhenReady = () => {
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (props.initialScrollTop <= 0 || maxScrollTop > 0) {
        viewport.scrollTop = Math.min(props.initialScrollTop, maxScrollTop)
      }
      attempts += 1
      // Virtualizer 可能在首轮测量后主动归零，因此短暂跨帧保持目标值，直到布局稳定。
      if (attempts < 12) {
        frame = window.requestAnimationFrame(restoreWhenReady)
      }
    }
    restoreWhenReady()
    return () => window.cancelAnimationFrame(frame)
  }, [childFolders.length, props.initialScrollTop, props.notes.length])

  const selectNote = (note: Note) => {
    props.onScrollPositionChange(viewportRef.current?.scrollTop ?? 0)
    props.onSelectNote(note)
  }

  const selectFolder = (folder: string) => {
    props.onScrollPositionChange(viewportRef.current?.scrollTop ?? 0)
    props.onSelectFolder(folder)
  }

  const goBack = () => {
    props.onScrollPositionChange(viewportRef.current?.scrollTop ?? 0)
    if (parentFolder) {
      props.onSelectFolder(parentFolder)
      return
    }
    props.onMobileScreenChange("library")
  }

  return (
    <section className="mobile-screen">
      <header className="mobile-titlebar">
        <Button aria-label={parentFolder ? `返回${parentFolder}` : "返回笔记库"} onClick={goBack} size="icon" variant="ghost"><ArrowLeft /></Button>
        <h1>{title}</h1>
        <div className="mobile-titlebar-actions">
          {props.selectedFolder && props.folderManagementMode ? <FolderRenameButton disabled={props.isManagingNote} folderPath={props.selectedFolder} mode={props.folderManagementMode} onDelete={props.onDeleteFolder} onRename={props.onRenameFolder} /> : null}
          {childFolders.length > 0 ? <NestedNotesToggle includeNested={props.includeNestedFolderNotes} onChange={props.onIncludeNestedFolderNotesChange} /> : null}
          <TagFilterMenu availableTags={props.availableTags} onChange={props.onSelectTag} selectedTag={props.selectedTag} />
          <NoteSortMenu mobile onChange={props.onNoteSortChange} sort={props.noteSort} />
        </div>
        <MobileNavigationDrawer
          activeSection="notes"
          connected={props.connected}
          connectionLabel={props.connectionLabel}
          isRefreshingVault={props.isRefreshingVault}
          mobileConnectionLabel={props.mobileConnectionLabel}
          open={props.navigationOpen}
          noteCount={props.totalNoteCount}
          onNavigate={props.onNavigate}
          onOpenChange={props.onNavigationOpenChange}
          onRefreshVault={props.onRefreshVault}
          onSelectLibraryView={props.onSelectLibraryView}
          starredNoteCount={props.starredNoteCount}
        />
      </header>
      {props.selectedFolder ? (
        <nav aria-label="目录路径" className="mobile-folder-breadcrumbs">
          <button onClick={() => props.onMobileScreenChange("library")} type="button">笔记库</button>
          {folderPaths.map((path, index) => (
            <span key={path}>
              <ChevronRight />
              <button
                aria-current={index === folderPaths.length - 1 ? "page" : undefined}
                disabled={index === folderPaths.length - 1}
                onClick={() => selectFolder(path)}
                type="button"
              >
                {folderSegments[index]}
              </button>
            </span>
          ))}
        </nav>
      ) : null}
      <div className="mobile-list-search">
        <MobileNoteSearch onSearch={props.onQueryChange} placeholder="搜索笔记" value={props.query} />
      </div>
      <ScrollArea
        className="mobile-scroll-content"
        viewportRef={setViewportRef}
      >
        <div className="mobile-note-groups">
          {viewportReady && (props.notes.length > 0 || childFolders.length > 0) ? (
            <VirtualNoteRows
              activeNoteId={props.activeNoteId}
              folders={childFolders}
              initialScrollOffset={props.initialScrollTop}
              mobile
              noteSort={props.noteSort}
              notes={props.notes}
              onFolderLongPress={props.folderManagementMode ? setActionFolder : undefined}
              onNoteLongPress={setActionNote}
              onSelectFolder={selectFolder}
              onSelectNote={selectNote}
              viewportRef={viewportRef}
            />
          ) : viewportReady ? <EmptyNoteList canCreateNote={props.canCreateNote} isLoading={props.isRefreshingVault} onCreateNote={props.onCreateNote} onOpenSettings={props.onOpenSettings} selectedFolder={props.selectedFolder} /> : null}
        </div>
      </ScrollArea>
      <MobileFolderActionSheet
        disabled={props.isManagingNote}
        folder={actionFolder}
        mode={props.folderManagementMode}
        onClose={() => setActionFolder(null)}
        onDelete={props.onDeleteFolder}
        onOpen={(folderPath) => { setActionFolder(null); selectFolder(folderPath) }}
        onRename={props.onRenameFolder}
      />
      <MobileNoteActionSheet
        disabled={props.isManagingNote}
        folders={props.folders}
        note={actionNote}
        onClose={() => setActionNote(null)}
        onDelete={props.onDeleteNoteById}
        onMove={props.onMoveNoteById}
        onOpen={(note) => { setActionNote(null); selectNote(note) }}
        onRename={props.onRenameNoteById}
      />
      {props.canCreateNote ? <Button aria-label={props.selectedFolder ? `在${props.selectedFolder}中新建笔记` : "在根目录新建笔记"} className="mobile-fab" disabled={props.isCreatingNote} onClick={props.onCreateNote} size="icon-lg" title={props.selectedFolder ? `新建到：${props.selectedFolder}` : "新建到：根目录"}>{props.isCreatingNote ? <LoaderCircle className="animate-spin" /> : <Plus />}</Button> : null}
    </section>
  )
}

export function MobileNavigationDrawer({
  activeSection,
  connected = false,
  connectionLabel = "笔记库",
  isRefreshingVault = false,
  mobileConnectionLabel = connected ? "已连接" : "离线缓存",
  noteCount,
  onNavigate,
  onOpenChange,
  onRefreshVault,
  onSelectLibraryView,
  open: controlledOpen,
  starredNoteCount,
}: {
  activeSection: AppSection
  connected?: boolean
  connectionLabel?: string
  isRefreshingVault?: boolean
  mobileConnectionLabel?: string
  noteCount?: number
  onNavigate: (path: string) => void
  onOpenChange?: (open: boolean) => void
  onRefreshVault?: () => void
  onSelectLibraryView?: (view: LibraryView) => void
  open?: boolean
  starredNoteCount?: number
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [controlledOpen, onOpenChange])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [open])

  const navigate = (path: string) => {
    setOpen(false)
    onNavigate(path)
  }
  const selectView = (view: LibraryView, path: string) => {
    setOpen(false)
    if (onSelectLibraryView) onSelectLibraryView(view)
    else onNavigate(path)
  }

  return (
    <>
      <Button aria-expanded={open} aria-label="打开主导航" className="mobile-drawer-trigger" onClick={() => setOpen(true)} size="icon" variant="ghost"><Menu /></Button>
      {open ? (
        <div className="mobile-drawer-layer">
          <button aria-label="关闭主导航" className="mobile-drawer-backdrop" onClick={() => setOpen(false)} type="button" />
          <aside aria-label="主导航" aria-modal="true" className="mobile-navigation-drawer" role="dialog">
            <header className="mobile-drawer-brand">
              <img alt="" src={swellNoteLogo} />
              <strong>Swell Note</strong>
              <Button aria-label="关闭主导航" onClick={() => setOpen(false)} size="icon" variant="ghost"><X /></Button>
            </header>
            <button className="mobile-drawer-source" onClick={() => navigate("/settings/cache")} type="button">
              <span className="sync-summary-dot" data-connected={connected} />
              <span><strong>{connectionLabel}</strong><small>{mobileConnectionLabel}</small></span>
              <ChevronRight />
            </button>
            <nav className="mobile-drawer-nav" aria-label="笔记快捷入口">
              <button onClick={() => selectView("all", "/notes")} type="button"><FileText /><span>全部笔记</span>{typeof noteCount === "number" ? <small>{noteCount}</small> : null}<ChevronRight /></button>
              <button onClick={() => selectView("recent", "/notes/view/recent")} type="button"><CheckCircle2 /><span>最近更新</span>{typeof noteCount === "number" ? <small>{Math.min(noteCount, 32)}</small> : null}<ChevronRight /></button>
              <button onClick={() => selectView("starred", "/notes/view/starred")} type="button"><Star /><span>收藏</span>{typeof starredNoteCount === "number" ? <small>{starredNoteCount}</small> : null}<ChevronRight /></button>
            </nav>
            <div className="mobile-drawer-divider" />
            <nav className="mobile-drawer-nav mobile-drawer-sections" aria-label="应用导航">
              <button data-active={activeSection === "notes"} onClick={() => navigate("/notes")} type="button"><FileText /><span>笔记</span></button>
              <button data-active={activeSection === "todos"} onClick={() => navigate("/todos")} type="button"><CheckCircle2 /><span>待办</span></button>
              <button data-active={activeSection === "settings"} onClick={() => navigate("/settings")} type="button"><Settings /><span>设置</span></button>
            </nav>
            <div className="mobile-drawer-footer">
              <span>{connected ? "云端已连接" : "正在使用本机缓存"}</span>
              {onRefreshVault ? (
                <Button aria-label="同步笔记库" disabled={isRefreshingVault} onClick={onRefreshVault} size="icon" variant="ghost">
                  {isRefreshingVault ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                </Button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  )
}

type VirtualNoteItem =
  | { key: string; kind: "heading"; label: string; noteCount: number }
  | { key: string; kind: "folder"; folder: VaultFolder }
  | { key: string; kind: "note"; note: Note }

function VirtualNoteRows({
  activeNoteId,
  folderContextActions,
  folders = [],
  initialScrollOffset = 0,
  mobile = false,
  noteContextActions,
  noteSort,
  notes,
  onFolderLongPress,
  onNoteLongPress,
  onSelectFolder,
  onSelectNote,
  viewportRef,
}: {
  activeNoteId: string
  folderContextActions?: FolderContextActions
  folders?: VaultFolder[]
  initialScrollOffset?: number
  mobile?: boolean
  noteContextActions?: NoteContextActions
  noteSort: NoteSort
  notes: Note[]
  onFolderLongPress?: (folder: VaultFolder) => void
  onNoteLongPress?: (note: Note) => void
  onSelectFolder?: (folder: string) => void
  onSelectNote: (note: Note) => void
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  // 分组按本地日历日划分；把当天序号纳入依赖，跨零点后的首次渲染就会重算，
  // 否则挂夜的窗口会一直把昨天的笔记显示在「今天」下面。
  const todayIndex = getLocalDayIndex(Date.now())
  const items = useMemo(() => [
    ...(folders.length > 0 ? [
      { key: "heading:folders", kind: "heading" as const, label: "子文件夹", noteCount: folders.length },
      ...folders.map((folder): VirtualNoteItem => ({ key: `folder:${folder.path}`, kind: "folder", folder })),
    ] : []),
    ...groupNotesByDate(notes, noteSort).flatMap((group): VirtualNoteItem[] => [
      ...(group.label ? [{
        key: `heading:${group.key}`,
        kind: "heading" as const,
        label: group.label,
        noteCount: group.notes.length,
      }] : []),
      ...group.notes.map((note): VirtualNoteItem => ({ key: note.id, kind: "note", note })),
    ]),
  ], [folders, noteSort, notes, todayIndex])
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => items[index]?.kind === "heading"
      ? 35
      : items[index]?.kind === "folder" ? mobile ? 58 : 56 : mobile ? 96 : 104,
    getItemKey: (index) => items[index]?.key ?? index,
    getScrollElement: () => viewportRef.current,
    // 挂载首帧就把渲染窗口摆到恢复位置；否则先按顶部渲染、滚动恢复再逐帧追上来，
    // 侧滑返回交接与返回键回列表时都会看到列表从顶部闪跳回中段。
    initialOffset: () => initialScrollOffset,
    overscan: 8,
  })

  return (
    <div className="virtual-note-list" style={{ height: `${virtualizer.getTotalSize()}px` }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const item = items[virtualRow.index]
        if (!item) return null
        return (
          <div
            className="virtual-note-row"
            data-index={virtualRow.index}
            key={item.key}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {item.kind === "heading" ? (
              <div className="note-group-label"><span>{item.label}</span>{mobile ? null : <small>{item.noteCount}</small>}</div>
            ) : item.kind === "folder" ? (
              <FolderListRow contextActions={folderContextActions} folder={item.folder} mobile={mobile} onLongPress={onFolderLongPress} onSelect={onSelectFolder} />
            ) : (
              <NoteListRow active={item.note.id === activeNoteId} contextActions={noteContextActions} note={item.note} onLongPress={onNoteLongPress} onSelect={onSelectNote} />
            )}
          </div>
        )
      })}
    </div>
  )
}

const FolderListRow = memo(function FolderListRow({
  contextActions,
  folder,
  mobile,
  onLongPress,
  onSelect,
}: {
  contextActions?: FolderContextActions
  folder: VaultFolder
  mobile: boolean
  onLongPress?: (folder: VaultFolder) => void
  onSelect?: (folder: string) => void
}) {
  const handleLongPress = useMemo(
    () => onLongPress ? () => onLongPress(folder) : undefined,
    [folder, onLongPress],
  )
  const longPressProps = useLongPress(handleLongPress)
  const row = (
    <button
      className="folder-list-row"
      data-mobile={mobile}
      onClick={() => onSelect?.(folder.path)}
      type="button"
      {...longPressProps}
    >
      <span className="folder-list-icon"><Folder /></span>
      <span>
        <strong>{folder.label}</strong>
        <small>{folder.count} 篇笔记 · 含子目录</small>
      </span>
      <ChevronRight />
    </button>
  )
  return contextActions ? <FolderRowContextMenu actions={contextActions} folder={folder}>{row}</FolderRowContextMenu> : row
})

function getMobileBackLabel(libraryView: LibraryView, selectedFolder: string | null) {
  if (selectedFolder) {
    const segments = getNoteBreadcrumbSegments(selectedFolder)
    return segments[segments.length - 1] ?? "全部笔记"
  }
  return libraryView === "recent" ? "最近更新" : libraryView === "starred" ? "收藏" : "全部笔记"
}

function deriveFolder(note: Note) {
  if (note.folder) return note.folder
  if (!note.remotePath) return "产品规划 / 跨端产品"
  const segments = note.remotePath.split("/").filter(Boolean)
  return segments.slice(0, -1).join(" / ") || "坚果云"
}

function noteRelativeHref(activeNote: Note, targetPath: string) {
  if (activeNote.remotePath) {
    const relative = buildRelativeMarkdownHref(activeNote.remotePath, targetPath)
    if (relative) return relative
  }
  return targetPath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")
}
