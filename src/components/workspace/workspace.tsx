import { useLocation, useNavigate, useNavigationType } from "react-router-dom"
import { createContext, useContext, memo, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS as DndCss } from "@dnd-kit/utilities"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowLeft,
  ArrowUpDown,
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
  Globe,
  GripVertical,
  ListTree,
  ListFilter,
  Link2,
  LockKeyhole,
  LoaderCircle,
  MoreHorizontal,
  Menu,
  PencilLine,
  Pin,
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
import { RouteActivityProvider } from "@/components/ui/route-activity"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { useOptionalStableCallback, useStableCallback } from "@/lib/use-stable-callback"
import type { AttachmentQueue, AttachmentQueueSlotInput } from "@/services/vault/attachment-queue"
import { attachmentEditorKey } from "@/services/vault/attachment-target"
import { AttachmentQueuePanel, useAttachmentQueue } from "@/components/workspace/attachment-queue-panel"
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
  noteBelongsToFolder,
  type VaultFolder,
} from "@/services/search/vault-folders"
import { buildNotePreview } from "@/services/markdown/note-preview"
import { normalizeNoteTarget } from "@/services/search/note-index"
import { openExternalUrl } from "@/services/open-external-url"
import { HighlightedText, useSearchMatch } from "@/components/workspace/note-search-match"
import { countWords, estimateReadingMinutes } from "@/services/markdown/note-stats"
import { extractNoteOutline } from "@/services/markdown/note-outline"
import { buildMarkdownNoteLink, buildRelativeMarkdownHref } from "@/services/markdown/markdown-link"
import { getLocalDayIndex, groupNotesByDate } from "@/services/search/note-groups"
import { sortNotes, type NoteSort } from "@/services/search/note-sort"
import { noteMatchesLibraryQuery } from "@/services/search/note-list-filter"
import { getNoteViewModeAction, loadUiPreferences, saveUiPreferences, type MarkdownSourceMode, type NoteViewMode } from "@/services/preferences/ui-preferences"
import { SYSTEM_ROOT_FOLDER_PATH } from "@/services/preferences/folder-order-preferences"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"
import type { EditorFormatState } from "@/components/editor/markdown-input"
import { FormattingToolbar } from "@/components/workspace/formatting-toolbar"
import { NoteVersionHistoryDialog } from "@/components/workspace/note-version-history-dialog"
import { GlobalSearchDialog } from "@/components/workspace/global-search-dialog"
import type { VaultCacheSummary } from "@/services/cache/vault-cache"
import { getNoteBreadcrumbSegments } from "@/lib/note-routes"
import { resolveRouteNoteId, stableNoteRenderIdentity } from "@/lib/note-route-resolution"
import { MobileNoteSearch } from "@/components/workspace/mobile-note-search"
import { MobileFolderActionSheet, MobileNoteActionSheet } from "@/components/workspace/mobile-action-sheets"
import { MobileLinkSheet, type LinkSheetState } from "@/components/workspace/mobile-link-sheet"
import { SelectionActionBar } from "@/components/workspace/selection-action-bar"
import { DocumentContextMenu } from "@/components/workspace/document-context-menu"
import { PreviewSearch } from "@/components/workspace/preview-search"
import { isSelectionDismissTap, keepsSelectionAlive, type PointerOrigin } from "@/components/workspace/selection-dismiss"
import { registerDesktopShortcuts, hasOpenModal, isTextEntryElement, selectElementContents } from "@/components/workspace/shortcut-scope"
import {
  ContextMenuRequestDialog,
  NoteListContextMenu,
  FolderRowContextMenu,
  NoteRowContextMenu,
  type ContextMenuRequest,
  type FolderContextActions,
  type NoteContextActions,
} from "@/components/workspace/context-menus"
import { useLongPress } from "@/components/workspace/use-long-press"
import { useEdgeSwipeAction } from "@/components/workspace/use-edge-swipe-action"
import { SyncActivityToast } from "@/components/workspace/sync-activity-toast"
import { useMobileLayoutQuery } from "@/services/navigation/mobile-layout"
import { mobileLibraryScrollMemory, mobileNoteListScrollMemory, noteEditorScrollMemory } from "@/services/navigation/mobile-scroll-memory"
import { createMobileRouteEntry, createMobileRouteStack, updateMobileRouteStack, type MobileNavigationAction, type MobileRouteEntry, type MobileRouteStack } from "@/services/navigation/mobile-route-stack"
import type { SyncProgress } from "@/services/sync/sync-progress"
import { shouldShowFloatingSyncProgress } from "@/services/sync/sync-progress"
import { FolderSortDndContext } from "./folder-sort-dnd"
import { SyncFailureToast } from "./sync-failure-toast"

// CodeMirror 体积较大，延迟到编辑区真正渲染时再加载，避免拖慢首屏资料库与列表。
// 实际预取时机在应用启动阶段（见 preload-note-renderers.ts）：等 Workspace 挂载再预取
// 已经太晚——cacheReady 一变 true，笔记多半已经激活，编辑器和 Workspace 在同一帧里就都要用到。
const MarkdownEditor = lazyWithRetry(() => import("@/components/editor/markdown-editor"))
const MarkdownPreview = lazyWithRetry(() => import("@/components/editor/markdown-preview"))
const CanvasPreview = lazyWithRetry(() => import("@/components/editor/canvas-preview"))

export type MobileScreen = "library" | "notes" | "editor"

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
  // 目录排序偏好的库身份：拖动提交校验发起库，切库时卸载进行中的拖动上下文。
  folderOrderKey: string
  includeNestedFolderNotes: boolean
  isOpeningVault: boolean
  isCreatingNote: boolean
  canInsertAttachment: boolean
  isManagingNote: boolean
  // 没有任何目录上下文时中间列表显示空态引导。它与 `selectedFolder === null` 不同：
  // `/notes` 若恢复出了上次打开的笔记，selectedFolder 同样是 null，但那时应跟随笔记的目录。
  hasNoFolderSelection: boolean
  isNoteDetailRoute: boolean
  missingNoteRoute: boolean
  missingNoteSuggestions: Note[]
  isRefreshingVault: boolean
  libraryView: LibraryView
  loadingNoteIds: ReadonlySet<string>
  localVaultSupported: boolean
  mobileRouteResetKey: string
  mobileScreen: MobileScreen
  mobileConnectionLabel: string
  mobileCanGoBack: boolean
  mobileListStateKey: string
  nativeSearchPaths: ReadonlySet<string> | null
  nativeSearchQuery: string
  noteViewMode: NoteViewMode
  noteSort: NoteSort
  markdownSourceMode: MarkdownSourceMode
  noteLoadErrors: Readonly<Record<string, string>>
  notes: Note[]
  onCreateNote: () => void
  onCreateNoteInFolder: (folderPath: string) => void
  onCreateFolder: (name: string, parentFolder: string | null) => void
  onFormat: (syntax: string) => void
  onFormatNote: (noteId: string, syntax: string) => void
  /**
   * 附件写入队列。队列实例常驻在 App，编辑区只往里排队。
   * 放在编辑区外面是因为编辑区会随切笔记、切阅读态、窄屏路由卸载——
   * 队列状态跟着组件走，写了一半的批次就会在卸载时凭空消失。
   */
  attachmentQueue: AttachmentQueue
  onIncludeNestedFolderNotesChange: (include: boolean) => void
  onImportNotes: (files: File[]) => void
  onBrowseAllNotes: () => void
  onMobileBack: (fallback: string, canGoBack: boolean) => boolean | Promise<boolean>
  onMobileScreenChange: (screen: MobileScreen) => void
  onMarkdownSourceModeChange: (mode: MarkdownSourceMode) => void
  onNoteViewModeChange: (mode: NoteViewMode) => void
  onDeleteNote: () => void
  onDeleteNoteById: (noteId: string) => void
  onDeleteFolder: (folderPath: string) => void
  onExportNote: () => void
  onFolderOrderChange: (paths: string[]) => void
  onOpenLocalVault: () => void
  onOpenMobileLibrary: () => void
  onLoadWikiNote: (target: string) => void
  onOpenWikiLink: (target: string) => void
  onOpenSourceFile: () => void
  onMoveNote: (folderPath: string | null) => void
  onMoveNoteById: (noteId: string, folderPath: string | null) => void
  onRenameFolder: (folderPath: string, nextName: string) => void
  onRenameNote: (title: string) => void
  onRenameNoteById: (noteId: string, title: string) => void
  onRenameNoteFromEditor: (noteId: string, title: string) => void
  onOpenSettings: () => void
  onNavigate: (path: string) => void
  onQueryChange: (query: string) => void
  onNoteSortChange: (sort: NoteSort) => void
  onReloadNote: () => void
  onRevealSearchResult: (note: Note) => void
  onRetryNoteLoad: () => void
  onRefreshVault: () => void
  onResolveConflict: (strategy: "local" | "merge" | "remote") => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onResolveAssetForNote: (noteId: string, source: string) => Promise<VaultAsset | null>
  onResolveWikiNote: (target: string) => EmbeddedWikiNoteResult
  onRestoreNoteVersion: (content: string) => Promise<void>
  onToggleNoteStar: (noteId: string) => void
  onToggleNotePin: (noteId: string) => void
  onToggleNoteTask?: (noteId: string, line: number, checked: boolean) => void
  onSelectFolder: (folder: string | null) => void
  onSelectLibraryView: (view: LibraryView) => void
  onSelectNote: (note: Note) => void
  onSelectTag: (tag: string | null) => void
  onSelectVaultCache: (cacheId: string) => void
  onUpdateNote: (patch: Partial<Note>) => void
  onUpdateNoteById: (noteId: string, patch: Partial<Note>) => void
  query: string
  saveState: NoteSaveState
  saveStates: Readonly<Record<string, NoteSaveState>>
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

type SearchNavigation = { noteId: string; query: string }
type SearchRevealRequest = { noteId: string; requestId: number }
const SearchNavigationContext = createContext<{ request: SearchNavigation | null; consume: () => void }>({ request: null, consume: () => {} })

export function handleNoteViewModeShortcut(event: KeyboardEvent, currentMode: NoteViewMode, onChange: (mode: NoteViewMode) => void) {
  // 组合输入期间切成只读会截断候选词；进入锁定前主动失焦，同时提交标题草稿并关闭手机键盘。
  if (event.isComposing || event.keyCode === 229) return
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return
  if (event.key.toLocaleLowerCase() !== "e" || hasOpenModal()) return
  event.preventDefault()
  const nextMode = getNoteViewModeAction(currentMode).nextMode
  if (nextMode === "locked" && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  onChange(nextMode)
}

export function resolveWriteProtected(fileReadOnly: boolean, source: Note["source"], saveStatus: NoteSaveState["status"]) {
  // 本地 saving 是后台自动写盘，仍可继续输入；WebDAV saving 是显式同步，期间保留快照写保护。
  return fileReadOnly || (source === "webdav" && saveStatus === "saving")
}

export function resolveEditorReadOnly(fileReadOnly: boolean, source: Note["source"], viewMode: NoteViewMode, saveStatus: NoteSaveState["status"]) {
  return resolveWriteProtected(fileReadOnly, source, saveStatus) || viewMode === "locked"
}

export function Workspace(props: WorkspaceProps) {
  const [searchRequest, setSearchRequest] = useState<SearchNavigation | null>(null)
  const [searchRevealRequest, setSearchRevealRequest] = useState<SearchRevealRequest | null>(null)
  const searchRevealSequence = useRef(0)
  const consumeSearchRequest = useCallback(() => setSearchRequest(null), [])
  const searchNavigation = useMemo(() => ({ request: searchRequest, consume: consumeSearchRequest }), [searchRequest, consumeSearchRequest])
  const mobileLayout = useMobileWorkspaceLayout()
  const showSyncProgressToast = shouldShowFloatingSyncProgress(props.syncProgress, mobileLayout)
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<Set<string>>(() => new Set())
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const openGlobalSearch = useCallback(() => setGlobalSearchOpen(true), [])
  const activeNoteUsesSpecialPreview = Boolean(
    props.activeNote
    && (props.activeNote.format === "canvas" || isExcalidrawMarkdown(props.activeNote.content)),
  )

  useEffect(() => {
    if (!props.activeNote || activeNoteUsesSpecialPreview) return
    const toggleViewMode = (event: KeyboardEvent) => {
      handleNoteViewModeShortcut(event, props.noteViewMode, props.onNoteViewModeChange)
    }
    // 桌面与移动布局会同时挂载，快捷键统一放在 Workspace，避免两个编辑器各触发一次相互抵消。
    document.addEventListener("keydown", toggleViewMode)
    return () => document.removeEventListener("keydown", toggleViewMode)
  }, [activeNoteUsesSpecialPreview, props.activeNote?.id, props.noteViewMode, props.onNoteViewModeChange])

  useEffect(() => {
    return registerDesktopShortcuts({
      canCreateNote: props.canCreateNote,
      isCreatingNote: props.isCreatingNote,
      isRefreshingVault: props.isRefreshingVault,
      onCreateNote: props.onCreateNote,
      onRefreshVault: props.onRefreshVault,
      onOpenSearch: openGlobalSearch,
    })
  }, [openGlobalSearch, props.canCreateNote, props.isCreatingNote, props.isRefreshingVault, props.onCreateNote, props.onRefreshVault])

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
    <SearchNavigationContext.Provider value={searchNavigation}>
    <main className="workspace-root">
      {mobileLayout ? (
        <RouteStackMobileWorkspace
          {...props}
          expandedFolderPaths={expandedFolderPaths}
          onOpenGlobalSearch={openGlobalSearch}
          onToggleFolder={toggleFolder}
          searchRevealRequest={searchRevealRequest}
          visibleFolders={visibleFolders}
        />
      ) : (
        <DesktopWorkspace
          {...props}
          expandedFolderPaths={expandedFolderPaths}
          onOpenGlobalSearch={openGlobalSearch}
          onToggleFolder={toggleFolder}
          searchRevealRequest={searchRevealRequest}
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
      <GlobalSearchDialog
        cacheId={props.activeCacheId}
        notes={props.allNotes}
        onOpenChange={setGlobalSearchOpen}
        onSelectNote={(note, query) => {
          // 请求带目标笔记标识，等正文异步加载完成后再消费，避免高亮落在上一篇。
          setSearchRequest(query ? { noteId: note.id, query } : null)
          setSearchRevealRequest({ noteId: note.id, requestId: ++searchRevealSequence.current })
          // 搜索使用专用的一次导航：上游同步目录/筛选/返回路径，本地请求负责展开与滚动。
          props.onRevealSearchResult(note)
        }}
        open={globalSearchOpen}
        placement={mobileLayout ? "bottom" : "center"}
      />
    </main>
    </SearchNavigationContext.Provider>
  )
}

function useMobileWorkspaceLayout() {
  // 只挂载当前断点的工作区，避免隐藏布局继续解析 Markdown、创建编辑器和读取图片。
  return useMobileLayoutQuery()
}

type FolderTreeProps = {
  expandedFolderPaths: ReadonlySet<string>
  onOpenGlobalSearch: () => void
  onToggleFolder: (folderPath: string) => void
  searchRevealRequest: SearchRevealRequest | null
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
  const toggleNotePin = useStableCallback(props.onToggleNotePin)
  const createNoteInFolder = useStableCallback(props.onCreateNoteInFolder)
  // 编辑器面板与搜索、目录树毫无关系，却因为回调每次重建而跟着整屏重渲染。
  // 这一组把它的入参全部固定下来，memo 才拦得住。
  const deleteNote = useStableCallback(props.onDeleteNote)
  const exportNote = useStableCallback(props.onExportNote)
  const formatNote = useStableCallback(props.onFormat)
  const formatNoteById = useStableCallback(props.onFormatNote)
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
    onTogglePin: toggleNotePin,
  }), [contextActionsDisabled, moveNoteById, props.folders, selectNote, toggleNotePin, toggleNoteStar])
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
        folderOrderKey={props.folderOrderKey}
        folders={props.visibleFolders}
        libraryView={props.libraryView}
        noteCount={props.totalNoteCount}
        starredNoteCount={props.starredNoteCount}
        onCreateNote={createNote}
        onCreateFolder={createFolder}
        onFolderOrderChange={props.onFolderOrderChange}
        onImportNotes={importNotes}
        onOpenLocalVault={openLocalVault}
        onOpenSettings={openSettings}
        onRefreshVault={refreshVault}
        onSelectFolder={selectFolder}
        onToggleFolder={toggleFolder}
        onSelectLibraryView={selectLibraryView}
        onSelectVaultCache={selectVaultCache}
        searchRevealRequest={props.searchRevealRequest}
        selectedFolder={props.selectedFolder}
        isManagingFolder={props.isManagingNote}
        isOpeningVault={props.isOpeningVault}
        isCreatingNote={props.isCreatingNote}
        isRefreshingVault={props.isRefreshingVault}
        hasNoFolderSelection={props.hasNoFolderSelection}
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
        folderLabel={getLibraryLabel(props.libraryView, props.selectedFolder)}
        folderManagementMode={props.folderManagementMode}
        noSelection={props.hasNoFolderSelection}
        onBrowseAllNotes={props.onBrowseAllNotes}
        onOpenGlobalSearch={props.onOpenGlobalSearch}
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
        searchRevealRequest={props.searchRevealRequest}
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
          markdownSourceMode={props.markdownSourceMode}
          moveTargets={props.folders}
          note={props.activeNote}
          // 补全候选取整库而不是当前筛选结果：搜索时列表被裁短，链接候选不该跟着一起消失。
          wikiLinkNotes={props.allNotes}
          noteViewMode={props.noteViewMode}
          onDeleteNote={deleteNote}
          onExportNote={exportNote}
          onFormat={formatNote}
          onFormatNote={formatNoteById}
          attachmentQueue={props.attachmentQueue}
          onLoadWikiNote={loadWikiNote}
          onOpenWikiLink={openWikiLink}
          onOpenSourceFile={openSourceFile}
          onMoveNote={moveNote}
          onMarkdownSourceModeChange={props.onMarkdownSourceModeChange}
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
      ) : <EmptyNoteEditor canCreateNote={props.canCreateNote} canRefresh={Boolean(props.activeCacheId)} hasNotes={props.totalNoteCount > 0} isLoading={props.isRefreshingVault} missing={props.missingNoteRoute} onBack={props.missingNoteRoute ? () => { void props.onMobileBack("/notes/view/all", false) } : undefined} onOpenSettings={props.onOpenSettings} onRefresh={props.onRefreshVault} onSelectNote={props.onSelectNote} suggestions={props.missingNoteSuggestions} />}
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

export type LibraryPanelProps = {
  activeCacheId: string | null
  canCreateFolder: boolean
  canCreateNote: boolean
  connected: boolean
  folderContextActions: FolderContextActions
  connectionLabel: string
  expandedFolderPaths: ReadonlySet<string>
  folders: VaultFolder[]
  // 排序偏好绑定的库身份：拖动提交校验发起库，切库时卸载进行中的拖动。
  folderOrderKey: string
  isManagingFolder: boolean
  isOpeningVault: boolean
  isCreatingNote: boolean
  isRefreshingVault: boolean
  // 没有任何目录上下文时切换器不当自己是「全部笔记」，也不给该菜单项打勾。
  hasNoFolderSelection: boolean
  libraryView: LibraryView
  localVaultSupported: boolean
  noteCount: number
  starredNoteCount: number
  onCreateNote: () => void
  onCreateFolder: (name: string, parentFolder: string | null) => void
  onFolderOrderChange: (paths: string[]) => void
  onImportNotes: (files: File[]) => void
  onOpenLocalVault: () => void
  onOpenSettings: () => void
  onRefreshVault: () => void
  onSelectFolder: (folder: string | null) => void
  onToggleFolder: (folderPath: string) => void
  onSelectLibraryView: (view: LibraryView) => void
  onSelectVaultCache: (cacheId: string) => void
  searchRevealRequest?: SearchRevealRequest | null
  selectedFolder: string | null
  syncLabel: string
  vaultError: string | null
  vaultCaches: VaultCacheSummary[]
}

// 侧栏只关心目录树与笔记库状态，搜索输入和正文编辑都不该惊动它。
export const LibraryPanel = memo(function LibraryPanel({
  activeCacheId,
  connected,
  canCreateNote,
  canCreateFolder,
  connectionLabel,
  expandedFolderPaths,
  folderContextActions,
  folders,
  folderOrderKey,
  isManagingFolder,
  isOpeningVault,
  isCreatingNote,
  isRefreshingVault,
  hasNoFolderSelection,
  libraryView,
  localVaultSupported,
  noteCount,
  starredNoteCount,
  onCreateNote,
  onCreateFolder,
  onFolderOrderChange,
  onImportNotes,
  onOpenLocalVault,
  onOpenSettings,
  onRefreshVault,
  onSelectFolder,
  onToggleFolder,
  onSelectLibraryView,
  onSelectVaultCache,
  searchRevealRequest,
  selectedFolder,
  syncLabel,
  vaultError,
  vaultCaches,
}: LibraryPanelProps) {
  const navigate = useNavigate()
  const importInputRef = useRef<HTMLInputElement>(null)
  const folderViewportRef = useRef<HTMLDivElement>(null)
  const lastFolderRevealRef = useRef(0)
  // 排序管理模式的开关只影响侧栏展示，不参与写权限判断：只读或离线的库同样允许调整本地顺序。
  const [sortingFolders, setSortingFolders] = useState(false)
  const activeFolder = folders.find((folder) => folder.path === selectedFolder)
  // recent/starred 是跨目录视图，优先级高于残留的 selectedFolder，避免路由切换中间帧显示错标签。
  const currentView = libraryView === "recent"
    ? { count: Math.min(noteCount, 32), icon: CheckCircle2, label: "最近更新" }
    : libraryView === "starred"
      ? { count: starredNoteCount, icon: Star, label: "收藏" }
      : selectedFolder
        ? { count: activeFolder?.count, icon: FolderOpen, label: activeFolder?.label ?? selectedFolder }
        // 未选中的 `/notes` 也走 all 分支，但它并没有在浏览全部笔记，
        // 这里必须让位给空态引导，否则切换器与列表区会各说各话。
        : hasNoFolderSelection
          ? { count: noteCount, icon: FileText, label: "选择目录" }
          : { count: noteCount, icon: FileText, label: "全部笔记" }
  const CurrentViewIcon = currentView.icon

  // 顶层目录在传入前已在完整目录树上排好序（含根目录置顶）；这里只负责裁剪出可拖动的那部分。
  const topLevelFolders = useMemo(() => folders.filter((folder) => folder.depth === 0), [folders])
  const systemRootFolder = topLevelFolders.find((folder) => folder.path === SYSTEM_ROOT_FOLDER_PATH)
  const sortableFolderPaths = useMemo(
    () => topLevelFolders.filter((folder) => folder.path !== SYSTEM_ROOT_FOLDER_PATH).map((folder) => folder.path),
    [topLevelFolders],
  )

  useEffect(() => {
    // 目录被删到不足两个时没有可调整的对象，自动退出管理模式，避免留下空手柄。
    if (sortingFolders && sortableFolderPaths.length < 2) setSortingFolders(false)
  }, [sortingFolders, sortableFolderPaths.length])

  useLayoutEffect(() => {
    const viewport = folderViewportRef.current
    if (!viewport || !searchRevealRequest || !selectedFolder) return
    if (lastFolderRevealRef.current === searchRevealRequest.requestId) return
    const frame = window.requestAnimationFrame(() => {
      const row = [...viewport.querySelectorAll<HTMLElement>("[data-folder-path]")]
        .find((candidate) => candidate.dataset.folderPath === selectedFolder)
      if (!row) return
      revealWithinViewport(viewport, row)
      lastFolderRevealRef.current = searchRevealRequest.requestId
    })
    return () => window.cancelAnimationFrame(frame)
  }, [folders, searchRevealRequest?.requestId, selectedFolder])

  return (
    <aside className="library-panel">
      {/* 导入 input 常驻在菜单外：Radix 关闭菜单会卸载菜单项，系统文件选择器返回时仍需有稳定节点接收 change。 */}
      <input
        accept=".md,text/markdown"
        className="attachment-file-input"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ""
          if (files.length > 0) onImportNotes(files)
        }}
        ref={importInputRef}
        tabIndex={-1}
        type="file"
      />

      <div className="library-compact-header">
        <div className="library-identity">
          <span className="eyebrow">笔记库</span>
          <CacheSwitcher
            activeCacheId={activeCacheId}
            caches={vaultCaches}
            compact
            onSelectCache={onSelectVaultCache}
          />
          {vaultCaches.length === 0 ? <h1>我的笔记</h1> : null}
        </div>
        <div className="library-compact-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-label={isCreatingNote ? "正在创建笔记" : "新建笔记"} disabled={!canCreateNote || isCreatingNote} onClick={onCreateNote} size="icon-sm" variant="ghost">
                {isCreatingNote ? <LoaderCircle className="animate-spin" /> : <Plus />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{canCreateNote ? "新建笔记" : "当前笔记库只读"}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="更多笔记库操作" size="icon-sm" variant="ghost"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="library-more-menu">
              <DropdownMenuItem disabled={!localVaultSupported || isOpeningVault} onClick={onOpenLocalVault}>
                <FolderOpen />
                {isOpeningVault ? "正在读取…" : "打开本地笔记库"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canCreateNote || isCreatingNote} onClick={() => importInputRef.current?.click()}>
                <FileUp />
                导入 Markdown
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings/trash")}><Trash2 />回收站</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {vaultError ? <p className="vault-error library-vault-error" role="alert">{vaultError}</p> : null}

      <div className="library-section-title library-folder-title">
        <span>{sortingFolders ? "拖动排序" : "文件夹"}</span>
        {sortableFolderPaths.length > 1 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={sortingFolders ? "完成文件夹排序" : "调整文件夹顺序"}
                aria-pressed={sortingFolders}
                className="library-folder-sort-toggle"
                onClick={() => setSortingFolders((value) => !value)}
                size="icon-sm"
                variant="ghost"
              >
                {sortingFolders ? <Check /> : <ArrowUpDown />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sortingFolders ? "完成排序" : "调整文件夹顺序"}</TooltipContent>
          </Tooltip>
        ) : null}
        {canCreateFolder ? (
          <CreateFolderButton
            disabled={isManagingFolder}
            onCreate={(name) => onCreateFolder(name, selectedFolder)}
            parentFolder={selectedFolder}
          />
        ) : null}
      </div>

      <ScrollArea className="library-scroll library-folder-scroll" viewportRef={folderViewportRef}>
        <nav aria-label="笔记库导航" className="library-navigation">
          {folders.length > 0 ? sortingFolders ? (
            /* 管理模式只平铺顶层目录：拖动父目录时整个子树在数据层跟随，这里不渲染子行避免误拖。 */
            <FolderSortDndContext
              folderOrderKey={folderOrderKey}
              key={folderOrderKey}
              onCommit={onFolderOrderChange}
              sortableFolderPaths={sortableFolderPaths}
            >
              <SortableContext items={sortableFolderPaths} strategy={verticalListSortingStrategy}>
                {systemRootFolder ? (
                  <div className="library-row library-row-system" data-depth={0}>
                    <span className="library-chevron-placeholder" />
                    <div className="library-row-main">
                      <Folder />
                      <span>{systemRootFolder.label}</span>
                      <small>{systemRootFolder.count}</small>
                    </div>
                    <span aria-label="系统目录，固定在最前" className="library-folder-system-lock" role="img">
                      <LockKeyhole />
                    </span>
                  </div>
                ) : null}
                {topLevelFolders.filter((folder) => folder.path !== SYSTEM_ROOT_FOLDER_PATH).map((folder) => (
                  <SortableLibraryFolderRow
                    active={libraryView === "all" && selectedFolder === folder.path}
                    contextActions={folderContextActions}
                    folder={folder}
                    key={folder.path}
                    onSelectFolder={onSelectFolder}
                  />
                ))}
              </SortableContext>
            </FolderSortDndContext>
          ) : folders.map((folder) => (
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
          )) : (
            <div className="library-empty-folders">
              <FolderTree />
              <strong>还没有文件夹</strong>
              <p>{canCreateFolder
                ? canCreateNote ? "新建文件夹整理笔记，或从更多菜单导入 Markdown。" : "新建文件夹整理现有内容；连接恢复后即可继续写入。"
                : "打开本地笔记库，或前往设置连接坚果云。"}</p>
              {canCreateFolder ? (
                <CreateFolderButton disabled={isManagingFolder} label="新建文件夹" onCreate={(name) => onCreateFolder(name, null)} parentFolder={null} />
              ) : localVaultSupported ? (
                <Button disabled={isOpeningVault} onClick={onOpenLocalVault} size="sm" variant="outline">打开本地库</Button>
              ) : (
                <Button onClick={onOpenSettings} size="sm" variant="outline">连接坚果云</Button>
              )}
            </div>
          )}
        </nav>
      </ScrollArea>

      <div className="library-view-shell">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label={`当前浏览：${currentView.label}`} className="library-view-switcher" type="button">
              <CurrentViewIcon />
              <span>{currentView.label}</span>
              {typeof currentView.count === "number" ? <small>{currentView.count}</small> : null}
              <ChevronDown />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="library-view-menu">
            <DropdownMenuItem onClick={() => onSelectLibraryView("all")}>
              <FileText /><span>全部笔记</span><small>{noteCount}</small>{selectedFolder === null && libraryView === "all" && !hasNoFolderSelection ? <Check /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelectLibraryView("recent")}>
              <CheckCircle2 /><span>最近更新</span><small>{Math.min(noteCount, 32)}</small>{libraryView === "recent" ? <Check /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelectLibraryView("starred")}>
              <Star /><span>收藏</span><small>{starredNoteCount}</small>{libraryView === "starred" ? <Check /> : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
  compact = false,
  mobile = false,
  onSelectCache,
}: {
  activeCacheId: string | null
  caches: VaultCacheSummary[]
  compact?: boolean
  mobile?: boolean
  onSelectCache: (cacheId: string) => void
}) {
  if (caches.length === 0) return null
  const activeCache = caches.find((cache) => cache.id === activeCacheId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`切换笔记库，当前为${activeCache?.label ?? "离线缓存"}`} className={mobile ? "mobile-cache-switcher" : compact ? "cache-switcher cache-switcher-compact" : "cache-switcher"} title={compact ? activeCache?.label ?? "切换离线缓存" : undefined} variant={compact ? "ghost" : "outline"}>
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
    <div className="library-row" data-active={active} data-depth={Math.min(depth, 3)} data-folder-path={contextFolder?.path}>
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

// 桌面管理模式下可拖动的顶层目录行：只有手柄注册拖动监听，普通点击与右键菜单行为不变。
function SortableLibraryFolderRow({
  active = false,
  contextActions,
  folder,
  onSelectFolder,
}: {
  active?: boolean
  contextActions?: FolderContextActions
  folder: VaultFolder
  onSelectFolder: (folder: string | null) => void
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: folder.path })
  const style: CSSProperties = {
    transform: DndCss.Transform.toString(transform),
    transition,
  }
  const row = (
    <div className="library-row library-row-sorting" data-active={active} data-depth={0}>
      <span className="library-chevron-placeholder" />
      {/* 目录主体保持普通点击导航；拖动监听只挂在手柄上，拖动释放不会触发行点击。 */}
      <button className="library-row-main" onClick={() => onSelectFolder(folder.path)} type="button">
        {active ? <FolderOpen /> : <Folder />}
        <span>{folder.label}</span>
        <small>{folder.count}</small>
      </button>
      <button
        aria-label={`拖动排序 ${folder.label}`}
        className="library-folder-drag-handle"
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </button>
    </div>
  )
  return (
    <div
      className="library-folder-sortable"
      data-dragging={isDragging}
      ref={setNodeRef}
      style={style}
    >
      {contextActions
        ? <FolderRowContextMenu actions={contextActions} folder={folder}>{row}</FolderRowContextMenu>
        : row}
    </div>
  )
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
  noSelection: boolean
  // 空态引导的出口：768–1099px 宽度区间桌面布局不渲染侧栏，那里侧栏菜单点不到，
  // 只能靠这个按钮进入全部笔记；更宽时它只是冗余，不是错误。
  onBrowseAllNotes: () => void
  onCreateNote: () => void
  onIncludeNestedFolderNotesChange: (include: boolean) => void
  onOpenGlobalSearch: () => void
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
  searchRevealRequest?: SearchRevealRequest | null
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
  noSelection,
  notes,
  noteSort,
  onBrowseAllNotes,
  onCreateNote,
  onIncludeNestedFolderNotesChange,
  onOpenGlobalSearch,
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
  searchRevealRequest,
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

  // 未选中任何目录时没有“当前目录”可搜，整块换成空态引导；
  // 标题栏保留，右侧的排序/标签入口在不选中时也没有意义，一并收起。
  if (noSelection) {
    return (
      <section className="note-list-panel">
        <ScrollArea className="note-list-scroll">
          <div className="note-groups">
            <NoSelectionNoteList onBrowseAll={onBrowseAllNotes} />
          </div>
        </ScrollArea>
      </section>
    )
  }

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

      <div className="note-search-row">
        <div className="note-search-wrap">
          <Search />
          <Input
            aria-label="搜索当前目录"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              // 搜索框没有清空按钮，键盘用户只能靠 Esc 退出：先清空关键词，已经空了就交还焦点。
              if (event.key !== "Escape") return
              if (query) onQueryChange("")
              else event.currentTarget.blur()
            }}
            placeholder="搜索当前目录"
            value={query}
          />
        </div>
        <Button aria-label="全局搜索（⌘⇧K）" onClick={onOpenGlobalSearch} size="icon" title="全局搜索（⌘⇧K）" variant="ghost">
          <Globe />
        </Button>
      </div>

      <NoteListContextMenu canCreate={canCreateNote} onCreate={onCreateNote} onSearch={onOpenGlobalSearch}>
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
              query={query}
              searchRevealRequest={searchRevealRequest}
              viewportRef={viewportRef}
            />
          ) : viewportReady ? <EmptyNoteList canCreateNote={canCreateNote} isLoading={isLoading} onCreateNote={onCreateNote} onOpenSettings={onOpenSettings} selectedFolder={selectedFolder} /> : null}
        </div>
      </ScrollArea>
      </NoteListContextMenu>
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

// `/notes` 的落点：没有选中任何目录，也不默认展示全库。
// 引导用户去左侧目录树（那是唯一能获得明确上下文的地方），并给出一个直达全库的显式入口——
// 窄桌面窗口下侧栏整个被隐藏，没有这个按钮就走不出去了。
function NoSelectionNoteList({ onBrowseAll }: { onBrowseAll: () => void }) {
  return (
    <div className="note-list-empty" data-variant="no-selection">
      <FolderTree />
      <strong>从左侧选择目录</strong>
      <p>选择目录查看其中的笔记，或直接浏览全部笔记。</p>
      <Button onClick={onBrowseAll} size="sm" variant="outline">浏览全部笔记</Button>
    </div>
  )
}

export function FolderRenameButton({
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
  const [request, setRequest] = useState<{ initialName: string; mode: "local" | "webdav"; sourcePath: string } | null>(null)
  const [name, setName] = useState(currentName)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const openRename = () => {
    // 弹窗打开时冻结源路径；期间即使父→子导航或列表复用组件，提交也只作用于原目标。
    setRequest({ initialName: currentName, mode, sourcePath: folderPath })
    setName(currentName)
    setConfirmingDelete(false)
  }
  const requestName = request?.initialName ?? currentName
  const requestMode = request?.mode ?? mode
  const requestPath = request?.sourcePath ?? folderPath

  return (
    <Dialog onOpenChange={(nextOpen) => { if (!nextOpen) setRequest(null); setConfirmingDelete(false) }} open={request !== null}>
      <Button aria-label={`重命名文件夹 ${currentName}`} disabled={disabled} onClick={openRename} size="icon-sm" variant="ghost"><PencilLine /></Button>
      <DialogContent>
        <DialogHeader><DialogTitle>{confirmingDelete ? "删除文件夹" : "重命名文件夹"}</DialogTitle><DialogDescription>{confirmingDelete && requestMode === "local" ? "文件夹及其中的全部文件会移动到 Swell Note 回收站，可在保留期内恢复。" : confirmingDelete ? "该目录中的笔记将进入待同步删除，可在同步前撤销。" : requestMode === "local" ? `将直接重命名“${requestPath}”，并同步更新当前笔记索引。` : `“${requestPath}”及其子目录会先在本机排队，点击同步后整体移动坚果云目录。`}</DialogDescription></DialogHeader>
        <Input autoFocus aria-label="新文件夹名称" onChange={(event) => setName(event.target.value)} value={name} />
        <DialogFooter>
          {confirmingDelete ? (
            <>
              <Button onClick={() => setConfirmingDelete(false)} variant="ghost">暂不删除</Button>
              <Button onClick={() => { setRequest(null); onDelete(requestPath) }} variant="destructive">{requestMode === "local" ? "移入回收站" : "确认移入待删除"}</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setConfirmingDelete(true)} variant="destructive">删除文件夹</Button>
              <Button disabled={!name.trim() || name.trim() === requestName} onClick={() => { setRequest(null); onRename(requestPath, name) }}>确认重命名</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateFolderButton({
  disabled,
  label,
  onCreate,
  parentFolder,
}: {
  disabled: boolean
  label?: string
  onCreate: (name: string) => void
  parentFolder: string | null
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")

  return (
    <Dialog onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) setName("") }} open={open}>
      <Button aria-label="新建文件夹" disabled={disabled} onClick={() => setOpen(true)} size={label ? "sm" : "icon-sm"} variant={label ? "outline" : "ghost"}><FolderPlus />{label}</Button>
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
  query?: string
}

// 列表是最容易掉帧的地方：编辑正文、切换选中都会刷新整个 notes 数组，
// 但真正变了的只有一两行。这里 memo 掉其余行，让每次输入只重渲染受影响的那几行。
const NoteListRow = memo(function NoteListRow({ active, contextActions, note, onLongPress, onSelect, query = "" }: NoteListRowProps) {
  const handleLongPress = useMemo(
    () => onLongPress ? () => onLongPress(note) : undefined,
    [note, onLongPress],
  )
  const longPressProps = useLongPress(handleLongPress)
  const previewText = useSearchMatch(note, query)
  const folder = note.folder ?? deriveFolder(note)
  const row = (
    <button
      className="note-list-row"
      data-active={active}
      onClick={() => onSelect(note)}
      title={[note.title || "未命名笔记", folder, ...(note.tags ?? []).map((tag) => `#${tag}`)].filter(Boolean).join(" · ")}
      type="button"
      {...longPressProps}
    >
      <div className="note-row-heading">
        <strong><HighlightedText query={query} text={note.title || "未命名笔记"} /></strong>
        {note.pinned ? <Pin aria-label="已置顶" className="pinned-icon" /> : null}
        {note.starred ? <Star className="starred-icon" /> : null}
        {note.tags?.length ? <span className="note-row-tag">#{note.tags[0]}{note.tags.length > 1 ? ` +${note.tags.length - 1}` : ""}</span> : null}
      </div>
      <div className="note-row-summary">
        <time>{note.updatedAt}</time>
        <span className="note-row-preview"><HighlightedText query={query} text={previewText || folder} /></span>
      </div>
    </button>
  )
  // 移动端用长按弹操作面板，桌面端才把这一行接到右键菜单上。
  return contextActions ? <NoteRowContextMenu actions={contextActions} note={note}>{row}</NoteRowContextMenu> : row
})

type NoteEditorProps = {
  active?: boolean
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
  // 正文的呈现方式（即时预览 / Markdown 源码）。与 noteViewMode（阅读态）正交：
  // 前者只影响怎么写，后者决定可不可写，因此界面上分成两个入口，不并成一组按钮。
  markdownSourceMode: MarkdownSourceMode
  noteViewMode: NoteViewMode
  onBack?: () => void
  onDeleteNote: () => void
  onExportNote: () => void
  onFormat: (syntax: string) => void
  onFormatNote: (noteId: string, syntax: string) => void
  /**
   * 附件写入队列。编辑区只负责「把这一批连同发起现场交给队列」，
   * 写入、重试、取消、进度都由队列与队列面板承担。
   */
  attachmentQueue: AttachmentQueue
  onLoadWikiNote: (target: string) => void
  onOpenWikiLink: (target: string) => void
  onOpenSourceFile: () => void
  onMoveNote: (folderPath: string | null) => void
  onMarkdownSourceModeChange: (mode: MarkdownSourceMode) => void
  onNoteViewModeChange: (mode: NoteViewMode) => void
  onRenameNote: (title: string) => void
  onReloadNote: () => void
  onResolveConflict: (strategy: "local" | "merge" | "remote") => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onResolveWikiNote: (target: string) => EmbeddedWikiNoteResult
  onRestoreNoteVersion: (content: string) => Promise<void>
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
const NoteEditor = memo(function NoteEditor({ active = true, activeCacheId, attachmentQueue, backLabel = "全部笔记", backlinks, canInsertAttachment, canManageNote, cloudConnected, compact = false, isManagingNote, markdownSourceMode, moveTargets, note, noteViewMode, onBack, onSelectFolder, onDeleteNote, onExportNote, onFormat, onLoadWikiNote, onMarkdownSourceModeChange, onMoveNote, onNoteViewModeChange, onOpenSourceFile, onOpenWikiLink, onReloadNote, onRenameNote, onResolveAsset, onResolveConflict, onResolveWikiNote, onRestoreNoteVersion, onSelectNote, onSync, onToggleTask, onUpdateNote, saveState, syncing, wikiLinkNotes }: NoteEditorProps) {
  const noteRenderIdentity = note.editorSessionKey ?? stableNoteRenderIdentity(note.id, note.remotePath)
  const assetScope = `${activeCacheId ?? "session"}:${noteRenderIdentity}`
  // 同步请求使用点击瞬间的正文快照；请求完成前锁定编辑，避免旧快照回写覆盖新输入。
  const isCanvas = note.format === "canvas"
  const isExcalidraw = isExcalidrawMarkdown(note.content)
  const isSpecialPreview = isCanvas || isExcalidraw
  const fileReadOnly = isCanvas || (note.readOnly ?? note.source === "webdav")
  const writeProtected = resolveWriteProtected(fileReadOnly, note.source, saveState.status)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const editorArticleRef = useRef<HTMLElement>(null)
  const dismissSelectionOriginRef = useRef<PointerOrigin | null>(null)
  const editorViewportRef = useRef<HTMLDivElement>(null)
  // locked 只切换同一个 CodeMirror 的可写能力，不更换正文组件，滚动、选区与撤销历史因此都能保留。
  const viewLocked = noteViewMode === "locked"
  const editorReadOnly = resolveEditorReadOnly(fileReadOnly, note.source, noteViewMode, saveState.status)
  // 特殊画布始终使用专属预览；preview 仅承接旧偏好和低频兼容阅读入口。
  const previewing = isSpecialPreview || noteViewMode === "preview"
  const viewAction = getNoteViewModeAction(noteViewMode)
  const sourceMode = markdownSourceMode === "source"
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false)
  const [outlinePinned, setOutlinePinned] = useState(false)
  const [activeOutlineIndex, setActiveOutlineIndex] = useState(-1)
  const searchNavigation = useContext(SearchNavigationContext)
  const [renameTitle, setRenameTitle] = useState(note.title)
  const [cursorPosition, setCursorPosition] = useState({ column: 1, line: 1 })
  const [hasSelection, setHasSelection] = useState(false)
  const [historyState, setHistoryState] = useState({ undo: false, redo: false })
  const [editingTable, setEditingTable] = useState(false)
  // 光标 / 选区当前格式，供工具栏高亮；正文与表格单元格都会汇报。
  const [formatState, setFormatState] = useState<EditorFormatState | null>(null)
  // 移动端链接面板：非 null 时打开（工具栏「链接」或点按已有链接进入）。
  const [linkSheet, setLinkSheet] = useState<LinkSheetState | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [findReplacement, setFindReplacement] = useState("")
  const [findResult, setFindResult] = useState({ current: 0, total: 0 })
  const findInputRef = useRef<HTMLInputElement>(null)
  const previewSearchRef = useRef(new PreviewSearch())
  // 粘贴/插入时的即时错误（剪贴板读不到、代码块里不能插图等）。写入过程与结果不在这里，
  // 它们属于队列，由 AttachmentQueuePanel 常驻展示——编辑区卸载也不该让它们消失。
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const batches = useAttachmentQueue(attachmentQueue)
  // 忙碌态看「这篇笔记是否还有批次在排队或写入」，而不是看本组件的某次 await：
  // 队列可能正忙在别的笔记上，那时这个工具栏不该被锁住。
  const attachmentBusy = batches.some((batch) => (batch.status === "queued" || batch.status === "writing")
    && batch.target.editorSessionKey === (note.editorSessionKey ?? note.id))
  const currentNoteIdRef = useRef(note.id)
  currentNoteIdRef.current = note.id
  const [viewSwitchError, setViewSwitchError] = useState<string | null>(null)
  const previewRequestRef = useRef(0)
  // 换笔记后上次失败的提示不再适用；同时作废进行中的预览加载——
  // 否则 A→B→A 往返时，A 的旧请求会因笔记 ID 再次匹配而越过守卫生效。
  useEffect(() => {
    previewRequestRef.current += 1
    setViewSwitchError(null)
  }, [note.id])
  // 预览是懒加载 chunk：切换瞬间如果还没取到，原正文会整块换成加载占位。
  // 先等同一个模块缓存就绪再翻状态（启动预取已覆盖时只是一个微任务），
  // 没取到时编辑器多停一拍，也比正文整块消失更容易接受。路径必须与上方 lazyWithRetry 一致。
  // 正文模式切换：只翻本机编辑偏好，不动笔记内容、不写远端元数据。
  // 草稿的落定在编辑器内部完成（切换前会先提交表格单元格与公式块草稿），这里不重复处理。
  const toggleMarkdownSourceMode = useCallback(() => {
    onMarkdownSourceModeChange(markdownSourceMode === "source" ? "live" : "source")
  }, [markdownSourceMode, onMarkdownSourceModeChange])
  const handleNoteViewModeChange = useCallback((mode: NoteViewMode) => {
    // 每次切换意图都递增序号：加载期间用户改回编辑态或换了笔记，旧请求完成后不得再翻状态。
    const requestId = ++previewRequestRef.current
    setViewSwitchError(null)
    if (mode !== "preview") {
      onNoteViewModeChange(mode)
      return
    }
    const noteId = currentNoteIdRef.current
    void import("@/components/editor/markdown-preview")
      .then(() => {
        if (requestId !== previewRequestRef.current || currentNoteIdRef.current !== noteId) return
        onNoteViewModeChange(mode)
      })
      .catch(() => {
        // chunk 取不到（弱网等）时保持编辑态并给出反馈，而不是点了没反应。
        if (requestId !== previewRequestRef.current || currentNoteIdRef.current !== noteId) return
        setViewSwitchError("阅读模式加载失败，请检查网络后重试")
      })
  }, [onNoteViewModeChange])
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
  // 字数与阅读时长：Canvas / Excalidraw 没有可读正文，不显示。
  const readingHint = useMemo(() => {
    if (isSpecialPreview) return null
    const words = countWords(note.content)
    if (words === 0) return null
    return `${words} 字 · 约 ${estimateReadingMinutes(note.content)} 分钟`
  }, [isSpecialPreview, note.content])
  // 大纲扫描推迟到输入停顿后，固定侧栏也不能让长文每次按键都重新扫描全文。
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
      // 从搜索进入时由命中定位负责滚动，不能让历史阅读位置在下一帧覆盖它。
      if (searchNavigation.request?.noteId === note.id) return
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
  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const [titleDraft, setTitleDraft] = useState(note.title)
  useEffect(() => {
    // 手机打开新稿时先保持阅读姿态，用户点标题或正文后才唤起软键盘。
    if (!compact && note.draft) titleInputRef.current?.focus()
  }, [compact, note.draft, noteRenderIdentity])
  useEffect(() => { setTitleDraft(note.title) }, [note.id, note.title])

  useLayoutEffect(() => {
    const field = titleInputRef.current
    if (!field) return
    const resize = () => {
      field.style.height = "auto"
      field.style.height = `${field.scrollHeight}px`
    }
    resize()
    // 标题的换行数随画布宽度变化；侧栏调宽或设备旋转后也要重新测量。
    let width = field.clientWidth
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return
      width = field.clientWidth
      resize()
    })
    observer.observe(field)
    return () => observer.disconnect()
  }, [titleDraft, note.title, previewing, fileReadOnly])

  const cancelTitleCommitRef = useRef(false)
  const commitTitle = () => {
    // Esc 的失焦发生在 React 草稿更新之前，显式跳过这一次提交才能真正取消重命名。
    if (cancelTitleCommitRef.current) {
      cancelTitleCommitRef.current = false
      return
    }
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
    // 手机上手动拼 [文字](地址) 成本太高：工具栏「链接」改为打开面板，分别填文字与地址；
    // 有选区自动带入文字，光标落在已有链接上则预填并按编辑保存。
    if (compact && syntax === "[链接](https://)") {
      const context = editorRef.current?.readLinkContext()
      if (context) {
        setLinkSheet({
          cell: context.cell,
          hadFocus: context.hadFocus,
          label: context.target?.label ?? context.selectedText.trim(),
          menu: false,
          target: context.target,
          url: context.target?.url ?? "",
        })
        return
      }
    }
    if (editorRef.current) {
      editorRef.current.insertText(syntax)
      return
    }
    onFormat(syntax)
  }, [compact, onFormat])

  // 面板自身不写正文：保存/移除都交给编辑器 handle 完成（内部会校验原文、映射选区并恢复焦点），
  // 这里只负责关掉面板。焦点归还不能在点击事件里同步做（modal 面板的 inert 还没解除，
  // focus 会静默失败），由面板的 onRestoreFocus 在卸载流程里调：优先还给仍在编辑的单元格，
  // 否则按打开前的焦点状态归还键盘。
  const closeLinkSheet = useCallback(() => {
    setLinkSheet(null)
  }, [])

  const restoreLinkSheetFocus = useCallback((sheet: LinkSheetState) => {
    if (editorRef.current?.restoreCellFocus(sheet.cell ?? null)) return
    if (sheet.hadFocus) editorRef.current?.focus()
  }, [])

  const openLinkSheetTarget = useCallback((sheet: LinkSheetState) => {
    setLinkSheet(null)
    if (sheet.noteTarget) onOpenWikiLink(sheet.noteTarget)
    else if (sheet.href) void openExternalUrl(sheet.href)
  }, [onOpenWikiLink])

  /**
   * 把一批附件交给队列。
   *
   * 这里不再自己 await 写入：写入可能很久（远端、大文件、前面还排着别的批次），
   * 等在这里会让人误以为「点了没反应」。队列按发起顺序串行写入，进度与重试都由它负责。
   *
   * 三件事在**发起这一刻**固定下来，之后无论用户切笔记、重命名、切库都不再改：
   * 1. 目标笔记的身份（库 + editorSessionKey）。完成后一律按它落笔，不读当前打开的笔记。
   * 2. 插入锚点。队列入队时立即取书签，等待期间跟踪正文变化；主动重试时重新取原笔记
   *    的当前位置，身份不符则显式降级，绝不改写到别的笔记。
   * 3. 这一批文件本身，失败重试只重传失败项。
   */
  const handleInsertFiles = useCallback((files: File[], position?: number, options?: { slots?: readonly AttachmentQueueSlotInput[] }) => {
    if (files.length === 0 || editorReadOnly || !canInsertAttachment) return false
    const targetNoteId = note.id
    const editorSessionKey = note.editorSessionKey ?? note.id
    // 发起时那篇笔记对应的编辑器 sessionKey，与传给 MarkdownEditor 的完全相同
    // （两处都走 attachmentEditorKey，写法必须一致）。
    // 首次入队同步捕获；之后重试时可能已切笔记，必须继续携带原身份才能拒绝错误落点。
    const ownerSessionKey = attachmentEditorKey(activeCacheId, editorSessionKey)
    setAttachmentError(null)
    attachmentQueue.enqueue({
      files,
      target: { cacheId: activeCacheId, editorSessionKey, noteId: targetNoteId, noteTitle: note.title },
      insertions: {
        // capture 由队列在入队时调用，不能延迟到执行时，否则光标移动后会插到新位置。
        // 书签绑定发起时的那篇笔记：captureInsertion 在重试时笔记对不上则返回 null，
        // 队列据此走「追加到原文末尾」的降级，而不是把引用写进当前打开的笔记。
        capture: ({ retry, reinsert, slots }) => editorRef.current?.captureAttachmentInsertion({
          ownerSessionKey,
          // 重试时不再复用当初的数字偏移（它没有继续映射），改用原批次留下的占位令牌。
          // 补插是用户的新操作，只取当前光标；不能复用第一次粘贴/拖入的数字坐标。
          ...(reinsert ? {} : retry
            ? { retrySlots: slots }
            : { placeholders: options?.slots, position }),
        }) ?? null,
      },
    })
    return true
  }, [activeCacheId, attachmentQueue, canInsertAttachment, editorReadOnly, note.editorSessionKey, note.id, note.title])

  const getWikiLinkSuggestions = useCallback(() => wikiLinkNotes
    .filter((candidate) => candidate.pendingOperation !== "delete" && Boolean(candidate.remotePath))
    .map((candidate) => {
      const title = candidate.title || "未命名笔记"
      const target = candidate.remotePath!
      const href = noteRelativeHref(note, target)
      return { detail: target, markdown: buildMarkdownNoteLink(title, href), target, title }
    }), [note.remotePath, wikiLinkNotes])

  const runFind = useCallback((direction: "next" | "previous" = "next", fromStart = false) => {
    setFindResult(previewing
      ? previewSearchRef.current.find(editorArticleRef.current?.querySelector(".markdown-preview") ?? null, findQuery, direction, fromStart)
      : editorRef.current?.findText(findQuery, direction, fromStart) ?? { current: 0, total: 0 })
  }, [findQuery, previewing])

  useEffect(() => {
    const search = previewSearchRef.current
    if (!active || !findOpen || !previewing) { search.clear(); return }
    const article = editorArticleRef.current
    if (!article) return
    let frame = 0
    const refresh = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setFindResult(search.find(article.querySelector(".markdown-preview"), findQuery, "next", false, true)))
    }
    // 长文和嵌入内容会分批渲染，查找数量跟着补齐，不能只搜首屏已挂载的段落。
    const observer = new MutationObserver(refresh)
    const content = article.querySelector(".document-canvas")
    if (content) observer.observe(content, { childList: true, subtree: true, characterData: true })
    refresh()
    return () => { observer.disconnect(); cancelAnimationFrame(frame); search.clear() }
  }, [active, findOpen, findQuery, previewing, note.id])

  useEffect(() => {
    setFindOpen(false)
    setFindQuery("")
    setFindReplacement("")
    setFindResult({ current: 0, total: 0 })
  }, [note.id])

  useEffect(() => {
    const request = searchNavigation.request
    if (!active || !request || request.noteId !== note.id || note.contentLoaded === false) return
    if (!isSpecialPreview) {
      setFindQuery(request.query)
      setFindOpen(true)
    }
    searchNavigation.consume()
  }, [active, searchNavigation, note.id, note.contentLoaded, isSpecialPreview])

  useEffect(() => {
    if (!active || !findOpen || previewing || note.contentLoaded === false) return
    let frame = 0
    const refresh = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!editorRef.current) return
        setFindResult(editorRef.current.findText(findQuery, "next", true))
        observer.disconnect()
      })
    }
    // 编辑器懒加载时 ref 尚未就绪；监听挂载完成再定位，不使用固定超时猜测加载耗时。
    const observer = new MutationObserver(refresh)
    if (editorArticleRef.current) observer.observe(editorArticleRef.current, { childList: true, subtree: true })
    refresh()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [active, findOpen, findQuery, previewing, note.id, note.contentLoaded])

  useEffect(() => {
    if (!active || !findOpen || previewing || note.contentLoaded === false) return
    // 正文事务（含撤销/重做）回传新内容后，只刷新计数，不重新定位匹配或触碰焦点。
    setFindResult(editorRef.current?.inspectFind(findQuery) ?? { current: 0, total: 0 })
  }, [active, findOpen, findQuery, previewing, note.id, note.content, note.contentLoaded])

  useEffect(() => {
    if (!active || !findOpen) return
    const frame = window.requestAnimationFrame(() => findInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [active, findOpen, previewing])

  useEffect(() => {
    if (!active || !findOpen) return
    // 查找栏挂在编辑器下沿，点回正文改内容是常事；Esc 只绑在查找框上的话，
    // 焦点一离开输入框就收不起来了，只能回去点关闭按钮。
    const closeOnEscape = (event: KeyboardEvent) => {
      // 弹窗自己要用 Esc 关闭，别把它的这一下抢过来。
      if (event.isComposing || event.key !== "Escape" || hasOpenModal()) return
      setFindOpen(false)
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [active, findOpen])

  useEffect(() => {
    if (!active || isSpecialPreview) return
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLocaleLowerCase() !== "f") return
      if (hasOpenModal()) return
      event.preventDefault()
      setFindOpen(true)
      window.requestAnimationFrame(() => { findInputRef.current?.focus(); findInputRef.current?.select() })
    }
    window.addEventListener("keydown", handleFindShortcut)
    return () => window.removeEventListener("keydown", handleFindShortcut)
  }, [active, isSpecialPreview])

  useEffect(() => {
    // 画布有自己的全选语义（选中所有图形），不接管。
    if (!active || isSpecialPreview) return
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
  }, [active, isSpecialPreview, previewing])

  useEffect(() => {
    if (!active || !outlinePinned || compact || isSpecialPreview) return
    const viewport = editorViewportRef.current
    if (!viewport) return
    let frame = 0
    const refresh = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const line = readTopSourceLine() ?? 1
        let active = -1
        if (previewing) {
          const top = viewport.getBoundingClientRect().top
          const headings = viewport.querySelectorAll<HTMLElement>(".markdown-preview :is(h1,h2,h3,h4,h5,h6)[data-source-line]")
          // 锚点跳转会保留 scroll-margin；高亮判定也留出相同距离，避免跳到第四章却选中第三章。
          for (const heading of headings) {
            if (heading.closest(".markdown-preview-embedded")) continue
            const margin = Number.parseFloat(getComputedStyle(heading).scrollMarginTop) || 0
            if (heading.getBoundingClientRect().top <= top + margin + 2) {
              const index = noteOutline.findIndex((item) => item.line === Number(heading.dataset.sourceLine))
              if (index >= 0) active = index
            }
          }
        } else {
          noteOutline.forEach((heading, index) => { if (heading.line <= line) active = index })
        }
        setActiveOutlineIndex(active)
      })
    }
    // 只在固定大纲时追踪可视区，并合并为每帧一次；复用源码行锚点兼容阅读和编辑排版。
    viewport.addEventListener("scroll", refresh, { passive: true })
    const observer = new MutationObserver(refresh)
    observer.observe(viewport, { childList: true, subtree: true })
    refresh()
    return () => { viewport.removeEventListener("scroll", refresh); observer.disconnect(); cancelAnimationFrame(frame) }
  }, [active, outlinePinned, compact, isSpecialPreview, noteOutline, previewing, readTopSourceLine])

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
      data-view-mode={previewing ? "preview" : noteViewMode}
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
          {!compact && !isSpecialPreview ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="文档大纲" size="icon-sm" variant="ghost"><ListTree /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="note-outline-menu">
                <DropdownMenuItem onSelect={() => setOutlinePinned((pinned) => !pinned)}>{outlinePinned ? "收起固定大纲" : "固定大纲"}</DropdownMenuItem>
                <DropdownMenuSeparator />
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
              {!isSpecialPreview ? (
                <>
                  <DropdownMenuItem onClick={() => handleNoteViewModeChange(viewAction.nextMode)}>
                    {viewAction.nextMode === "unified" ? <PencilLine /> : <LockKeyhole />}
                    {viewAction.label}
                  </DropdownMenuItem>
                  {noteViewMode !== "preview" ? (
                    <DropdownMenuItem onClick={() => handleNoteViewModeChange("preview")}>
                      兼容阅读视图
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setFindOpen(true)}>
                    <Search /> 查找当前笔记
                  </DropdownMenuItem>
                </>
              ) : null}
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
              <DropdownMenuItem onClick={onExportNote}>导出笔记与附件包</DropdownMenuItem>
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

      {!compact && !previewing ? editorReadOnly ? (
        <div className="formatting-toolbar formatting-toolbar-locked" role="status">
          <LockKeyhole />
          <span>{fileReadOnly ? "源文件只读" : viewLocked ? "只读阅读已锁定" : "正在同步，暂不可编辑"}</span>
        </div>
      ) : (
        <FormattingToolbar
          attachmentBusy={attachmentBusy}
          canInsertAttachment={canInsertAttachment}
          editorRef={editorRef}
          canUndo={historyState.undo}
          canRedo={historyState.redo}
          editingTable={editingTable}
          formatState={formatState}
          onFormat={handleFormat}
          onInsertFiles={handleInsertFiles}
          onToggleSourceMode={toggleMarkdownSourceMode}
          sourceMode={sourceMode}
        />
      ) : null}

      {noteViewMode === "preview" && !isSpecialPreview ? (
        <div className="compatibility-preview-banner" role="status">
          <span>当前使用兼容阅读视图</span>
          <Button onClick={() => handleNoteViewModeChange("unified")} size="sm" variant="outline">进入一体化编辑</Button>
        </div>
      ) : null}

      {findOpen && !isSpecialPreview ? (
        <div className="editor-find-bar" role="search">
          <div className="editor-find-field">
            <Search />
            <input
              aria-label="查找当前笔记"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                const query = event.target.value
                setFindQuery(query)

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
            {findQuery ? <button aria-label="清空查找" onClick={() => { setFindQuery(""); setFindResult({ current: 0, total: 0 }); findInputRef.current?.focus() }} type="button"><X /></button> : null}
            <span aria-live="polite">{findQuery && !findResult.total ? "无匹配" : `${findResult.current}/${findResult.total}`}</span>
          </div>
          <button aria-label="上一个匹配项" disabled={!findResult.total} onClick={() => runFind("previous")} type="button"><ChevronUp /></button>
          <button aria-label="下一个匹配项" disabled={!findResult.total} onClick={() => runFind("next")} type="button"><ChevronDown /></button>
          {!editorReadOnly && !previewing ? (
            <>
              <input
                aria-label="替换为"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
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
              <button className="editor-replace-button" disabled={!findResult.total} onClick={() => setFindResult(editorRef.current?.replaceCurrent(findQuery, findReplacement) ?? { current: 0, total: 0 })} type="button">替换</button>
              <button
                className="editor-replace-all-button"
                disabled={!findResult.total}
                onClick={() => {
                  editorRef.current?.replaceAll(findQuery, findReplacement)
                  setFindResult(editorRef.current?.inspectFind(findQuery) ?? { current: 0, total: 0 })
                }}
                type="button"
              >全部</button>
            </>
          ) : null}
          <button aria-label="关闭查找" className="editor-find-close" onClick={() => setFindOpen(false)} type="button"><X /></button>
        </div>
      ) : null}

      {attachmentError ? (
        <p className="attachment-error" role="alert">{attachmentError}</p>
      ) : null}
      {/* 队列面板挂在编辑区内部但仍然只读队列状态：批次写完后切走笔记、切阅读态，
          这些记录会随编辑区一起卸载（用户回来时队列本身还在 App 里，不会丢）。 */}
      <AttachmentQueuePanel
        batches={batches}
        onCancel={(batchId) => attachmentQueue.cancel(batchId)}
        onDismiss={(batchId) => attachmentQueue.dismiss(batchId)}
        onReinsert={(batchId) => attachmentQueue.reinsert(batchId)}
        onRetry={(batchId) => attachmentQueue.retry(batchId)}
        references={(batchId) => attachmentQueue.references(batchId)}
      />
      {viewSwitchError ? (
        <p className="attachment-error" role="alert">{viewSwitchError}</p>
      ) : null}

      {isExcalidraw ? (
        <div className="excalidraw-workspace">
          <Suspense fallback={<EditorLoadingState label="Excalidraw 画布" />}>
            <MarkdownPreview
              assetScope={assetScope}
              content={note.content}
              editable={!writeProtected}
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
      ) : <div className="editor-body"><ScrollArea className="editor-scroll" viewportRef={editorViewportRef}>
        <DocumentContextMenu
          disabled={isCanvas}
          mobile={compact}
          editorRef={editorRef}
          previewing={previewing}
          readOnly={editorReadOnly}
          viewMode={noteViewMode}
          hasSelection={hasSelection}
          canUndo={historyState.undo}
          canRedo={historyState.redo}
          canHistory={Boolean(activeCacheId)}
          starred={Boolean(note.starred)}
          onFind={() => setFindOpen(true)}
          onViewModeChange={handleNoteViewModeChange}
          onToggleStar={() => onUpdateNote({ starred: !note.starred })}
          onExport={onExportNote}
          onHistory={() => setHistoryDialogOpen(true)}
        >
        <div className="document-canvas">
          {previewing || fileReadOnly ? (
            <h1 className="document-title document-title-readonly">{note.title || "未命名笔记"}</h1>
          ) : (
            <textarea
              ref={titleInputRef}
              aria-label="笔记标题"
              className="document-title"
              onBlur={commitTitle}
              onChange={(event) => {
                // 文件名必须保持单行，粘贴多行文本时改成空格；显示换行交给文本框自动折行。
                const title = event.target.value.replace(/[\r\n]+/g, " ")
                if (isVaultNote) {
                  setTitleDraft(title)
                  return
                }
                onUpdateNote({ title })
              }}
              onKeyDown={(event) => {
                // 中文输入法的确认键只提交候选词，不能顺带重命名或让输入框失焦。
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                if (event.key !== "Enter" && event.key !== "Escape") return
                event.preventDefault()
                if (event.key === "Escape") {
                  cancelTitleCommitRef.current = true
                  setTitleDraft(note.title)
                }
                event.currentTarget.blur()
                if (event.key === "Enter" && !viewLocked) editorRef.current?.focus()
              }}
              placeholder="输入标题"
              readOnly={viewLocked}
              rows={1}
              value={isVaultNote ? titleDraft : note.title}
            />
          )}
          <div className="document-meta">
            <span>{note.updatedAt === "刚刚" ? "刚刚编辑" : note.updatedAt}</span>
            {/* 桌面端字符数已有底栏状态栏承担，只在没有底栏的移动端保留在标题下。 */}
            {compact ? (
              <>
                <span>·</span>
                <span>{documentSize}</span>
              </>
            ) : null}
            <span>·</span>
            <span>{deriveFolder(note)}</span>
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
                editable={!writeProtected}
                key={noteRenderIdentity}
                noteId={note.id}
                onLoadWikiNote={onLoadWikiNote}
                onResolveAsset={onResolveAsset}
                onResolveWikiNote={onResolveWikiNote}
                onToggleTask={writeProtected ? undefined : onToggleTask}
                onWikiLink={onOpenWikiLink}
              />
            </Suspense>
          ) : (
            <div className="markdown-editor-shell">
              <Suspense fallback={<EditorLoadingState label="Markdown 编辑器" />}>
                {/*
                  不再按笔记重建编辑器实例。切换笔记由编辑器内部的一次受控事务完成，
                  焦点、输入法组合态、滚动容器与撤销栈因此都能各自按笔记正确保留/隔离。
                */}
                <MarkdownEditor
                  compact={compact}
                  sessionKey={attachmentEditorKey(activeCacheId, note.editorSessionKey ?? note.id)}
                  revision={note.revision}
                  onHistoryChange={(undo, redo) => setHistoryState((current) => current.undo === undo && current.redo === redo ? current : { undo, redo })}
                  onEditingTargetChange={setEditingTable}
                  onFormatStateChange={setFormatState}
                  getWikiLinkSuggestions={getWikiLinkSuggestions}
                  onChange={(content) => onUpdateNote({
                    content,
                    preview: buildNotePreview(content, note.format),
                  })}
                  onCursorChange={(line, column) => setCursorPosition({ column, line })}
                  onInsertFiles={canInsertAttachment ? handleInsertFiles : undefined}
                  onPasteError={setAttachmentError}
                  onLinkMenu={(tap) => setLinkSheet({
                    hadFocus: tap.hadFocus,
                    href: tap.href,
                    label: tap.target.label,
                    menu: true,
                    noteTarget: tap.noteTarget,
                    target: tap.target,
                    url: tap.target.url,
                  })}
                  onLoadWikiNote={onLoadWikiNote}
                  onOpenWikiLink={onOpenWikiLink}
                  onResolveAsset={onResolveAsset}
                  onResolveWikiNote={onResolveWikiNote}
                  onSelectionChange={setHasSelection}
                  readOnly={editorReadOnly}
                  ref={editorRef}
                  sourceMode={markdownSourceMode === "source"}
                  storageKey={note.id}
                  value={note.content}
                />
              </Suspense>
            </div>
          )}
          <BacklinksPanel backlinks={backlinks} onSelectNote={onSelectNote} />
        </div>
        </DocumentContextMenu>
      </ScrollArea>
      {outlinePinned && !compact && !isSpecialPreview && <aside className="pinned-note-outline" aria-label="固定文档大纲">
        <div className="pinned-outline-header"><strong>文档大纲</strong><Button aria-label="收起固定大纲" size="icon-sm" variant="ghost" onClick={() => setOutlinePinned(false)}><X /></Button></div>
        <nav aria-label="章节导航">
          {noteOutline.length ? noteOutline.map((heading, index) => <button
            key={`${heading.line}-${index}`}
            type="button"
            aria-current={index === activeOutlineIndex ? "location" : undefined}
            onClick={() => revealOutlineHeading(heading, index)}
            style={{ paddingLeft: `${10 + Math.max(0, heading.level - 1) * 12}px` }}
          >{heading.text}</button>) : <p>当前笔记没有标题</p>}
        </nav>
      </aside>}
      </div>}

      {/* 只读笔记没有格式工具栏，选区操作仍需要独立一条（复制/全选可用）；
          可编辑时选区操作并入格式栏同一行，不再额外堆叠 46px。 */}
      {compact && !previewing && editorReadOnly ? hasSelection ? (
        <SelectionActionBar editorRef={editorRef} readOnly />
      ) : (
        <div className="formatting-toolbar formatting-toolbar-locked" data-mobile="true" role="status">
          <LockKeyhole />
          <span>{fileReadOnly ? "源文件只读" : viewLocked ? "只读阅读已锁定" : "正在同步"}</span>
        </div>
      ) : null}
      {compact && !previewing && !editorReadOnly ? (
        <FormattingToolbar
          attachmentBusy={attachmentBusy}
          canInsertAttachment={canInsertAttachment}
          editorRef={editorRef}
          canUndo={historyState.undo}
          canRedo={historyState.redo}
          editingTable={editingTable}
          formatState={formatState}
          hasSelection={hasSelection}
          mobile
          onFormat={handleFormat}
          onInsertFiles={handleInsertFiles}
          onToggleSourceMode={toggleMarkdownSourceMode}
          sourceMode={sourceMode}
        />
      ) : !compact && !isExcalidraw ? (
        <footer className="editor-statusbar">
          <span>{documentSize}</span>
          {readingHint ? <span>{readingHint}</span> : null}
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
      <MobileLinkSheet
        sheet={linkSheet}
        onClose={closeLinkSheet}
        onOpenLink={() => { if (linkSheet) openLinkSheetTarget(linkSheet) }}
        onRemoveLink={() => {
          // 成功才关闭；失败（原文在面板期间被改动）时面板保留，由面板提示用户。
          if (!linkSheet?.target) return true
          const removed = editorRef.current?.removeLink(linkSheet.target, linkSheet.cell ?? null) ?? false
          if (removed) setLinkSheet(null)
          return removed
        }}
        onRestoreFocus={() => { if (linkSheet) restoreLinkSheetFocus(linkSheet) }}
        onSaveLink={(label, url) => {
          if (!linkSheet) return false
          const applied = editorRef.current?.applyLink(linkSheet.target, label, url, linkSheet.cell ?? null) ?? false
          if (applied) setLinkSheet(null)
          return applied
        }}
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

type MobileRouteDescriptor =
  | { screen: "editor"; rawNoteId: string }
  | { screen: "library" }
  | { folder: string | null; screen: "notes"; view: LibraryView }

type MobileOverlayState = {
  mobileOverlay?: "navigation"
  mobileOverlayTarget?: boolean
  mobilePageKey?: string
}

function readMobileOverlayState(value: unknown): MobileOverlayState {
  return typeof value === "object" && value !== null ? value as MobileOverlayState : {}
}

function describeMobileRoute(pathname: string): MobileRouteDescriptor {
  if (pathname === "/notes") return { screen: "library" }
  const folderMatch = pathname.match(/^\/notes\/folder\/(.+)$/)
  if (folderMatch) {
    try {
      return { folder: decodeURIComponent(folderMatch[1]), screen: "notes", view: "all" }
    } catch {
      return { folder: folderMatch[1], screen: "notes", view: "all" }
    }
  }
  const viewMatch = pathname.match(/^\/notes\/view\/(all|recent|starred)$/)
  if (viewMatch) return { folder: null, screen: "notes", view: viewMatch[1] as LibraryView }
  const noteMatch = pathname.match(/^\/notes\/(.+)$/)
  return noteMatch ? { rawNoteId: noteMatch[1], screen: "editor" } : { screen: "library" }
}

function getMobileRouteFallback(descriptor: MobileRouteDescriptor) {
  if (descriptor.screen === "editor") return "/notes/view/all"
  if (descriptor.screen === "library") return "/notes"
  if (descriptor.folder) {
    const parent = getParentFolderPath(descriptor.folder)
    return parent ? `/notes/folder/${encodeURIComponent(parent)}` : "/notes"
  }
  return "/notes"
}

function getMobileRouteEntryLabel(entry: MobileRouteEntry | null, notes: Note[]) {
  if (!entry) return "笔记列表"
  const descriptor = describeMobileRoute(entry.pathname)
  if (descriptor.screen === "library") return "笔记库"
  if (descriptor.screen === "notes") return getMobileBackLabel(descriptor.view, descriptor.folder)
  const noteId = resolveRouteNoteId(descriptor.rawNoteId, notes.map((note) => note.id))
  return notes.find((note) => note.id === noteId)?.title || "上一页"
}

function createInitialMobileRouteStack(entry: MobileRouteEntry) {
  const descriptor = describeMobileRoute(entry.pathname)
  if (descriptor.screen === "library") return createMobileRouteStack(entry)
  const fallback = {
    ...createMobileRouteEntry(`fallback:${entry.key}`, getMobileRouteFallback(descriptor)),
    synthetic: true,
  }
  return { activeIndex: 1, entries: [fallback, entry] }
}

function RouteStackMobileWorkspace(props: WorkspaceProps & FolderTreeProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const overlayState = readMobileOverlayState(location.state)
  const navigationOpen = overlayState.mobileOverlay === "navigation"
  // 抽屉是 history 中的 modal entry，但页面栈继续使用底下页面的 key，打开抽屉不会复制整棵 DOM。
  const pageKey = navigationOpen && overlayState.mobilePageKey ? overlayState.mobilePageKey : location.key
  const routeEntry = createMobileRouteEntry(pageKey, location.pathname, location.search)
  const locationSignature = `${location.key}\u0000${location.pathname}\u0000${location.search}\u0000${navigationOpen}\u0000${Boolean(overlayState.mobileOverlayTarget)}`
  const [storedRouteState, setStoredRouteState] = useState<{
    locationSignature: string
    navigationOpen: boolean
    pathname: string
    resetKey: string
    stack: MobileRouteStack
  }>(() => ({
    locationSignature,
    navigationOpen,
    pathname: location.pathname,
    resetKey: props.mobileRouteResetKey,
    stack: createInitialMobileRouteStack(routeEntry),
  }))
  let routeState = storedRouteState
  if (storedRouteState.resetKey !== props.mobileRouteResetKey || storedRouteState.locationSignature !== locationSignature) {
    let stackAction: MobileNavigationAction = navigationType
    if (navigationType === "REPLACE" && storedRouteState.navigationOpen && overlayState.mobileOverlayTarget) {
      // 从抽屉选目标时用 REPLACE 消掉 modal entry；对页面栈而言仍是从底下页面 PUSH 新页。
      stackAction = "PUSH"
    }
    routeState = {
      locationSignature,
      navigationOpen,
      pathname: location.pathname,
      resetKey: props.mobileRouteResetKey,
      stack: storedRouteState.resetKey !== props.mobileRouteResetKey
        ? createInitialMobileRouteStack(routeEntry)
        : updateMobileRouteStack(storedRouteState.stack, routeEntry, stackAction),
    }
    // React 会在提交 DOM 前立即用新路由状态重渲染；并发 render 被放弃时这次更新也不会污染已提交历史。
    setStoredRouteState(routeState)
  }
  const stack = routeState.stack
  const activeEntry = stack.entries[stack.activeIndex]
  const previousEntry = stack.entries[stack.activeIndex - 1] ?? null
  const canGoBack = Boolean(previousEntry && !previousEntry.synthetic)
  const descriptor = describeMobileRoute(activeEntry.pathname)

  const openNavigation = useCallback(() => {
    if (navigationOpen) return
    navigate(`${location.pathname}${location.search}`, {
      state: { ...readMobileOverlayState(location.state), mobileOverlay: "navigation", mobilePageKey: activeEntry.key },
    })
  }, [activeEntry.key, location.pathname, location.search, location.state, navigate, navigationOpen])
  const closeNavigation = useCallback(() => {
    if (navigationOpen) navigate(-1)
  }, [navigate, navigationOpen])
  const completeEdgeSwipe = useCallback(() => {
    if (descriptor.screen === "library" && !previousEntry) {
      openNavigation()
      return true
    }
    return props.onMobileBack(getMobileRouteFallback(descriptor), canGoBack)
  }, [canGoBack, descriptor, openNavigation, previousEntry, props])
  const edgeSwipeKind = descriptor.screen === "library" && !previousEntry ? "drawer" : "back"
  const edgeSwipe = useEdgeSwipeAction(completeEdgeSwipe, !navigationOpen, edgeSwipeKind, activeEntry.key)

  return (
    <div className="mobile-workspace" data-screen={descriptor.screen} {...edgeSwipe.bind}>
      {stack.entries.map((entry, index) => {
        const role = entry.mountKey === activeEntry.mountKey
          ? "current"
          : entry.mountKey === previousEntry?.mountKey ? "previous" : "cached"
        return (
          <div
            aria-hidden={role !== "current" || undefined}
            className={role === "cached" ? "mobile-route-entry-cached" : `mobile-edge-swipe-${role}`}
            data-route-entry-key={entry.mountKey}
            inert={role !== "current" || undefined}
            key={`${props.mobileRouteResetKey}:${entry.mountKey}`}
          >
            <RouteActivityProvider active={role === "current"}>
              <MobileRouteEntryPage
                active={role === "current"}
                backLabel={getMobileRouteEntryLabel(stack.entries[index - 1] ?? null, props.allNotes)}
                canGoBack={Boolean(index > 0 && !stack.entries[index - 1]?.synthetic)}
                entry={entry}
                navigationOpen={role === "current" && navigationOpen}
                onNavigationOpenChange={(open) => { if (open) openNavigation(); else closeNavigation() }}
                props={props}
              />
            </RouteActivityProvider>
          </div>
        )
      })}
    </div>
  )
}

function MobileRouteEntryPage({ active, backLabel, canGoBack, entry, navigationOpen, onNavigationOpenChange, props: liveProps }: {
  active: boolean
  backLabel: string
  canGoBack: boolean
  entry: MobileRouteEntry
  navigationOpen: boolean
  onNavigationOpenChange: (open: boolean) => void
  props: WorkspaceProps & FolderTreeProps
}) {
  const descriptor = useMemo(() => describeMobileRoute(entry.pathname), [entry.pathname])
  const [query, setQuery] = useState(liveProps.query)
  const [selectedTag, setSelectedTag] = useState(liveProps.selectedTag)
  const [noteSort, setNoteSort] = useState(liveProps.noteSort)
  const [includeNestedFolderNotes, setIncludeNestedFolderNotes] = useState(liveProps.includeNestedFolderNotes)
  // 全局滚动记忆只用于 entry 首次挂载。此后每个 history entry 自持位置，
  // 同目录再次 PUSH 出来的新列表不会反向改写仍在栈里的旧列表。
  const entryScrollTopRef = useRef<number | null>(null)
  const nativeSearchSnapshotRef = useRef<{
    paths: ReadonlySet<string>
    query: string
    source: ReadonlySet<string>
  } | null>(null)
  const boundPropsRef = useRef(liveProps)
  const routeNoteId = descriptor.screen === "editor"
    ? resolveRouteNoteId(descriptor.rawNoteId, liveProps.allNotes.map((note) => note.id))
    : ""
  const directRouteNote = descriptor.screen === "editor"
    ? liveProps.allNotes.find((note) => note.id === routeNoteId) ?? null
    : null
  const editorSessionKeyRef = useRef<string | null>(directRouteNote?.editorSessionKey ?? directRouteNote?.id ?? null)
  if (directRouteNote) editorSessionKeyRef.current = directRouteNote.editorSessionKey ?? directRouteNote.id
  // 重命名先提交 notes 的新 id，再 replace URL。用稳定 editorSessionKey 跨过这段窗口，
  // 保留原 CodeMirror 实例，也不会把旧地址短暂渲染成“笔记不存在”。
  const routeNote = directRouteNote ?? (descriptor.screen === "editor" && editorSessionKeyRef.current
    ? liveProps.allNotes.find((note) => (note.editorSessionKey ?? note.id) === editorSessionKeyRef.current) ?? null
    : null)
  const routeAligned = descriptor.screen === "editor"
    ? liveProps.activeNote?.id === routeNote?.id || (!routeNote && liveProps.missingNoteRoute)
    : descriptor.screen === "library"
      ? liveProps.mobileScreen === "library"
      : liveProps.mobileScreen === "notes"
        && liveProps.libraryView === descriptor.view
        && liveProps.selectedFolder === descriptor.folder
  if (active && routeAligned) boundPropsRef.current = liveProps
  const boundProps = boundPropsRef.current

  useLayoutEffect(() => {
    if (!active) return
    // 这四项属于当前 history entry。POP 时先显示原 DOM，再同步全局派生值供索引查询使用，
    // 不让上一页在交接帧短暂套用离开页的筛选条件。
    liveProps.onQueryChange(query)
    liveProps.onSelectTag(selectedTag)
    liveProps.onNoteSortChange(noteSort)
    liveProps.onIncludeNestedFolderNotesChange(includeNestedFolderNotes)
  }, [active])

  const selectedFolder = descriptor.screen === "notes" ? descriptor.folder : boundProps.selectedFolder
  const libraryView = descriptor.screen === "notes" ? descriptor.view : boundProps.libraryView
  const normalizedEntryQuery = query.trim().toLocaleLowerCase()
  if (nativeSearchSnapshotRef.current?.query !== normalizedEntryQuery) nativeSearchSnapshotRef.current = null
  if (normalizedEntryQuery
    && liveProps.nativeSearchQuery === normalizedEntryQuery
    && liveProps.nativeSearchPaths
    && nativeSearchSnapshotRef.current?.source !== liveProps.nativeSearchPaths) {
    // 原生正文检索结果属于当前 history entry。别的页面改全局 query 时继续使用本页最近一次成功快照，
    // 这样侧滑露出的上一页不会先丢掉“仅正文命中”的行，再等待一次异步检索补回来。
    nativeSearchSnapshotRef.current = {
      paths: new Set(liveProps.nativeSearchPaths),
      query: normalizedEntryQuery,
      source: liveProps.nativeSearchPaths,
    }
  }
  const entryNativeSearchPaths = nativeSearchSnapshotRef.current?.paths ?? null
  const visibleNotes = useMemo(() => {
    if (descriptor.screen !== "notes") return boundProps.notes
    const normalizedQuery = normalizedEntryQuery
    const folderNotes = selectedFolder
      ? liveProps.allNotes.filter((note) => includeNestedFolderNotes
        ? noteBelongsToFolder(note, selectedFolder)
        : noteBelongsDirectlyToFolder(note, selectedFolder))
      : liveProps.allNotes
    const tagged = selectedTag ? folderNotes.filter((note) => note.tags?.includes(selectedTag)) : folderNotes
    const viewed = libraryView === "recent"
      ? sortNotes(tagged, "updated-desc", { pinnedFirst: false }).slice(0, 32)
      : libraryView === "starred" ? tagged.filter((note) => note.starred) : tagged
    const searched = normalizedQuery
      ? viewed.filter((note) => noteMatchesLibraryQuery(note, normalizedQuery, entryNativeSearchPaths))
      : viewed
    return sortNotes(searched, noteSort)
  }, [boundProps.notes, descriptor.screen, entryNativeSearchPaths, includeNestedFolderNotes, libraryView, liveProps.allNotes, normalizedEntryQuery, noteSort, selectedFolder, selectedTag])
  const noteTarget = routeNote ? normalizeNoteTarget(routeNote.title) : ""
  const backlinks = routeNote && noteTarget
    ? liveProps.allNotes.filter((note) => note.id !== routeNote.id && note.outgoingLinks?.includes(noteTarget))
    : []
  const fallback = getMobileRouteFallback(descriptor)
  const resolveRouteAsset = useCallback((source: string) => routeNote
    ? liveProps.onResolveAssetForNote(routeNote.id, source)
    : Promise.resolve(null), [liveProps.onResolveAssetForNote, routeNote?.id])
  const routeProps: WorkspaceProps & FolderTreeProps = {
    ...boundProps,
    activeNote: routeNote,
    activeNoteId: routeNote?.id ?? "",
    activeNoteLoadError: routeNote ? liveProps.noteLoadErrors[routeNote.id] ?? null : null,
    activeNoteLoading: routeNote ? liveProps.loadingNoteIds.has(routeNote.id) : false,
    allNotes: liveProps.allNotes,
    backlinks,
    folders: liveProps.folders,
    includeNestedFolderNotes,
    libraryView,
    missingNoteRoute: descriptor.screen === "editor" && !routeNote && active ? liveProps.missingNoteRoute : false,
    missingNoteSuggestions: descriptor.screen === "editor" && !routeNote && active ? liveProps.missingNoteSuggestions : [],
    mobileCanGoBack: canGoBack,
    mobileListStateKey: query.trim().toLocaleLowerCase(),
    mobileScreen: descriptor.screen,
    noteSort,
    notes: visibleNotes,
    onIncludeNestedFolderNotesChange: (include) => {
      setIncludeNestedFolderNotes(include)
      if (active) liveProps.onIncludeNestedFolderNotesChange(include)
    },
    onMobileScreenChange: () => { void liveProps.onMobileBack(fallback, canGoBack) },
    onNoteSortChange: (sort) => {
      setNoteSort(sort)
      if (active) liveProps.onNoteSortChange(sort)
    },
    onQueryChange: (nextQuery) => {
      setQuery(nextQuery)
      if (active) liveProps.onQueryChange(nextQuery)
    },
    onResolveAsset: resolveRouteAsset,
    onSelectTag: (tag) => {
      setSelectedTag(tag)
      if (active) liveProps.onSelectTag(tag)
    },
    onUpdateNote: (patch) => { if (routeNote) liveProps.onUpdateNoteById(routeNote.id, patch) },
    query,
    saveState: routeNote ? liveProps.saveStates[routeNote.id] ?? boundProps.saveState : boundProps.saveState,
    selectedFolder,
    selectedTag,
  } as WorkspaceProps & FolderTreeProps

  if (descriptor.screen === "library") {
    const libraryStateKey = `${liveProps.totalNoteCount}\u0000${liveProps.folders.map((folder) => folder.path).join("\u0000")}`
    entryScrollTopRef.current ??= mobileLibraryScrollMemory.get(libraryStateKey)
    return <MobileLibrary {...routeProps} initialScrollTop={entryScrollTopRef.current} navigationOpen={navigationOpen} onNavigationOpenChange={onNavigationOpenChange} onScrollPositionChange={(scrollTop) => { entryScrollTopRef.current = scrollTop; mobileLibraryScrollMemory.set(libraryStateKey, scrollTop) }} />
  }
  if (descriptor.screen === "notes") {
    const listStateKey = `${libraryView}\u0000${selectedFolder ?? "__all__"}\u0000${query.trim().toLocaleLowerCase()}`
    entryScrollTopRef.current ??= mobileNoteListScrollMemory.get(listStateKey)
    return <MobileNoteList {...routeProps} initialScrollTop={entryScrollTopRef.current} navigationOpen={navigationOpen} onNavigationOpenChange={onNavigationOpenChange} onScrollPositionChange={(scrollTop) => { entryScrollTopRef.current = scrollTop; mobileNoteListScrollMemory.set(listStateKey, scrollTop) }} />
  }
  if (!routeNote) {
    return <EmptyNoteEditor backLabel={backLabel} canCreateNote={routeProps.canCreateNote} canRefresh={Boolean(routeProps.activeCacheId)} hasNotes={routeProps.totalNoteCount > 0} isLoading={routeProps.isRefreshingVault} missing={routeProps.missingNoteRoute} onBack={() => { void routeProps.onMobileBack(fallback, canGoBack) }} onOpenSettings={routeProps.onOpenSettings} onRefresh={routeProps.onRefreshVault} onSelectNote={routeProps.onSelectNote} suggestions={routeProps.missingNoteSuggestions} />
  }
  if (routeProps.activeNoteLoading || routeProps.activeNoteLoadError) {
    return <NoteDocumentState backLabel={backLabel} error={routeProps.activeNoteLoadError} loading={routeProps.activeNoteLoading} onBack={() => { void routeProps.onMobileBack(fallback, canGoBack) }} onRetry={routeProps.onRetryNoteLoad} title={routeNote.title} />
  }
  return (
    <NoteEditor
      active={active}
      activeCacheId={routeProps.activeCacheId}
      backlinks={backlinks}
      backLabel={backLabel}
      canInsertAttachment={routeProps.canInsertAttachment}
      canManageNote={Boolean(routeNote.remotePath && !routeNote.readOnly)}
      cloudConnected={routeProps.cloudConnected}
      compact
      isManagingNote={routeProps.isManagingNote}
      markdownSourceMode={routeProps.markdownSourceMode}
      moveTargets={routeProps.folders}
      note={routeNote}
      noteViewMode={routeProps.noteViewMode}
      onBack={() => { void routeProps.onMobileBack(fallback, canGoBack) }}
      onDeleteNote={routeProps.onDeleteNote}
      onExportNote={routeProps.onExportNote}
      onFormat={routeProps.onFormat}
      onFormatNote={routeProps.onFormatNote}
      attachmentQueue={routeProps.attachmentQueue}
      onLoadWikiNote={routeProps.onLoadWikiNote}
      onMoveNote={routeProps.onMoveNote}
      onMarkdownSourceModeChange={routeProps.onMarkdownSourceModeChange}
      onNoteViewModeChange={routeProps.onNoteViewModeChange}
      onOpenSourceFile={routeProps.onOpenSourceFile}
      onOpenWikiLink={routeProps.onOpenWikiLink}
      onReloadNote={routeProps.onReloadNote}
      onRenameNote={(title) => liveProps.onRenameNoteFromEditor(routeNote.id, title)}
      onResolveAsset={routeProps.onResolveAsset}
      onResolveConflict={routeProps.onResolveConflict}
      onResolveWikiNote={routeProps.onResolveWikiNote}
      onRestoreNoteVersion={routeProps.onRestoreNoteVersion}
      onSelectFolder={routeProps.onSelectFolder}
      onSelectNote={routeProps.onSelectNote}
      onSync={routeProps.onRefreshVault}
      onToggleTask={routeProps.onToggleNoteTask
        ? (line, checked) => routeProps.onToggleNoteTask?.(routeNote.id, line, checked)
        : undefined}
      onUpdateNote={routeProps.onUpdateNote}
      saveState={routeProps.saveState}
      syncing={routeProps.isRefreshingVault}
      wikiLinkNotes={routeProps.allNotes}
    />
  )
}

function BacklinksPanel({ backlinks, onSelectNote }: { backlinks: Note[]; onSelectNote: (note: Note) => void }) {
  // 没有反向链接时整块不渲染：这段常驻的空占位会把每篇笔记的正文尾部顶起一屏边距。
  if (backlinks.length === 0) return null
  return (
    <section className="backlinks-panel">
      <div className="backlinks-title">
        <Link2 />
        <strong>反向链接</strong>
        <span>{backlinks.length}</span>
      </div>
      <div className="backlinks-list">
        {backlinks.map((note) => (
          <button key={note.id} onClick={() => onSelectNote(note)} type="button">
            <strong>{note.title || "未命名笔记"}</strong>
            <span>{note.preview}</span>
          </button>
        ))}
      </div>
    </section>
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
  // props.folders 已在共享层按本地偏好排好序（根目录置顶），两个布局读同一份状态，这里不再各自维护。
  const orderedRootFolders = useMemo(
    () => getDirectChildVaultFolders(props.folders, null),
    [props.folders],
  )
  const sortableFolderPaths = useMemo(
    () => orderedRootFolders.filter((folder) => folder.path !== SYSTEM_ROOT_FOLDER_PATH).map((folder) => folder.path),
    [orderedRootFolders],
  )

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
          <Button aria-label="全局搜索" onClick={props.onOpenGlobalSearch} size="icon" variant="ghost"><Globe /></Button>
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
              disabled={sortableFolderPaths.length < 2}
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
            <FolderSortDndContext
              enabled={managingFolders}
              folderOrderKey={props.folderOrderKey}
              key={props.folderOrderKey}
              onCommit={props.onFolderOrderChange}
              sortableFolderPaths={sortableFolderPaths}
            >
              <SortableContext items={sortableFolderPaths} strategy={verticalListSortingStrategy}>
                {orderedRootFolders.map((folder) => managingFolders && folder.path === SYSTEM_ROOT_FOLDER_PATH ? (
                  <MobileLibraryRow
                    count={folder.count}
                    icon={Folder}
                    key={folder.path}
                    label={folder.label}
                    trailing={<span aria-label="系统目录，不可编辑" className="mobile-system-folder"><LockKeyhole /></span>}
                  />
                ) : managingFolders ? (
                  // 排序只改本地展示偏好：无编辑权限（本地只读缓存等）也提供手柄；
                  // 重命名/删除入口在 SortableMobileFolderRow 内按 mode 单独判断，不扩大写权限。
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
                    onLongPress={folder.path === SYSTEM_ROOT_FOLDER_PATH || !props.folderManagementMode ? undefined : () => setActionFolder(folder)}
                    onClick={() => selectFolder(folder.path)}
                  />
                ))}
              </SortableContext>
            </FolderSortDndContext>
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
  // null 表示当前库没有编辑权限（如本地只读缓存）：仍允许拖动排序，但不显示重命名/删除入口。
  mode: "local" | "webdav" | null
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
            {mode ? (
              <MobileFolderActions
                disabled={disabled}
                folderPath={folder.path}
                mode={mode}
                onDelete={onDelete}
                onRename={onRename}
              />
            ) : null}
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
  const [request, setRequest] = useState<{ initialName: string; kind: "delete" | "rename"; mode: "local" | "webdav"; sourcePath: string } | null>(null)
  const [name, setName] = useState(currentName)

  const openRename = () => {
    setName(currentName)
    // 移动端菜单关闭会触发重渲染，显式快照避免随后导航改变重命名目标。
    setRequest({ initialName: currentName, kind: "rename", mode, sourcePath: folderPath })
  }
  const requestName = request?.initialName ?? currentName
  const requestMode = request?.mode ?? mode
  const requestPath = request?.sourcePath ?? folderPath

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
          <DropdownMenuItem className="mobile-folder-delete-action" onSelect={() => setRequest({ initialName: currentName, kind: "delete", mode, sourcePath: folderPath })}><Trash2 />删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={(open) => { if (!open) setRequest(null) }} open={request !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{request?.kind === "delete" ? `删除“${requestName}”` : "重命名文件夹"}</DialogTitle>
            <DialogDescription>
              {request?.kind === "delete"
                ? requestMode === "local"
                  ? "文件夹及其中的全部文件会移动到 Swell Note 回收站，可在保留期内恢复。"
                  : "该目录中的笔记将进入待同步删除；同步前仍可从回收站恢复。"
                : requestMode === "local"
                  ? `将重命名“${requestPath}”，并同步更新当前笔记索引。`
                  : `“${requestPath}”及其子目录会先在本机排队，点击同步后整体移动坚果云目录。`}
            </DialogDescription>
          </DialogHeader>
          {request?.kind === "rename" ? (
            <Input autoFocus aria-label="新文件夹名称" onChange={(event) => setName(event.target.value)} value={name} />
          ) : null}
          <DialogFooter>
            <Button onClick={() => setRequest(null)} variant="ghost">取消</Button>
            {request?.kind === "delete" ? (
              <Button onClick={() => { setRequest(null); onDelete(requestPath) }} variant="destructive">
                {requestMode === "local" ? "移入回收站" : "确认移入待删除"}
              </Button>
            ) : (
              <Button disabled={!name.trim() || name.trim() === requestName} onClick={() => { setRequest(null); onRename(requestPath, name) }}>
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
  searchRevealRequest?: SearchRevealRequest | null
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
  const title = getLibraryLabel(props.libraryView, props.selectedFolder)

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
    const fallback = parentFolder ? `/notes/folder/${encodeURIComponent(parentFolder)}` : "/notes"
    void props.onMobileBack(fallback, props.mobileCanGoBack)
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
          <button onClick={props.onOpenMobileLibrary} type="button">笔记库</button>
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
              query={props.query}
              searchRevealRequest={props.searchRevealRequest}
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
        onTogglePin={props.onToggleNotePin}
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
    if (controlledOpen === undefined) setOpen(false)
    onNavigate(path)
  }
  const selectView = (view: LibraryView, path: string) => {
    if (controlledOpen === undefined) setOpen(false)
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
  query = "",
  searchRevealRequest,
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
  query?: string
  searchRevealRequest?: SearchRevealRequest | null
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
    // 初始估高与 CSS 行高保持一致，滚动位置恢复时才不会在真实测量后跳动。
    estimateSize: (index) => items[index]?.kind === "heading"
      ? 35
      : items[index]?.kind === "folder" ? mobile ? 58 : 56 : 64,
    getItemKey: (index) => items[index]?.key ?? index,
    getScrollElement: () => viewportRef.current,
    // 挂载首帧就把渲染窗口摆到恢复位置；否则先按顶部渲染、滚动恢复再逐帧追上来，
    // 侧滑返回交接与返回键回列表时都会看到列表从顶部闪跳回中段。
    initialOffset: () => initialScrollOffset,
    overscan: 8,
  })
  const lastNoteRevealRef = useRef(0)

  useLayoutEffect(() => {
    if (!searchRevealRequest) return
    if (lastNoteRevealRef.current === searchRevealRequest.requestId) return
    const targetIndex = items.findIndex((item) => item.kind === "note" && item.note.id === searchRevealRequest.noteId)
    if (targetIndex < 0) return
    // 虚拟列表没有目标 DOM 时由 virtualizer 直接改真实滚动宿主，不能只调用 scrollIntoView。
    virtualizer.scrollToIndex(targetIndex, { align: "center" })
    lastNoteRevealRef.current = searchRevealRequest.requestId
  }, [items, searchRevealRequest?.requestId, searchRevealRequest?.noteId, virtualizer])

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
              <NoteListRow active={item.note.id === activeNoteId} contextActions={noteContextActions} note={item.note} onLongPress={onNoteLongPress} onSelect={onSelectNote} query={query} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function revealWithinViewport(viewport: HTMLElement, element: HTMLElement) {
  const viewportRect = viewport.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const top = viewport.scrollTop + elementRect.top - viewportRect.top
  const bottom = top + elementRect.height
  if (top < viewport.scrollTop) viewport.scrollTop = top
  else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = bottom - viewport.clientHeight
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

// 列表标题与移动端返回标签共用的文案：选中目录时用目录名，跨目录视图用视图名。
// (all, null) 只可能是显式进入的 `/notes/view/all`：未选中态（`/notes`）要么跟随了
// 打开的笔记——那时 selectedFolder 非空，要么由 `noSelection` 提前 return 掉标题栏，
// 根本走不到这里。
function getLibraryLabel(libraryView: LibraryView, selectedFolder: string | null) {
  if (selectedFolder) {
    const segments = getNoteBreadcrumbSegments(selectedFolder)
    return segments[segments.length - 1] ?? selectedFolder
  }
  if (libraryView === "recent") return "最近更新"
  if (libraryView === "starred") return "收藏"
  return "全部笔记"
}

function getMobileBackLabel(libraryView: LibraryView, selectedFolder: string | null) {
  return getLibraryLabel(libraryView, selectedFolder)
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
