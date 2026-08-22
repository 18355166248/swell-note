import { lazy, Suspense, useRef, type ReactNode } from "react"
import {
  ArrowLeft,
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
  MoreHorizontal,
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
import type { Note } from "@/types/note"
import type { MarkdownEditorHandle } from "@/components/editor/markdown-editor"

// CodeMirror 体积较大，延迟到编辑区真正渲染时再加载，避免拖慢首屏资料库与列表。
const MarkdownEditor = lazy(() => import("@/components/editor/markdown-editor"))

export type MobileScreen = "library" | "notes" | "editor"

type WorkspaceProps = {
  activeNote: Note
  activeNoteId: string
  connectionLabel: string
  connected: boolean
  isOpeningVault: boolean
  localVaultSupported: boolean
  mobileScreen: MobileScreen
  mobileConnectionLabel: string
  notes: Note[]
  onCreateNote: () => void
  onFormat: (syntax: string) => void
  onMobileScreenChange: (screen: MobileScreen) => void
  onOpenLocalVault: () => void
  onOpenSettings: () => void
  onQueryChange: (query: string) => void
  onSelectNote: (note: Note) => void
  onUpdateNote: (patch: Partial<Note>) => void
  query: string
  syncLabel: string
  vaultError: string | null
}

const folders = [
  { label: "产品规划", count: 12, children: ["跨端产品", "桌面端", "移动端"] },
  { label: "技术方案", count: 15 },
  { label: "设计资源", count: 26 },
  { label: "会议记录", count: 9 },
  { label: "个人知识库", count: 54 },
  { label: "读书笔记", count: 37 },
]

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
        noteCount={props.notes.length}
        onCreateNote={props.onCreateNote}
        onOpenLocalVault={props.onOpenLocalVault}
        onOpenSettings={props.onOpenSettings}
        isOpeningVault={props.isOpeningVault}
        localVaultSupported={props.localVaultSupported}
        syncLabel={props.syncLabel}
        vaultError={props.vaultError}
      />
      <NoteListPanel
        activeNoteId={props.activeNoteId}
        notes={props.notes}
        onQueryChange={props.onQueryChange}
        onSelectNote={props.onSelectNote}
        query={props.query}
      />
      <NoteEditor
        note={props.activeNote}
        onFormat={props.onFormat}
        onUpdateNote={props.onUpdateNote}
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
  isOpeningVault: boolean
  localVaultSupported: boolean
  noteCount: number
  onCreateNote: () => void
  onOpenLocalVault: () => void
  onOpenSettings: () => void
  syncLabel: string
  vaultError: string | null
}

function LibraryPanel({
  connected,
  connectionLabel,
  isOpeningVault,
  localVaultSupported,
  noteCount,
  onCreateNote,
  onOpenLocalVault,
  onOpenSettings,
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
          <LibraryRow active count={noteCount} icon={FileText} label="全部笔记" />
          <LibraryRow count={Math.min(noteCount, 32)} icon={CheckCircle2} label="最近更新" />
          <LibraryRow count={8} icon={Star} label="收藏" />
          <LibraryRow count={6} icon={Trash2} label="回收站" />

          <div className="library-section-title">
            <span>文件夹</span>
            <Button aria-label="新建文件夹" size="icon-xs" variant="ghost"><Plus /></Button>
          </div>

          {folders.map((folder, index) => (
            <div key={folder.label}>
              <LibraryRow
                count={folder.count}
                expanded={index === 0}
                icon={index === 0 ? FolderOpen : Folder}
                label={folder.label}
              />
              {folder.children ? (
                <div className="folder-children">
                  {folder.children.map((child, childIndex) => (
                    <LibraryRow
                      active={childIndex === 0}
                      count={[8, 4, 4][childIndex]}
                      icon={Folder}
                      key={child}
                      label={child}
                    />
                  ))}
                </div>
              ) : null}
            </div>
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
  expanded?: boolean
  icon: typeof FileText
  label: string
}

function LibraryRow({ active = false, count, expanded, icon: Icon, label }: LibraryRowProps) {
  return (
    <button className="library-row" data-active={active} type="button">
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
  notes: Note[]
  onQueryChange: (query: string) => void
  onSelectNote: (note: Note) => void
  query: string
}

function NoteListPanel({
  activeNoteId,
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
          <span className="eyebrow">产品规划 / 跨端产品</span>
          <h2>全部笔记</h2>
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
  compact?: boolean
  note: Note
  onBack?: () => void
  onFormat: (syntax: string) => void
  onUpdateNote: (patch: Partial<Note>) => void
}

function NoteEditor({ compact = false, note, onBack, onFormat, onUpdateNote }: NoteEditorProps) {
  const readOnly = note.source === "webdav" || note.source === "local"
  const editorRef = useRef<MarkdownEditorHandle>(null)

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
          <span className="saved-state">
            <Check />
            {note.source === "webdav" ? "云端只读" : note.source === "local" ? "本地只读" : "已保存"}
          </span>
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
              <DropdownMenuItem>移动到文件夹</DropdownMenuItem>
              <DropdownMenuItem>查看历史版本</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">移到回收站</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {!compact ? <FormattingToolbar onFormat={handleFormat} /> : null}

      <ScrollArea className="editor-scroll">
        <div className="document-canvas">
          <input
            aria-label="笔记标题"
            className="document-title"
            onChange={(event) => onUpdateNote({ title: event.target.value })}
            readOnly={readOnly}
            value={note.title}
          />
          <div className="document-meta">
            <span>{note.updatedAt === "刚刚" ? "刚刚编辑" : note.updatedAt}</span>
            <span>·</span>
            <span>{note.content.length} 字符</span>
            <span>·</span>
            <span>{deriveFolder(note)}</span>
          </div>
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
        </div>
      </ScrollArea>

      {compact ? <FormattingToolbar mobile onFormat={handleFormat} /> : (
        <footer className="editor-statusbar">
          <span>{note.content.length} 字</span>
          <span>Markdown</span>
          <span className="ml-auto">行 1，列 1</span>
        </footer>
      )}
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
  return (
    <div className="mobile-workspace" data-screen={props.mobileScreen}>
      {props.mobileScreen === "library" ? <MobileLibrary {...props} /> : null}
      {props.mobileScreen === "notes" ? <MobileNoteList {...props} /> : null}
      {props.mobileScreen === "editor" ? (
        <NoteEditor
          compact
          note={props.activeNote}
          onBack={() => props.onMobileScreenChange("notes")}
          onFormat={props.onFormat}
          onUpdateNote={props.onUpdateNote}
        />
      ) : null}
    </div>
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
            <MobileLibraryRow count={props.notes.length} icon={FileText} label="全部笔记" onClick={() => props.onMobileScreenChange("notes")} />
            <MobileLibraryRow count={32} icon={CheckCircle2} label="最近更新" onClick={() => props.onMobileScreenChange("notes")} />
            <MobileLibraryRow count={8} icon={Star} label="收藏" onClick={() => props.onMobileScreenChange("notes")} />
            <MobileLibraryRow count={6} icon={Trash2} label="回收站" />
          </div>

          <div className="mobile-section-heading"><span>文件夹</span><Button aria-label="新建文件夹" size="icon-sm" variant="ghost"><Plus /></Button></div>
          <div className="mobile-folder-list">
            {folders.map((folder, index) => (
              <MobileLibraryRow
                count={folder.count}
                icon={index === 0 ? FolderOpen : Folder}
                key={folder.label}
                label={folder.label}
                onClick={() => props.onMobileScreenChange("notes")}
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
  icon: typeof FileText
  label: string
  onClick?: () => void
}

function MobileLibraryRow({ count, icon: Icon, label, onClick }: MobileLibraryRowProps) {
  return (
    <button className="mobile-library-row" onClick={onClick} type="button">
      <Icon />
      <span>{label}</span>
      {typeof count === "number" ? <small>{count}</small> : null}
      <ChevronRight />
    </button>
  )
}

function MobileNoteList(props: WorkspaceProps) {
  const groups = groupNotes(props.notes)
  return (
    <section className="mobile-screen">
      <header className="mobile-titlebar">
        <Button aria-label="返回笔记库" onClick={() => props.onMobileScreenChange("library")} size="icon" variant="ghost"><ArrowLeft /></Button>
        <h1>全部笔记</h1>
        <div>
          <Button aria-label="筛选" size="icon" variant="ghost"><Filter /></Button>
          <Button aria-label="排序" size="icon" variant="ghost"><ListFilter /></Button>
        </div>
      </header>
      <div className="mobile-list-search">
        <div className="note-search-wrap"><Search /><Input onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索笔记" value={props.query} /></div>
        <Button aria-label="筛选选项" size="icon" variant="ghost"><SlidersHorizontal /></Button>
      </div>
      <ScrollArea className="mobile-scroll-content">
        <div className="mobile-note-groups">
          {groups.map((group) => (
            <section key={group.label}>
              <div className="note-group-label"><span>{group.label}</span></div>
              {group.notes.map((note) => (
                <NoteListRow
                  active={note.id === props.activeNoteId}
                  key={note.id}
                  note={note}
                  onSelect={props.onSelectNote}
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
