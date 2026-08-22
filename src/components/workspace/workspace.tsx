import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  Home,
  List,
  ListFilter,
  Link,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Eye,
  PencilLine,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Tags,
  Trash2,
  UserRound,
} from "lucide-react"

import swellNoteLogo from "@/assets/brand/swell-note-logo-ribbon-s.svg"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Note, NoteSaveState } from "@/types/note"
import type { VaultAsset } from "@/services/vault/vault-adapter"
import type { VaultFolder } from "@/services/search/vault-folders"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"

// CodeMirror 体积较大，延迟到编辑区真正渲染时再加载，避免拖慢首屏资料库与列表。
const MarkdownEditor = lazy(() => import("@/components/editor/markdown-editor"))
const MarkdownPreview = lazy(() => import("@/components/editor/markdown-preview"))

export type MobileScreen = "library" | "notes" | "editor"

type WorkspaceProps = {
  activeNote: Note
  activeNoteId: string
  backlinks: Note[]
  connectionLabel: string
  connected: boolean
  folders: VaultFolder[]
  isOpeningVault: boolean
  localVaultSupported: boolean
  mobileScreen: MobileScreen
  mobileConnectionLabel: string
  mobileListStateKey: string
  notes: Note[]
  onCreateNote: () => void
  onFormat: (syntax: string) => void
  onMobileScreenChange: (screen: MobileScreen) => void
  onOpenLocalVault: () => void
  onOpenWikiLink: (target: string) => void
  onOpenSettings: () => void
  onQueryChange: (query: string) => void
  onReloadNote: () => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onSelectFolder: (folder: string | null) => void
  onSelectNote: (note: Note) => void
  onUpdateNote: (patch: Partial<Note>) => void
  query: string
  saveState: NoteSaveState
  selectedFolder: string | null
  syncLabel: string
  totalNoteCount: number
  vaultError: string | null
}

export function Workspace(props: WorkspaceProps) {
  return (
    <main className="workspace-root">
      <DesktopWorkspace {...props} />
      <MobileWorkspace {...props} />
    </main>
  )
}

function DesktopWorkspace(props: WorkspaceProps) {
  return (
    <div className="desktop-workspace">
      <NavigationRail connected={props.connected} onOpenSettings={props.onOpenSettings} />
      <LibraryPanel
        connected={props.connected}
        connectionLabel={props.connectionLabel}
        folders={props.folders}
        noteCount={props.totalNoteCount}
        onCreateNote={props.onCreateNote}
        onOpenLocalVault={props.onOpenLocalVault}
        onOpenSettings={props.onOpenSettings}
        onSelectFolder={props.onSelectFolder}
        selectedFolder={props.selectedFolder}
        isOpeningVault={props.isOpeningVault}
        localVaultSupported={props.localVaultSupported}
        syncLabel={props.syncLabel}
        vaultError={props.vaultError}
      />
      <NoteListPanel
        activeNoteId={props.activeNoteId}
        notes={props.notes}
        folderLabel={props.selectedFolder ?? "全部笔记"}
        onQueryChange={props.onQueryChange}
        onSelectNote={props.onSelectNote}
        query={props.query}
      />
      <NoteEditor
        backlinks={props.backlinks}
        note={props.activeNote}
        onFormat={props.onFormat}
        onOpenWikiLink={props.onOpenWikiLink}
        onSelectNote={props.onSelectNote}
        onUpdateNote={props.onUpdateNote}
        onReloadNote={props.onReloadNote}
        onResolveAsset={props.onResolveAsset}
        saveState={props.saveState}
      />
    </div>
  )
}

function NavigationRail({
  connected,
  onOpenSettings,
}: Pick<WorkspaceProps, "connected" | "onOpenSettings">) {
  return (
    <aside className="navigation-rail">
      <img alt="Swell Note" className="rail-logo" src={swellNoteLogo} />
      <nav className="rail-navigation" aria-label="主导航">
        <RailButton icon={Home} label="首页" />
        <RailButton active icon={FileText} label="笔记" />
        <RailButton icon={CheckCircle2} label="待办" />
        <RailButton icon={Tags} label="标签" />
      </nav>
      <div className="rail-footer">
        <RailButton
          indicator={connected}
          icon={Cloud}
          label="同步"
          onClick={onOpenSettings}
        />
        <RailButton icon={Settings} label="设置" onClick={onOpenSettings} />
        <RailButton icon={CircleHelp} label="帮助" />
      </div>
    </aside>
  )
}

type RailButtonProps = {
  active?: boolean
  icon: typeof Home
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
  connected: boolean
  connectionLabel: string
  folders: VaultFolder[]
  isOpeningVault: boolean
  localVaultSupported: boolean
  noteCount: number
  onCreateNote: () => void
  onOpenLocalVault: () => void
  onOpenSettings: () => void
  onSelectFolder: (folder: string | null) => void
  selectedFolder: string | null
  syncLabel: string
  vaultError: string | null
}

function LibraryPanel({
  connected,
  connectionLabel,
  folders,
  isOpeningVault,
  localVaultSupported,
  noteCount,
  onCreateNote,
  onOpenLocalVault,
  onOpenSettings,
  onSelectFolder,
  selectedFolder,
  syncLabel,
  vaultError,
}: LibraryPanelProps) {
  return (
    <aside className="library-panel">
      <div className="pane-header library-titlebar">
        <div>
          <span className="eyebrow">工作区</span>
          <h1>笔记库</h1>
        </div>
        <Button aria-label="新建文件夹" size="icon-sm" variant="ghost">
          <Plus />
        </Button>
      </div>

      <div className="library-actions">
        <Button className="new-note-button" onClick={onCreateNote}>
          <Plus data-icon="inline-start" />
          新建笔记
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
        {vaultError ? <p className="vault-error">{vaultError}</p> : null}
      </div>

      <ScrollArea className="library-scroll">
        <nav className="library-navigation" aria-label="笔记库导航">
          <LibraryRow active={selectedFolder === null} count={noteCount} icon={FileText} label="全部笔记" onClick={() => onSelectFolder(null)} />
          <LibraryRow count={Math.min(noteCount, 32)} icon={CheckCircle2} label="最近更新" />
          <LibraryRow count={8} icon={Star} label="收藏" />
          <LibraryRow count={6} icon={Trash2} label="回收站" />

          <div className="library-section-title">
            <span>文件夹</span>
            <Button aria-label="新建文件夹" size="icon-xs" variant="ghost"><Plus /></Button>
          </div>

          {folders.map((folder) => (
            <LibraryRow
              active={selectedFolder === folder.path}
              count={folder.count}
              depth={folder.depth}
              expanded={folder.hasChildren}
              icon={selectedFolder === folder.path ? FolderOpen : Folder}
              key={folder.path}
              label={folder.label}
              onClick={() => onSelectFolder(folder.path)}
            />
          ))}
        </nav>
      </ScrollArea>

      <button className="sync-summary" onClick={onOpenSettings} type="button">
        <span className="sync-summary-dot" data-connected={connected} />
        <span className="min-w-0">
          <strong>{connectionLabel}</strong>
          <small>{syncLabel}</small>
        </span>
        <ChevronRight />
      </button>
    </aside>
  )
}

type LibraryRowProps = {
  active?: boolean
  count?: number
  depth?: number
  expanded?: boolean
  icon: typeof FileText
  label: string
  onClick?: () => void
}

function LibraryRow({ active = false, count, depth = 0, expanded, icon: Icon, label, onClick }: LibraryRowProps) {
  return (
    <button className="library-row" data-active={active} data-depth={Math.min(depth, 3)} onClick={onClick} type="button">
      {typeof expanded === "boolean" ? (
        expanded ? <ChevronDown className="library-chevron" /> : <ChevronRight className="library-chevron" />
      ) : <span className="library-chevron" />}
      <Icon />
      <span>{label}</span>
      {typeof count === "number" ? <small>{count}</small> : null}
    </button>
  )
}

type NoteListPanelProps = {
  activeNoteId: string
  folderLabel: string
  notes: Note[]
  onQueryChange: (query: string) => void
  onSelectNote: (note: Note) => void
  query: string
}

function NoteListPanel({
  activeNoteId,
  folderLabel,
  notes,
  onQueryChange,
  onSelectNote,
  query,
}: NoteListPanelProps) {
  const groups = groupNotes(notes)

  return (
    <section className="note-list-panel">
      <div className="pane-header note-list-titlebar">
        <div>
          <span className="eyebrow">当前目录</span>
          <h2>{folderLabel}</h2>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="筛选与排序" size="icon-sm" variant="ghost"><ListFilter /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>按更新时间排序</DropdownMenuItem>
            <DropdownMenuItem>按创建时间排序</DropdownMenuItem>
            <DropdownMenuItem>按标题排序</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          {groups.map((group) => (
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
          ))}
        </div>
      </ScrollArea>
    </section>
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
  compact?: boolean
  note: Note
  onBack?: () => void
  onFormat: (syntax: string) => void
  onOpenWikiLink: (target: string) => void
  onReloadNote: () => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onSelectNote: (note: Note) => void
  onUpdateNote: (patch: Partial<Note>) => void
  saveState: NoteSaveState
}

function NoteEditor({ backlinks, compact = false, note, onBack, onFormat, onOpenWikiLink, onReloadNote, onResolveAsset, onSelectNote, onUpdateNote, saveState }: NoteEditorProps) {
  const readOnly = note.readOnly ?? note.source === "webdav"
  const titleReadOnly = note.source === "local" || note.source === "webdav"
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const [previewing, setPreviewing] = useState(false)

  const handleFormat = (syntax: string) => {
    if (!syntax) return
    if (editorRef.current) {
      editorRef.current.insertText(syntax)
      return
    }
    onFormat(syntax)
  }

  return (
    <article className="note-editor" data-compact={compact}>
      <header className="editor-titlebar">
        {onBack ? (
          <Button aria-label="返回全部笔记" onClick={onBack} size="icon" variant="ghost"><ArrowLeft /></Button>
        ) : (
          <div className="editor-breadcrumb"><FileText /><span>产品规划</span><ChevronRight /><span>跨端产品</span></div>
        )}
        {onBack ? <span className="mobile-back-label">全部笔记</span> : null}
        <div className="editor-actions">
          <SaveStateIndicator note={note} state={saveState} />
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
              {note.remotePath ? (
                <DropdownMenuItem
                  disabled={saveState.status === "saving"}
                  onClick={onReloadNote}
                >
                  重新加载源文件
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem>移动到文件夹</DropdownMenuItem>
              <DropdownMenuItem>查看历史版本</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">移到回收站</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {!compact && !previewing ? <FormattingToolbar onFormat={handleFormat} /> : null}

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
                <MarkdownEditor
                  onChange={(content) => onUpdateNote({
                    content,
                    preview: content.replace(/^#+\s*/gm, "").slice(0, 90),
                  })}
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

      {compact && !previewing ? <FormattingToolbar mobile onFormat={handleFormat} /> : !compact ? (
        <footer className="editor-statusbar">
          <span>{note.content.length} 字</span>
          <span>Markdown</span>
          <span className="ml-auto">行 1，列 1</span>
        </footer>
      ) : null}
    </article>
  )
}

type FormattingToolbarProps = {
  mobile?: boolean
  onFormat: (syntax: string) => void
}

function FormattingToolbar({ mobile = false, onFormat }: FormattingToolbarProps) {
  return (
    <div className="formatting-toolbar" data-mobile={mobile}>
      <FormatButton label="二级标题" onClick={() => onFormat("\n## ")}>H2</FormatButton>
      <FormatButton label="三级标题" onClick={() => onFormat("\n### ")}>H3</FormatButton>
      <span className="toolbar-divider" />
      <FormatButton icon={List} label="无序列表" onClick={() => onFormat("\n- ")} />
      <FormatButton icon={CheckCircle2} label="任务列表" onClick={() => onFormat("\n- [ ] ")} />
      <FormatButton icon={Code2} label="代码" onClick={() => onFormat("\n```\n\n```\n")} />
      <FormatButton icon={Link} label="链接" onClick={() => onFormat("[链接](https://)")} />
      <FormatButton icon={MoreHorizontal} label="更多格式" onClick={() => onFormat("")} />
    </div>
  )
}

type FormatButtonProps = {
  children?: ReactNode
  icon?: typeof List
  label: string
  onClick: () => void
}

function FormatButton({ children, icon: Icon, label, onClick }: FormatButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button aria-label={label} onClick={onClick} type="button">
          {Icon ? <Icon /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function MobileWorkspace(props: WorkspaceProps) {
  const noteListPositionsRef = useRef(new Map<string, number>())
  // 使用与实际可见结果一致的延迟搜索键，避免输入态先更新时覆盖原列表滚动位置。
  const listStateKey = `${props.selectedFolder ?? "__all__"}\u0000${props.mobileListStateKey}`

  return (
    <div className="mobile-workspace" data-screen={props.mobileScreen}>
      {props.mobileScreen === "library" ? <MobileLibrary {...props} /> : null}
      {props.mobileScreen === "notes" ? (
        <MobileNoteList
          {...props}
          initialScrollTop={noteListPositionsRef.current.get(listStateKey) ?? 0}
          key={listStateKey}
          onScrollPositionChange={(scrollTop) => noteListPositionsRef.current.set(listStateKey, scrollTop)}
        />
      ) : null}
      {props.mobileScreen === "editor" ? (
        <NoteEditor
          backlinks={props.backlinks}
          compact
          note={props.activeNote}
          onBack={() => props.onMobileScreenChange("notes")}
          onFormat={props.onFormat}
          onOpenWikiLink={props.onOpenWikiLink}
          onReloadNote={props.onReloadNote}
          onResolveAsset={props.onResolveAsset}
          onSelectNote={props.onSelectNote}
          onUpdateNote={props.onUpdateNote}
          saveState={props.saveState}
        />
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

function SaveStateIndicator({ note, state }: { note: Note; state: NoteSaveState }) {
  const label = state.status === "saving"
    ? "正在保存"
    : state.status === "conflict"
      ? "已保留冲突副本"
      : state.status === "error"
        ? "保存失败"
        : state.status === "readonly"
          ? note.source === "webdav" ? "云端只读" : "只读"
          : "已保存"
  const Icon = state.status === "saving"
    ? LoaderCircle
    : state.status === "conflict"
      ? AlertTriangle
      : state.status === "error"
        ? AlertCircle
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

function MobileLibrary(props: WorkspaceProps) {
  return (
    <section className="mobile-screen mobile-library">
      <MobileBrandHeader
        connected={props.connected}
        mobileConnectionLabel={props.mobileConnectionLabel}
        onOpenSettings={props.onOpenSettings}
      />
      <ScrollArea className="mobile-scroll-content">
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
            <Button aria-label="筛选" size="icon" variant="ghost"><SlidersHorizontal /></Button>
          </div>
          <Button className="mobile-new-note" onClick={props.onCreateNote}>
            <Plus data-icon="inline-start" />新建笔记
          </Button>
          <Button
            className="mobile-open-vault"
            disabled={!props.localVaultSupported || props.isOpeningVault}
            onClick={props.onOpenLocalVault}
            variant="outline"
          >
            <FolderOpen data-icon="inline-start" />
            {props.isOpeningVault ? "正在读取…" : "打开本地笔记库"}
          </Button>
          {props.vaultError ? <p className="vault-error">{props.vaultError}</p> : null}

          <div className="mobile-library-rows">
            <MobileLibraryRow count={props.totalNoteCount} icon={FileText} label="全部笔记" onClick={() => props.onSelectFolder(null)} />
            <MobileLibraryRow count={32} icon={CheckCircle2} label="最近更新" onClick={() => props.onMobileScreenChange("notes")} />
            <MobileLibraryRow count={8} icon={Star} label="收藏" onClick={() => props.onMobileScreenChange("notes")} />
            <MobileLibraryRow count={6} icon={Trash2} label="回收站" />
          </div>

          <div className="mobile-section-heading"><span>文件夹</span><Button aria-label="新建文件夹" size="icon-sm" variant="ghost"><Plus /></Button></div>
          <div className="mobile-folder-list">
            {props.folders.map((folder) => (
              <MobileLibraryRow
                count={folder.count}
                depth={folder.depth}
                icon={props.selectedFolder === folder.path ? FolderOpen : Folder}
                key={folder.path}
                label={folder.label}
                onClick={() => props.onSelectFolder(folder.path)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
      <MobileBottomNav onOpenSettings={props.onOpenSettings} />
    </section>
  )
}

type MobileLibraryRowProps = {
  count?: number
  depth?: number
  icon: typeof FileText
  label: string
  onClick?: () => void
}

function MobileLibraryRow({ count, depth = 0, icon: Icon, label, onClick }: MobileLibraryRowProps) {
  return (
    <button className="mobile-library-row" data-depth={Math.min(depth, 3)} onClick={onClick} type="button">
      <Icon />
      <span>{label}</span>
      {typeof count === "number" ? <small>{count}</small> : null}
      <ChevronRight />
    </button>
  )
}

type MobileNoteListProps = WorkspaceProps & {
  initialScrollTop: number
  onScrollPositionChange: (scrollTop: number) => void
}

function MobileNoteList(props: MobileNoteListProps) {
  const groups = groupNotes(props.notes)
  const viewportRef = useRef<HTMLDivElement>(null)

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
        <h1>{props.selectedFolder ?? "全部笔记"}</h1>
        <div>
          <Button aria-label="筛选" size="icon" variant="ghost"><Filter /></Button>
          <Button aria-label="排序" size="icon" variant="ghost"><ListFilter /></Button>
        </div>
      </header>
      <div className="mobile-list-search">
        <div className="note-search-wrap"><Search /><Input onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索笔记" value={props.query} /></div>
        <Button aria-label="筛选选项" size="icon" variant="ghost"><SlidersHorizontal /></Button>
      </div>
      <ScrollArea
        className="mobile-scroll-content"
        viewportRef={viewportRef}
      >
        <div className="mobile-note-groups">
          {groups.map((group) => (
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
          ))}
        </div>
      </ScrollArea>
      <Button aria-label="新建笔记" className="mobile-fab" onClick={props.onCreateNote} size="icon-lg"><Plus /></Button>
      <MobileBottomNav onOpenSettings={props.onOpenSettings} />
    </section>
  )
}

function MobileBrandHeader({
  connected,
  mobileConnectionLabel,
  onOpenSettings,
}: Pick<WorkspaceProps, "connected" | "mobileConnectionLabel" | "onOpenSettings">) {
  return (
    <header className="mobile-brand-header">
      <img alt="Swell Note" src={swellNoteLogo} />
      <strong>Swell Note</strong>
      <button className="mobile-sync-state" onClick={onOpenSettings} type="button">
        <CheckCircle2 data-connected={connected} />
        <span>{mobileConnectionLabel}</span>
      </button>
      <Button aria-label="账户" size="icon" variant="ghost"><UserRound /></Button>
    </header>
  )
}

function MobileBottomNav({ onOpenSettings }: Pick<WorkspaceProps, "onOpenSettings">) {
  return (
    <nav className="mobile-bottom-nav" aria-label="手机主导航">
      <button className="mobile-tab" data-active type="button"><FileText /><span>笔记</span></button>
      <button className="mobile-tab" type="button"><CheckCircle2 /><span>待办</span></button>
      <button className="mobile-tab" onClick={onOpenSettings} type="button"><Settings /><span>设置</span></button>
    </nav>
  )
}

function groupNotes(notes: Note[]) {
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
