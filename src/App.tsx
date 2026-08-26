import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { Navigate, Route, Routes, useLocation, useMatch, useNavigate } from "react-router-dom"

import { Workspace, type LibraryView, type MobileScreen } from "@/components/workspace/workspace"
import {
  AboutSettingsPage,
  CacheSettingsPage,
  SettingsLayout,
  SettingsOverview,
  StorageMaintenancePage,
  SyncSettingsPage,
  TodoPage,
  TrashSettingsPage,
} from "@/components/routes/app-pages"
import { WebDavSettingsForm } from "@/components/settings/webdav-settings-form"
import { QuickWebDavConnectDialog } from "@/components/settings/quick-webdav-connect-dialog"
import { hasSavedWebDavConfig, loadWebDavConfig, type WebDavConfig } from "@/lib/webdav-config"
import { getNoteReturnRoute, getNotesListRoute } from "@/lib/note-routes"
import {
  canSelectLocalVault,
  selectLocalVaultAdapter,
} from "@/services/vault/local-vault-adapter"
import {
  VaultConflictError,
  type VaultAdapter,
  type VaultFileEntry,
} from "@/services/vault/vault-adapter"
import { resolveVaultAssetPath } from "@/services/vault/vault-path"
import {
  canWriteVaultAttachments,
  writeVaultAttachments,
} from "@/services/vault/attachment-writer"
import { createWebDavVaultAdapter } from "@/services/vault/webdav-vault-adapter"
import {
  createVaultCacheId,
  deleteVaultCache,
  deleteSyncedVaultAttachments,
  discardPendingVaultAttachments,
  listPendingVaultAttachments,
  listVaultCaches,
  loadVaultAttachment,
  loadLastVaultCache,
  loadVaultCache,
  queueVaultAttachment,
  remapVaultAttachmentNoteId,
  saveVaultCache,
  updateVaultAttachmentStatus,
  type VaultCacheSnapshot,
  type VaultCacheSummary,
} from "@/services/cache/vault-cache"
import {
  loadCachePrivacyMode,
  prepareNotesForCache,
  saveCachePrivacyMode,
  type CachePrivacyMode,
} from "@/services/cache/cache-privacy"
import {
  extractWikiLinks,
  extractFrontmatter,
  indexVaultFiles,
  normalizeNoteTarget,
} from "@/services/search/note-index"
import { sortNotes, type NoteSort } from "@/services/search/note-sort"
import {
  buildVaultFolders,
  noteBelongsDirectlyToFolder,
  noteBelongsToFolder,
} from "@/services/search/vault-folders"
import { getFolderRenameTarget } from "@/services/search/folder-rename"
import {
  clearNativeSearchIndex,
  rebuildNativeSearchIndex,
  searchNativeNoteIndex,
  supportsNativeSearchIndex,
  toNativeSearchEntry,
  upsertNativeSearchIndex,
} from "@/services/search/sqlite-note-index"
import {
  resolveQuickTaskTarget,
  setMarkdownTaskChecked,
  type MarkdownTask,
} from "@/services/tasks/markdown-tasks"
import { obsidianAnchorId, parseMarkdownNoteHref, splitWikiTarget } from "@/services/markdown/markdown-preview-utils"
import { buildNotePreview } from "@/services/markdown/note-preview"
import {
  deleteWebDavPassword,
  loadWebDavPassword,
  saveWebDavPassword,
} from "@/services/security/credential-store"
import {
  canReuseCachedContent,
  isWebDavWorkingCopy,
  remoteChangedFromBase,
  shouldReadVaultDocument,
} from "@/services/sync/webdav-working-copy"
import { summarizeWebDavSync } from "@/services/sync/sync-summary"
import { mergeMarkdownVersions } from "@/services/sync/three-way-merge"
import { appendSyncLog, clearSyncLog, loadSyncLog, type SyncLogEntry } from "@/services/sync/sync-log"
import {
  loadSyncPreferences,
  saveSyncPreferences,
  type AutoSyncMode,
} from "@/services/sync/sync-preferences"
import {
  buildLocalTrashPath,
  createTrashId,
  isTrashEntryExpired,
  type TrashEntry,
  type TrashRetentionDays,
} from "@/services/trash/trash-entry"
import { loadTrashRetention, saveTrashRetention } from "@/services/trash/trash-preferences"
import type { Note, NoteSaveState } from "@/types/note"
import "./App.css"

type ActiveCacheMeta = Pick<VaultCacheSnapshot, "id" | "label" | "lastSyncedAt" | "sourceKind">
type SyncProgress = {
  completed: number
  currentLabel: string
  phase: "attachments" | "notes" | "refreshing"
  total: number
}
type SyncRun = { cancelled: boolean }

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const notesLibraryRouteMatch = useMatch("/notes")
  const folderRouteMatch = useMatch("/notes/folder/:folderPath")
  const noteRouteMatch = useMatch("/notes/:noteId")
  const viewRouteMatch = useMatch("/notes/view/:view")
  const isNotesLibraryRoute = notesLibraryRouteMatch !== null
  const [notes, setNotes] = useState<Note[]>([])
  const [vaultDirectories, setVaultDirectories] = useState<string[]>([])
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([])
  const [trashRetention, setTrashRetention] = useState<TrashRetentionDays>(loadTrashRetention)
  const [activeNoteId, setActiveNoteId] = useState("")
  const [query, setQuery] = useState("")
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [nestedFolderNotesPath, setNestedFolderNotesPath] = useState<string | null>(null)
  const includeNestedFolderNotes = Boolean(selectedFolder && nestedFolderNotesPath === selectedFolder)
  const [libraryView, setLibraryView] = useState<LibraryView>("all")
  const [noteSort, setNoteSort] = useState<NoteSort>("updated-desc")
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>("library")
  const [isCreatingNote, setIsCreatingNote] = useState(false)
  const [isManagingNote, setIsManagingNote] = useState(false)
  const [isOpeningVault, setIsOpeningVault] = useState(false)
  const [isRefreshingVault, setIsRefreshingVault] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [webDavConfigured, setWebDavConfigured] = useState(hasSavedWebDavConfig)
  const [quickConnectOpen, setQuickConnectOpen] = useState(false)
  const [vaultNoteCount, setVaultNoteCount] = useState(0)
  const [vaultSession, setVaultSession] = useState<VaultAdapter | null>(null)
  const [vaultCaches, setVaultCaches] = useState<VaultCacheSummary[]>([])
  const [activeCacheMeta, setActiveCacheMeta] = useState<ActiveCacheMeta | null>(null)
  const [cacheReady, setCacheReady] = useState(false)
  const [cachePrivacyMode, setCachePrivacyMode] = useState<CachePrivacyMode>(loadCachePrivacyMode)
  const [saveStates, setSaveStates] = useState<Record<string, NoteSaveState>>({})
  const [indexProgress, setIndexProgress] = useState<{ indexed: number; total: number } | null>(null)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  )
  const [autoSyncMode, setAutoSyncMode] = useState<AutoSyncMode>(() => loadSyncPreferences().autoSyncMode)
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>(loadSyncLog)
  const [pendingAttachmentCount, setPendingAttachmentCount] = useState(0)
  const [failedAttachmentCount, setFailedAttachmentCount] = useState(0)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [nativeSearchResult, setNativeSearchResult] = useState<{ paths: Set<string>; query: string } | null>(null)
  const saveTimersRef = useRef(new Map<string, number>())
  const saveQueuesRef = useRef(new Map<string, Promise<void>>())
  const loadingNoteIdsRef = useRef(new Set<string>())
  const revisionByPathRef = useRef(new Map<string, string | undefined>())
  const indexGenerationRef = useRef(0)
  const latestCacheSnapshotRef = useRef<VaultCacheSnapshot | null>(null)
  const notesRef = useRef(notes)
  const previousOnlineRef = useRef(isOnline)
  const activeSyncRunRef = useRef<SyncRun | null>(null)
  const pendingWikiAnchorRef = useRef("")
  const refreshVaultRef = useRef<(noteIds?: ReadonlySet<string>) => Promise<void>>(async () => undefined)
  notesRef.current = notes

  const applyCachedSnapshot = useCallback((snapshot: VaultCacheSnapshot) => {
    // 缓存恢复时主动断开运行时适配器，确保离线浏览不会误走本地文件或 WebDAV 写入链路。
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer)
    saveTimersRef.current.clear()
    saveQueuesRef.current.clear()
    revisionByPathRef.current.clear()
    indexGenerationRef.current += 1

    const cachedNotes = snapshot.notes.map((note) => {
      const contentIndex = note.contentLoaded && !note.tags ? indexNoteContent(note.content) : undefined
      return {
        ...note,
        ...contentIndex,
        content: note.contentLoaded
          ? note.content
          : "# 正文尚未缓存\n\n重新连接原笔记库后，可以读取这篇文档的完整内容。",
        contentLoaded: note.contentLoaded,
        // 旧缓存会在恢复时补建 Frontmatter/标签索引，不要求用户重新下载整个笔记库。
        readOnly: note.format === "canvas" || (note.source === "webdav" ? !note.contentLoaded : true),
        syncStatus: note.source === "webdav"
          ? note.syncStatus ?? (note.contentLoaded ? "synced" : undefined)
          : note.syncStatus,
      }
    })
    const restoredActiveId = cachedNotes.some((note) => note.id === snapshot.activeNoteId && note.pendingOperation !== "delete")
      ? snapshot.activeNoteId
      : cachedNotes.find((note) => note.pendingOperation !== "delete")?.id ?? ""

    setVaultSession(null)
    setActiveCacheMeta({
      id: snapshot.id,
      label: snapshot.label,
      lastSyncedAt: snapshot.lastSyncedAt,
      sourceKind: snapshot.sourceKind,
    })
    setNotes(cachedNotes)
    setVaultDirectories(snapshot.directories ?? [])
    setTrashEntries(snapshot.trash ?? [])
    setActiveNoteId(restoredActiveId)
    setVaultNoteCount(cachedNotes.filter((note) => note.pendingOperation !== "delete").length)
    setSelectedFolder(null)
    setQuery("")
    setIndexProgress(null)
    setSaveStates(Object.fromEntries(cachedNotes.map((note) => [note.id, getNoteSaveState(note)])))
    setVaultError(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    // IndexedDB 是本机离线快照；这里只恢复笔记数据与最后位置，不存储 WebDAV 密码或连接实例。
    void Promise.all([loadLastVaultCache(), listVaultCaches()])
      .then(([snapshot, caches]) => {
        if (cancelled) return
        setVaultCaches(caches)
        if (snapshot) applyCachedSnapshot(snapshot)
      })
      .catch((error) => {
        if (!cancelled) setVaultError(error instanceof Error ? error.message : "读取离线缓存失败")
      })
      .finally(() => {
        if (!cancelled) setCacheReady(true)
      })
    return () => { cancelled = true }
  }, [applyCachedSnapshot])

  useEffect(() => {
    if (!cacheReady || !activeCacheMeta) return
    const snapshot: VaultCacheSnapshot = {
      ...activeCacheMeta,
      activeNoteId,
      directories: vaultDirectories,
      notes: prepareNotesForCache(notes, cachePrivacyMode),
      savedAt: Date.now(),
      trash: trashEntries,
    }
    latestCacheSnapshotRef.current = snapshot
    const timer = window.setTimeout(() => {
      // 清除缓存会把 ref 置空；此时这批防抖写入必须作废，否则会把刚删掉的快照重新写回。
      if (!latestCacheSnapshotRef.current) return
      // 内容读取、收藏和本地编辑后统一刷新离线快照；敏感凭据不属于 Note 模型，因此不会进入缓存。
      void saveVaultCache(snapshot)
        .then(listVaultCaches)
        .then(setVaultCaches)
        .catch((error) => setVaultError(error instanceof Error ? error.message : "保存离线缓存失败"))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [activeCacheMeta, activeNoteId, cachePrivacyMode, cacheReady, notes, trashEntries, vaultDirectories])

  useEffect(() => {
    if (!activeCacheMeta || activeCacheMeta.sourceKind !== "webdav") {
      setPendingAttachmentCount(0)
      setFailedAttachmentCount(0)
      return
    }
    let cancelled = false
    void listPendingVaultAttachments(activeCacheMeta.id)
      .then((entries) => {
        if (cancelled) return
        setPendingAttachmentCount(entries.length)
        setFailedAttachmentCount(entries.filter((entry) => entry.status === "failed").length)
      })
      .catch(() => {
        if (cancelled) return
        setPendingAttachmentCount(0)
        setFailedAttachmentCount(0)
      })
    return () => { cancelled = true }
  }, [activeCacheMeta])

  useEffect(() => {
    const flushCacheWhenHidden = () => {
      if (document.visibilityState !== "hidden" || !latestCacheSnapshotRef.current) return
      // 页面进入后台时立即启动 IndexedDB 事务，缩小 450ms 防抖窗口造成的退出丢稿风险。
      void saveVaultCache({ ...latestCacheSnapshotRef.current, savedAt: Date.now() })
        .catch(() => undefined)
    }
    document.addEventListener("visibilitychange", flushCacheWhenHidden)
    return () => document.removeEventListener("visibilitychange", flushCacheWhenHidden)
  }, [])

  useEffect(() => () => {
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const updateNetworkState = () => setIsOnline(navigator.onLine)
    window.addEventListener("online", updateNetworkState)
    window.addEventListener("offline", updateNetworkState)
    return () => {
      window.removeEventListener("online", updateNetworkState)
      window.removeEventListener("offline", updateNetworkState)
    }
  }, [])

  useEffect(() => {
    if (!cacheReady) return
    // 详情路由保留进入前的目录上下文；只有明确进入列表或笔记库路由时才重建筛选状态。
    if (noteRouteMatch?.params.noteId) return
    if (folderRouteMatch?.params.folderPath) {
      setLibraryView("all")
      setSelectedFolder(decodeURIComponent(folderRouteMatch.params.folderPath))
      setMobileScreen("notes")
      return
    }
    const routeView = viewRouteMatch?.params.view
    if (routeView === "all" || routeView === "recent" || routeView === "starred") {
      setLibraryView(routeView)
      setSelectedFolder(null)
      setMobileScreen("notes")
      return
    }
    if (isNotesLibraryRoute) {
      setLibraryView("all")
      setSelectedFolder(null)
      setMobileScreen("library")
    }
  }, [cacheReady, folderRouteMatch?.params.folderPath, isNotesLibraryRoute, noteRouteMatch?.params.noteId, viewRouteMatch?.params.view])

  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase()
  const availableNotes = useMemo(
    () => notes.filter((note) => note.pendingOperation !== "delete"),
    [notes],
  )
  const folders = useMemo(
    () => buildVaultFolders(availableNotes, vaultDirectories),
    [availableNotes, vaultDirectories],
  )
  const folderNotes = selectedFolder
    ? availableNotes.filter((note) => includeNestedFolderNotes
      ? noteBelongsToFolder(note, selectedFolder)
      : noteBelongsDirectlyToFolder(note, selectedFolder))
    : availableNotes
  const taggedNotes = selectedTag
    ? folderNotes.filter((note) => note.tags?.includes(selectedTag))
    : folderNotes
  const libraryNotes = libraryView === "recent"
    ? sortNotes(taggedNotes, "updated-desc").slice(0, 32)
    : libraryView === "starred"
      ? taggedNotes.filter((note) => note.starred)
      : taggedNotes
  const availableTags = useMemo(
    () => [...new Set(availableNotes.flatMap((note) => note.tags ?? []))].sort((left, right) => left.localeCompare(right)),
    [availableNotes],
  )
  const nativeSearchPaths = nativeSearchResult?.query === normalizedQuery
    ? nativeSearchResult.paths
    : null
  const filteredNotes = normalizedQuery
    ? libraryNotes.filter((note) => nativeSearchPaths
      ? Boolean(note.remotePath && nativeSearchPaths.has(note.remotePath))
      : `${note.title} ${note.preview} ${note.searchText ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    )
    : libraryNotes
  const visibleNotes = sortNotes(filteredNotes, noteSort)
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? null
  // 待办页与快速添加共用同一个目标，避免界面提示与实际写入的文件不一致。
  const quickTaskTarget = useMemo(
    () => resolveQuickTaskTarget(activeNote, availableNotes),
    [activeNote, availableNotes],
  )
  const activeTarget = activeNote ? normalizeNoteTarget(activeNote.title) : ""
  const backlinks = useMemo(
    () => activeTarget
      ? availableNotes.filter((note) =>
          note.id !== activeNoteId && note.outgoingLinks?.includes(activeTarget),
        )
      : [],
    [activeNoteId, activeTarget, availableNotes],
  )
  const connected = vaultSession !== null && vaultNoteCount > 0

  useEffect(() => {
    if (!activeCacheMeta || !activeNote?.remotePath || !activeNote.contentLoaded || !supportsNativeSearchIndex()) return
    const timer = window.setTimeout(() => {
      void upsertNativeSearchIndex(activeCacheMeta.id, [{
        content: activeNote.content,
        noteId: activeNote.remotePath!,
        path: activeNote.remotePath!,
        tags: activeNote.tags?.join(" ") ?? "",
        title: activeNote.title,
      }]).catch(() => undefined)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeCacheMeta, activeNote?.content, activeNote?.contentLoaded, activeNote?.remotePath, activeNote?.tags, activeNote?.title])

  useEffect(() => {
    if (!normalizedQuery || !activeCacheMeta || !supportsNativeSearchIndex()) {
      setNativeSearchResult(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchNativeNoteIndex(activeCacheMeta.id, normalizedQuery)
        .then((paths) => {
          if (!cancelled && paths) setNativeSearchResult({ paths: new Set(paths), query: normalizedQuery })
        })
        .catch(() => { if (!cancelled) setNativeSearchResult(null) })
    }, 120)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [activeCacheMeta, normalizedQuery])
  const cached = !vaultSession && activeCacheMeta !== null && vaultNoteCount > 0
  const syncSummary = useMemo(() => summarizeWebDavSync(notes), [notes])
  const pendingSyncCount = syncSummary.pending + syncSummary.failed
  const conflictCount = syncSummary.conflicts
  const syncLabel = connected
    ? !isOnline
      ? `${pendingSyncCount} 篇待同步 · 当前离线`
      : conflictCount > 0
      ? `${conflictCount} 篇存在同步冲突`
      : pendingSyncCount > 0
        ? `${pendingSyncCount} 篇修改待同步`
        : indexProgress && indexProgress.indexed < indexProgress.total
          ? `正在索引 ${indexProgress.indexed}/${indexProgress.total}`
          : `${vaultSession?.displayName ?? "笔记库"} · ${vaultNoteCount} 篇`
    : cached
      ? `离线缓存 · ${vaultNoteCount} 篇`
      : webDavConfigured
      ? "等待输入应用密码"
      : "尚未连接"
  const connectionLabel = vaultSession?.kind === "webdav"
    ? "已连接坚果云"
    : vaultSession
      ? "已打开本地笔记库"
      : activeCacheMeta?.label ?? "配置 WebDAV"
  const mobileConnectionLabel = vaultSession?.kind === "webdav"
    ? !isOnline
      ? "离线"
      : conflictCount > 0
      ? `${conflictCount} 个冲突`
      : pendingSyncCount > 0
        ? `${pendingSyncCount} 篇待同步`
        : "已同步"
    : vaultSession
      ? "本地"
      : cached
        ? "缓存"
        : "未连接"

  const resolveActiveAsset = useCallback(async (source: string) => {
    const notePath = activeNote?.remotePath
    if (!notePath) return null
    const assetPath = resolveVaultAssetPath(notePath, source)
    if (!assetPath) return null
    if (activeCacheMeta?.sourceKind === "webdav") {
      const cachedAttachment = await loadVaultAttachment(activeCacheMeta.id, assetPath)
      if (cachedAttachment) return { data: new Uint8Array(cachedAttachment.data), mimeType: cachedAttachment.mimeType }
    }
    return vaultSession?.readBinaryFile ? vaultSession.readBinaryFile(assetPath) : null
  }, [activeCacheMeta, activeNote?.remotePath, vaultSession])

  const attachmentNoteId = activeNote?.id
  const attachmentNotePath = activeNote?.remotePath
  const attachmentNoteSource = activeNote?.source
  const attachmentCacheId = activeCacheMeta?.sourceKind === "webdav" ? activeCacheMeta.id : undefined
  const insertActiveNoteAttachments = useCallback(async (files: File[]) => {
    if (!attachmentNotePath || !attachmentNoteId) {
      return { errors: ["当前笔记库不支持写入附件"], markdown: "" }
    }
    if (attachmentNoteSource === "webdav" && attachmentCacheId) {
      const config = loadWebDavConfig()
      const rootPath = config.remotePath.replace(/^\/+|\/+$/g, "")
      const writer = {
        createBinaryFile: async (path: string, data: Uint8Array, mimeType?: string) => {
          // WebDAV 附件先持久化到 IndexedDB；这里不持有 File，刷新页面后队列仍可继续同步。
          await queueVaultAttachment({
            cacheId: attachmentCacheId,
            data: data.slice().buffer,
            mimeType,
            noteId: attachmentNoteId,
            path,
          })
          return { path }
        },
        getDisplayPath: (path: string) => rootPath && path.replace(/^\/+/, "").startsWith(`${rootPath}/`)
          ? path.replace(/^\/+/, "").slice(rootPath.length + 1)
          : path.replace(/^\/+/, ""),
        getStoragePath: (displayPath: string) => `${config.remotePath.replace(/\/+$/g, "")}/${displayPath.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/"),
      }
      const result = await writeVaultAttachments(writer, attachmentNotePath, files)
      setPendingAttachmentCount((await listPendingVaultAttachments(attachmentCacheId)).length)
      return result
    }
    if (!vaultSession || !canWriteVaultAttachments(vaultSession)) {
      return { errors: ["当前笔记库不支持写入附件"], markdown: "" }
    }
    // 附件不进入 Markdown 文件列表，写盘后由预览按相对路径直接读取，无需重新扫描笔记库。
    return writeVaultAttachments(vaultSession, attachmentNotePath, files)
  }, [attachmentCacheId, attachmentNoteId, attachmentNotePath, attachmentNoteSource, vaultSession])

  const updateActiveNote = (patch: Partial<Note>) => {
    if (!activeNote) return
    const touchesDocument = typeof patch.content === "string" || typeof patch.title === "string"
    if (touchesDocument && isRefreshingVault) {
      setVaultError("正在同步当前笔记库，请等待完成后继续编辑")
      return
    }
    const indexedPatch: Partial<Note> = typeof patch.content === "string"
      ? (() => {
          const frontmatter = extractFrontmatter(patch.content)
          return {
          ...patch,
          frontmatter: frontmatter.properties,
          outgoingLinks: extractWikiLinks(patch.content),
          searchText: `${patch.content} ${frontmatter.tags.join(" ")}`.toLocaleLowerCase(),
          tags: frontmatter.tags,
        }
        })()
      : patch
    setNotes((current) =>
      current.map((note) =>
        note.id === activeNoteId
          ? {
              ...note,
              ...indexedPatch,
              ...(touchesDocument ? { modifiedAt: Date.now(), updatedAt: "刚刚" } : {}),
              ...(touchesDocument && note.source === "webdav"
                ? {
                    syncError: undefined,
                    syncStatus: note.syncStatus === "conflict" ? "conflict" as const : "modified" as const,
                    writeContentAfterMove: note.pendingOperation === "move" ? true : note.writeContentAfterMove,
                  }
                : {}),
            }
          : note,
      ),
    )
    if (touchesDocument && activeNote.source === "webdav") {
      setSaveStates((current) => ({
        ...current,
        [activeNote.id]: activeNote.syncStatus === "conflict"
          ? { status: "conflict" }
          : { status: "pending" },
      }))
    }
    if (typeof patch.content === "string") scheduleLocalSave(activeNote, patch.content)
  }

  const scheduleLocalSave = (note: Note, content: string) => {
    // WebDAV 正文先落入 IndexedDB 工作副本，只有显式同步动作才允许写入坚果云。
    if (note.source === "webdav") return
    const adapter = vaultSession
    const path = note.remotePath
    if (!path || note.readOnly || !adapter?.writeTextFile) return

    const previousTimer = saveTimersRef.current.get(note.id)
    if (previousTimer) window.clearTimeout(previousTimer)
    setSaveStates((current) => ({ ...current, [note.id]: { status: "saving" } }))

    // 同一文件的保存任务串行执行，并在真正写入前读取最新 revision，避免快速输入造成自冲突。
    const timer = window.setTimeout(() => {
      const previousSave = saveQueuesRef.current.get(path) ?? Promise.resolve()
      const nextSave = previousSave
        .catch(() => undefined)
        .then(async () => {
          try {
            const result = await adapter.writeTextFile?.(
              path,
              content,
              revisionByPathRef.current.get(path),
            )
            if (!result) return
            revisionByPathRef.current.set(path, result.revision)
            setNotes((current) => current.map((currentNote) =>
              currentNote.id === note.id
                ? { ...currentNote, modifiedAt: Date.now(), revision: result.revision, updatedAt: "刚刚" }
                : currentNote,
            ))
            setSaveStates((current) => ({ ...current, [note.id]: { status: "saved" } }))
          } catch (error) {
            const message = error instanceof Error ? error.message : "保存笔记失败"
            const status = error instanceof Error && error.name === "VaultConflictError"
              ? "conflict"
              : "error"
            setSaveStates((current) => ({ ...current, [note.id]: { message, status } }))
            setVaultError(message)
          }
        })
      saveQueuesRef.current.set(path, nextSave)
    }, 650)
    saveTimersRef.current.set(note.id, timer)
  }

  const toggleTask = (task: MarkdownTask, checked: boolean) => {
    if (isRefreshingVault) {
      setVaultError("正在同步当前笔记库，请等待完成后再修改待办")
      return
    }
    const note = notes.find((candidate) => candidate.id === task.noteId)
    const webDavWorkingCopy = note?.source === "webdav" && note.contentLoaded && !note.readOnly
    const writableLocalFile = Boolean(note && !note.readOnly && note.remotePath && vaultSession?.writeTextFile)
    if (!note || (!webDavWorkingCopy && !writableLocalFile)) {
      setVaultError("当前待办来自只读笔记，不能修改源文件")
      return
    }
    try {
      const content = setMarkdownTaskChecked(note.content, task.line, checked)
      setNotes((current) => current.map((candidate) => candidate.id === note.id
        ? {
            ...candidate,
            content,
            ...indexNoteContent(content),
            preview: buildNotePreview(content, candidate.format),
            syncStatus: candidate.source === "webdav"
              ? candidate.syncStatus === "conflict" ? "conflict" : "modified"
              : candidate.syncStatus,
            syncError: candidate.source === "webdav" ? undefined : candidate.syncError,
            updatedAt: "刚刚",
            modifiedAt: Date.now(),
          }
        : candidate))
      scheduleLocalSave(note, content)
      if (note.source === "webdav") {
        setSaveStates((current) => ({
          ...current,
          [note.id]: note.syncStatus === "conflict" ? { status: "conflict" } : { status: "pending" },
        }))
      }
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "更新待办失败")
    }
  }

  const createTask = (text: string) => {
    if (isRefreshingVault) {
      setVaultError("正在同步当前笔记库，请等待完成后再添加待办")
      return false
    }
    const target = quickTaskTarget
    if (!target) {
      setVaultError("请先打开一篇可编辑且已加载正文的 Markdown 笔记")
      return false
    }
    const separator = target.content.endsWith("\n") ? "" : "\n"
    const content = `${target.content}${separator}\n- [ ] ${text}\n`
    // 快速待办仍写回 Markdown 源文件，保证其他客户端无需理解专有数据库也能读取。
    setNotes((current) => current.map((candidate) => candidate.id === target.id
      ? {
          ...candidate,
          content,
          ...indexNoteContent(content),
          preview: buildNotePreview(content, candidate.format),
          syncError: candidate.source === "webdav" ? undefined : candidate.syncError,
          syncStatus: candidate.source === "webdav"
            ? candidate.syncStatus === "conflict" ? "conflict" : "modified"
            : candidate.syncStatus,
          updatedAt: "刚刚",
          modifiedAt: Date.now(),
        }
      : candidate))
    scheduleLocalSave(target, content)
    if (target.source === "webdav") {
      setSaveStates((current) => ({ ...current, [target.id]: { status: "pending" } }))
    }
    return true
  }

  const createNote = async () => {
    const adapter = vaultSession
    const canCreateOfflineWebDav = !adapter && activeCacheMeta?.sourceKind === "webdav" && webDavConfigured
    if ((!adapter && !canCreateOfflineWebDav)
      || (adapter && adapter.kind !== "webdav" && (!adapter.createTextFile || adapter.readOnly))) {
      setVaultError("请先打开一个可写的本地 Vault")
      return
    }

    setIsCreatingNote(true)
    setVaultError(null)
    try {
      const now = new Date()
      const timestamp = formatFileTimestamp(now)
      const title = `新笔记 ${timestamp.slice(0, 10)} ${timestamp.slice(11, 16).replace("-", ":")}`
      const directory = selectedFolder?.split(/\s*\/\s*/).filter(Boolean).join("/")
      const displayPath = `${directory ? `${directory}/` : ""}新笔记-${timestamp}-${now.getMilliseconds().toString().padStart(3, "0")}.md`
      const config = loadWebDavConfig()
      const webDavStoragePath = `${config.remotePath.replace(/\/+$/g, "")}/${displayPath.replace(/^\/+/, "")}`
        .replace(/\/{2,}/g, "/")
      const path = adapter?.getStoragePath?.(displayPath)
        ?? (adapter?.kind === "webdav" || canCreateOfflineWebDav ? webDavStoragePath : displayPath)
      const content = `# ${title}\n\n`
      if (adapter?.kind === "webdav" || canCreateOfflineWebDav) {
        const id = `webdav:${path}`
        const newNote: Note = {
          content,
          contentLoaded: true,
          folder: deriveRemoteFolder(displayPath),
          id,
          modifiedAt: now.getTime(),
          outgoingLinks: [],
          pendingOperation: "create",
          preview: "开始记录你的想法…",
          readOnly: false,
          remotePath: path,
          searchText: content.toLocaleLowerCase(),
          source: "webdav",
          starred: false,
          syncStatus: "modified",
          title,
          updatedAt: "刚刚创建 · 待同步",
        }
        // 新笔记先进入 IndexedDB 工作副本；这里不调用适配器，避免创建动作绕过显式同步。
        setLibraryView("all")
        setNotes((current) => [newNote, ...current])
        setActiveNoteId(id)
        setSaveStates((current) => ({ ...current, [id]: { status: "pending" } }))
        setVaultNoteCount((count) => count + 1)
        setMobileScreen("editor")
        navigate(`/notes/${encodeURIComponent(id)}`)
        return
      }

      const result = await adapter!.createTextFile!(path, content)
      const id = `${adapter!.kind}:${result.path}`
      const newNote: Note = {
        content,
        contentLoaded: true,
        folder: deriveRemoteFolder(result.path),
        id,
        modifiedAt: now.getTime(),
        outgoingLinks: [],
        preview: "开始记录你的想法…",
        readOnly: false,
        remotePath: result.path,
        revision: result.revision,
        searchText: content.toLocaleLowerCase(),
        source: "local",
        starred: false,
        title,
        updatedAt: "刚刚",
      }
      revisionByPathRef.current.set(result.path, result.revision)
      setLibraryView("all")
      setNotes((current) => [newNote, ...current])
      setActiveNoteId(id)
      setSaveStates((current) => ({ ...current, [id]: { status: "saved" } }))
      setVaultNoteCount((count) => count + 1)
      setMobileScreen("editor")
      navigate(`/notes/${encodeURIComponent(id)}`)
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "新建笔记失败")
    } finally {
      setIsCreatingNote(false)
    }
  }

  const formatActiveNote = (syntax: string) => {
    if (!activeNote || !syntax || activeNote.readOnly) return
    const content = `${activeNote.content}${syntax}`
    updateActiveNote({
      content,
      preview: buildNotePreview(content, activeNote.format),
    })
  }

  const formatNoteById = (noteId: string, syntax: string) => {
    const note = notesRef.current.find((candidate) => candidate.id === noteId)
    if (!note || !syntax || note.readOnly) return
    const content = `${note.content}${syntax}`
    setNotes((current) => current.map((candidate) => candidate.id === noteId
      ? {
          ...candidate,
          content,
          ...indexNoteContent(content),
          modifiedAt: Date.now(),
          preview: buildNotePreview(content, candidate.format),
          syncError: candidate.source === "webdav" ? undefined : candidate.syncError,
          syncStatus: candidate.source === "webdav"
            ? candidate.syncStatus === "conflict" ? "conflict" : "modified"
            : candidate.syncStatus,
          updatedAt: "刚刚",
        }
      : candidate))
    if (note.source === "webdav") {
      setSaveStates((current) => ({
        ...current,
        [noteId]: note.syncStatus === "conflict" ? { status: "conflict" } : { status: "pending" },
      }))
    } else {
      scheduleLocalSave(note, content)
    }
  }

  const startVaultIndex = (adapter: VaultAdapter, files: VaultFileEntry[]) => {
    const generation = ++indexGenerationRef.current
    if (files.length === 0) {
      setIndexProgress(null)
      return
    }
    setIndexProgress({ indexed: 0, total: files.length })
    void createVaultCacheId(adapter.cacheIdentity)
      .then(async (cacheId) => {
        await clearNativeSearchIndex(cacheId)
        await indexVaultFiles(
          adapter,
          files,
          async (batch, indexed, total) => {
        const indexedByPath = new Map(batch.map((item) => [item.path, item]))
        setNotes((current) => current.map((note) => {
          const indexedNote = note.remotePath ? indexedByPath.get(note.remotePath) : undefined
          const hasLocalChanges = note.syncStatus === "modified" || note.syncStatus === "conflict"
          return indexedNote
            && !hasLocalChanges
            ? {
                ...note,
                baseContent: indexedNote.content,
                content: indexedNote.content,
                contentLoaded: true,
                outgoingLinks: indexedNote.outgoingLinks,
                frontmatter: indexedNote.frontmatter,
                // 建索引前列表只有文件路径可显示；读到正文后同步补上真正的摘要。
                preview: buildNotePreview(indexedNote.content, note.format),
                readOnly: note.format === "canvas" || (note.source === "webdav" ? false : note.readOnly),
                revision: indexedNote.revision ?? note.revision,
                searchText: indexedNote.searchText,
                tags: indexedNote.tags,
                syncStatus: note.source === "webdav" ? "synced" : note.syncStatus,
              }
            : note
        }))
        setIndexProgress({ indexed, total })
            await upsertNativeSearchIndex(cacheId, batch.map(toNativeSearchEntry))
          },
          () => generation !== indexGenerationRef.current,
          adapter.kind === "webdav"
            ? { batchSize: 2, delayMs: 350 }
            : { batchSize: 24 },
        )
      })
      .catch((error) => setVaultError(error instanceof Error ? error.message : "建立搜索索引失败"))
  }

  const connectWebDav = async (config: WebDavConfig, password: string) => {
    const adapter = createWebDavVaultAdapter(config, password)
    const cacheId = await createVaultCacheId(adapter.cacheIdentity)
    const restoreWorkingCopy = activeCacheMeta?.id === cacheId
    // 同一笔记库重新输入密码后必须携带离线工作副本参与合并，不能把重连误当成首次导入。
    const mergedNotes = await loadVault(adapter, restoreWorkingCopy, restoreWorkingCopy ? notes : [])
    const hasPendingChanges = mergedNotes.some((note) =>
      note.source === "webdav" && note.syncStatus === "modified",
    )
    const attachmentResult = await pushPendingWebDavAttachments(adapter)
    if (!hasPendingChanges) {
      if (attachmentResult.errorMessage) setVaultError(attachmentResult.errorMessage)
      return mergedNotes.length
    }

    // “连接并同步”先拉取版本并完成冲突判断，再上传本地稿，避免重连后直接覆盖其他设备的修改。
    const eligibleNoteIds = attachmentResult.failedNoteIds.size > 0
      ? new Set(mergedNotes.filter((note) => !attachmentResult.failedNoteIds.has(note.id)).map((note) => note.id))
      : undefined
    const syncResult = await pushPendingWebDavNotes(adapter, mergedNotes, eligibleNoteIds)
    const refreshedNotes = await loadVault(adapter, true, syncResult.notes)
    if (attachmentResult.errorMessage || syncResult.errorMessage) {
      setVaultError(attachmentResult.errorMessage ?? syncResult.errorMessage)
    }
    return refreshedNotes.length
  }

  const loadVault = async (
    adapter: VaultAdapter,
    preserveContext = false,
    contextNotes: Note[] = notes,
  ) => {
    const [files, directories] = await Promise.all([
      adapter.listMarkdownFiles(),
      adapter.listDirectories?.() ?? Promise.resolve([]),
    ])
    if (files.length === 0 && adapter.kind === "webdav") {
      throw new Error(`${adapter.displayName} 中没有找到 Markdown 文件`)
    }
    const displayDirectories = directories.map((path) => deriveDirectoryPath(
      adapter.getDisplayPath?.(path) ?? path,
    ))

    const previousNotesByPath = preserveContext
      ? new Map(contextNotes.filter((note) => note.remotePath).map((note) => [note.previousRemotePath ?? note.remotePath!, note]))
      : new Map<string, Note>()
    const preferredPath = preserveContext && activeNote?.remotePath
      && files.some((file) => file.path === activeNote.remotePath)
      ? activeNote.remotePath
      : files[0]?.path ?? ""
    const pathsToRead = files
      .filter((file) => shouldReadVaultDocument({
        filePath: file.path,
        preferredPath,
        preserveContext,
        previousNote: previousNotesByPath.get(file.path),
        remoteRevision: file.revision,
      }))
      .map((file) => file.path)
    const loadedDocuments = await readVaultDocuments(adapter, pathsToRead)
    const remoteNotes: Note[] = files.map((file) => {
      const isCanvas = /\.canvas$/i.test(file.path)
      const previousNote = previousNotesByPath.get(file.path)
      const loadedDocument = loadedDocuments.get(file.path)
      const workingCopy = previousNote && isWebDavWorkingCopy(previousNote) ? previousNote : undefined
      const preserveWorkingCopy = Boolean(workingCopy)
      const reuseCachedContent = canReuseCachedContent(previousNote, file.revision)
      // 本地工作副本必须基于同一远端版本才能继续上传；版本变化时只标记冲突，不覆盖正文。
      const remoteChangedWhileEditing = Boolean(
        previousNote && remoteChangedFromBase(previousNote, file.revision),
      )
      const content = preserveWorkingCopy
        ? workingCopy!.content
        : loadedDocument?.content ?? (reuseCachedContent ? previousNote!.content : "正在从笔记库读取…")
      const contentLoaded = preserveWorkingCopy || Boolean(loadedDocument) || reuseCachedContent
      const contentIndex = contentLoaded ? indexNoteContent(content) : undefined

      return {
        id: preserveWorkingCopy ? workingCopy!.id : `${adapter.kind}:${file.path}`,
        title: preserveWorkingCopy ? workingCopy!.title : file.name.replace(/\.(?:canvas|md)$/i, ""),
        preview: preserveWorkingCopy
          ? workingCopy!.preview
          : reuseCachedContent
            ? previousNote!.preview
            : loadedDocument
              ? buildNotePreview(loadedDocument.content, isCanvas ? "canvas" : "markdown")
              : adapter.getDisplayPath?.(file.path) ?? file.path,
        content,
        updatedAt: formatRemoteDate(file.updatedAt),
        modifiedAt: parseRemoteTimestamp(file.updatedAt),
        starred: previousNote?.starred ?? false,
        folder: preserveWorkingCopy
          ? workingCopy!.folder
          : deriveRemoteFolder(adapter.getDisplayPath?.(file.path) ?? file.path),
        source: adapter.kind === "webdav" ? "webdav" : "local",
        remotePath: preserveWorkingCopy ? workingCopy!.remotePath : file.path,
        readOnly: isCanvas || (adapter.kind === "webdav" ? !contentLoaded : adapter.readOnly),
        format: isCanvas ? "canvas" : "markdown",
        baseContent: preserveWorkingCopy
          ? workingCopy!.baseContent
          : loadedDocument?.content ?? (reuseCachedContent ? previousNote!.baseContent ?? previousNote!.content : undefined),
        revision: preserveWorkingCopy
          ? workingCopy!.revision
          : loadedDocument?.revision ?? file.revision,
        searchText: reuseCachedContent
          ? previousNote!.searchText
          : contentIndex?.searchText,
        outgoingLinks: reuseCachedContent
          ? previousNote!.outgoingLinks
          : contentIndex?.outgoingLinks,
        frontmatter: reuseCachedContent ? previousNote!.frontmatter ?? contentIndex?.frontmatter : contentIndex?.frontmatter,
        tags: reuseCachedContent ? previousNote!.tags ?? contentIndex?.tags : contentIndex?.tags,
        contentLoaded,
        pendingOperation: workingCopy?.pendingOperation,
        writeContentAfterMove: workingCopy?.writeContentAfterMove,
        previousRemotePath: workingCopy?.previousRemotePath,
        syncError: preserveWorkingCopy ? workingCopy!.syncError : undefined,
        syncStatus: adapter.kind === "webdav"
          ? preserveWorkingCopy
            ? remoteChangedWhileEditing ? "conflict" : workingCopy!.syncStatus
            : contentLoaded ? "synced" : undefined
          : undefined,
      }
    })
    const remotePaths = new Set(files.map((file) => file.path))
    // 远端删除不能顺带删除尚未上传的本地正文；保留为冲突项，交给用户显式处理。
    const orphanedWorkingCopies = Array.from(new Set(previousNotesByPath.values()))
      .filter((note) => note.source === "webdav"
        && note.remotePath
        && !remotePaths.has(note.previousRemotePath ?? note.remotePath)
        && (note.syncStatus === "modified" || note.syncStatus === "conflict"))
      .map((note): Note => ({
        ...note,
        syncStatus: note.pendingOperation === "create" ? "modified" : "conflict",
      }))
    const mergedNotes = [...remoteNotes, ...orphanedWorkingCopies]
    const preservedActiveNote = preserveContext
      ? mergedNotes.find((note) => note.id === activeNoteId && note.pendingOperation !== "delete")
      : undefined
    const fallbackNote = mergedNotes.find((note) => note.pendingOperation !== "delete")
    const nextActiveNoteId = preservedActiveNote?.id ?? fallbackNote?.id ?? ""

    revisionByPathRef.current.clear()
    for (const note of mergedNotes) {
      if (note.remotePath) revisionByPathRef.current.set(note.remotePath, note.revision)
    }

    const cacheId = await createVaultCacheId(adapter.cacheIdentity)
    const persistedCache = activeCacheMeta?.id === cacheId ? null : await loadVaultCache(cacheId)
    const nextTrashEntries = activeCacheMeta?.id === cacheId
      ? trashEntries
      : persistedCache?.trash ?? []
    const hasUnresolvedSync = mergedNotes.some((note) => note.source === "webdav"
      && (note.syncStatus === "modified" || note.syncStatus === "conflict" || Boolean(note.syncError)))
    const cacheMeta: ActiveCacheMeta = {
      id: cacheId,
      label: adapter.cacheLabel,
      // 只有远端读取成功且没有上传失败或冲突时，才推进“最近同步”时间。
      lastSyncedAt: adapter.kind === "webdav" && !hasUnresolvedSync
        ? Date.now()
        : activeCacheMeta?.id === cacheId ? activeCacheMeta.lastSyncedAt : undefined,
      sourceKind: adapter.kind,
    }
    const snapshot: VaultCacheSnapshot = {
      ...cacheMeta,
      activeNoteId: nextActiveNoteId,
      directories: displayDirectories,
      notes: mergedNotes,
      savedAt: Date.now(),
      trash: nextTrashEntries,
    }
    // 首次读取成功就立刻落盘，避免用户在延迟保存触发前刷新导致这次远程列表丢失。
    await saveVaultCache(snapshot)

    // 适配器只保存在运行时；浏览器目录句柄和 WebDAV 密码都不会写入本地存储。
    setVaultSession(adapter)
    setActiveCacheMeta(cacheMeta)
    setVaultCaches(await listVaultCaches())
    setSelectedFolder((current) => preserveContext && current
      && (mergedNotes.some((note) => noteBelongsToFolder(note, current))
        || displayDirectories.includes(current))
      ? current
      : null)
    setNotes(mergedNotes)
    setVaultDirectories(displayDirectories)
    setTrashEntries(nextTrashEntries)
    setActiveNoteId(nextActiveNoteId)
    setVaultNoteCount(mergedNotes.filter((note) => note.pendingOperation !== "delete").length)
    setSaveStates(Object.fromEntries(mergedNotes.map((note) => [note.id, getNoteSaveState(note)])))
    setVaultError(null)
    if (!preserveContext) setMobileScreen("notes")
    const refreshedIndexEntries = mergedNotes
      .filter((note) => note.contentLoaded && note.remotePath && loadedDocuments.has(note.remotePath))
      .map((note) => ({
        content: note.content,
        noteId: note.remotePath!,
        path: note.remotePath!,
        tags: note.tags?.join(" ") ?? "",
        title: note.title,
      }))
    await upsertNativeSearchIndex(cacheId, refreshedIndexEntries)
    // WebDAV 也建立全文索引，但降低并发并在批次间让出时间，避免触发坚果云频率限制。
    const filesToIndex = files.filter((file) => !mergedNotes.find((note) =>
      note.remotePath === file.path && typeof note.searchText === "string",
    ))
    startVaultIndex(adapter, filesToIndex)
    return mergedNotes
  }

  const pushPendingWebDavNotes = async (
    adapter: VaultAdapter,
    currentNotes: Note[],
    noteIds?: ReadonlySet<string>,
    run?: SyncRun,
  ) => {
    if (adapter.kind !== "webdav" || !adapter.writeTextFile) {
      return { errorMessage: null, notes: currentNotes }
    }

    let nextNotes = currentNotes
    let errorMessage: string | null = null
    const ensuredDirectories = new Set<string>()
    const pendingNotes = currentNotes.filter((note) =>
      note.source === "webdav"
      && note.syncStatus === "modified"
      && note.remotePath
      && (!noteIds || noteIds.has(note.id)),
    )

    // 坚果云对请求频率敏感，按文件串行同步；单篇失败不会阻断其他本地稿的尝试。
    for (const pendingNote of pendingNotes) {
      if (run?.cancelled) break
      const path = pendingNote.remotePath!
      setSyncProgress((current) => current ? { ...current, currentLabel: pendingNote.title, phase: "notes" } : current)
      setSaveStates((current) => ({ ...current, [pendingNote.id]: { status: "saving" } }))
      try {
        if (pendingNote.pendingOperation === "delete") {
          if (!adapter.deleteTextFile) throw new Error("当前 WebDAV 会话不支持删除")
          await adapter.deleteTextFile(pendingNote.previousRemotePath ?? path, pendingNote.revision)
          if (activeCacheMeta?.sourceKind === "webdav") {
            // 远端删除成功后附件引用已不可恢复，此时再清理队列，避免撤销删除时丢失待传附件。
            await discardPendingVaultAttachments(activeCacheMeta.id, new Set([pendingNote.id]))
            setPendingAttachmentCount((await listPendingVaultAttachments(activeCacheMeta.id)).length)
          }
          nextNotes = nextNotes.filter((note) => note.id !== pendingNote.id)
          setSaveStates((current) => {
            const next = { ...current }
            delete next[pendingNote.id]
            return next
          })
          continue
        }

        let result
        if (pendingNote.pendingOperation === "create") {
          result = await adapter.createTextFile?.(path, pendingNote.content)
        } else if (pendingNote.pendingOperation === "move") {
          if (!adapter.moveTextFile) throw new Error("当前 WebDAV 会话不支持移动")
          const targetDirectory = path.split("/").slice(0, -1).join("/")
          if (targetDirectory && !ensuredDirectories.has(targetDirectory)) {
            await adapter.ensureDirectory?.(targetDirectory)
            ensuredDirectories.add(targetDirectory)
          }
          // MOVE 成功后再条件写入本地正文，兼容“离线移动后继续编辑”的组合操作。
          const moved = await adapter.moveTextFile(
            pendingNote.previousRemotePath ?? path,
            path,
            pendingNote.revision,
          )
          // 纯目录重命名只需要 MOVE；旧缓存未记录该标记时仍沿用写正文行为，避免遗漏历史草稿。
          result = pendingNote.writeContentAfterMove === false
            ? moved
            : await adapter.writeTextFile(path, pendingNote.content, moved.revision)
        } else {
          result = await adapter.writeTextFile(path, pendingNote.content, pendingNote.revision)
        }
        if (!result) throw new Error("当前 WebDAV 会话不支持此同步操作")
        nextNotes = nextNotes.map((note) => note.id === pendingNote.id
          ? {
              ...note,
              baseContent: pendingNote.content,
              mergeConflictCount: undefined,
              pendingOperation: undefined,
              writeContentAfterMove: undefined,
              previousRemotePath: undefined,
              revision: result.revision,
              syncError: undefined,
              syncStatus: "synced",
              updatedAt: "刚刚同步",
            }
          : note)
        revisionByPathRef.current.set(path, result.revision)
        setSaveStates((current) => ({ ...current, [pendingNote.id]: { status: "saved" } }))
      } catch (error) {
        const conflict = error instanceof VaultConflictError
        const message = error instanceof Error ? error.message : "同步笔记失败"
        errorMessage = message
        nextNotes = nextNotes.map((note) => note.id === pendingNote.id
          ? { ...note, syncError: conflict ? undefined : message, syncStatus: conflict ? "conflict" : "modified" }
          : note)
        setSaveStates((current) => ({
          ...current,
          [pendingNote.id]: { message, status: conflict ? "conflict" : "error" },
        }))
        setVaultError(message)
      } finally {
        setSyncProgress((current) => current ? { ...current, completed: Math.min(current.total, current.completed + 1) } : current)
      }
    }

    setNotes(nextNotes)
    return { cancelled: Boolean(run?.cancelled), errorMessage, notes: nextNotes }
  }

  const pushPendingWebDavAttachments = async (
    adapter: VaultAdapter,
    noteIds?: ReadonlySet<string>,
    run?: SyncRun,
  ) => {
    const failedNoteIds = new Set<string>()
    if (adapter.kind !== "webdav" || !adapter.createBinaryFile || activeCacheMeta?.sourceKind !== "webdav") {
      return { errorMessage: null as string | null, failedNoteIds }
    }
    const deletedNoteIds = new Set(notes
      .filter((note) => note.pendingOperation === "delete")
      .map((note) => note.id))
    const entries = (await listPendingVaultAttachments(activeCacheMeta.id))
      .filter((entry) => !deletedNoteIds.has(entry.noteId) && (!noteIds || noteIds.has(entry.noteId)))
    let errorMessage: string | null = null
    const ensuredDirectories = new Set<string>()

    // 二进制先于 Markdown 正文上传，保证其他设备读到引用时附件已经存在。
    for (const entry of entries) {
      if (run?.cancelled) break
      setSyncProgress((current) => current ? {
        ...current,
        currentLabel: entry.path.split("/").pop() ?? entry.path,
        phase: "attachments",
      } : current)
      try {
        const directory = entry.path.split("/").slice(0, -1).join("/")
        if (directory && !ensuredDirectories.has(directory)) {
          await adapter.ensureDirectory?.(directory)
          ensuredDirectories.add(directory)
        }
        await adapter.createBinaryFile(entry.path, new Uint8Array(entry.data), entry.mimeType)
        await updateVaultAttachmentStatus(entry, "synced")
      } catch (error) {
        if (error instanceof VaultConflictError && adapter.readBinaryFile) {
          try {
            const remote = await adapter.readBinaryFile(entry.path)
            if (equalBytes(new Uint8Array(entry.data), remote.data)) {
              // PUT 成功后若应用在落状态前退出，重试会遇到 412；内容一致即可安全恢复为已同步。
              await updateVaultAttachmentStatus(entry, "synced")
              continue
            }
          } catch {
            // 远端校验失败时保留原始冲突，等待用户下次重试。
          }
        }
        const message = error instanceof Error ? error.message : "附件同步失败"
        failedNoteIds.add(entry.noteId)
        errorMessage = message
        await updateVaultAttachmentStatus(entry, "failed", message)
      } finally {
        setSyncProgress((current) => current ? { ...current, completed: Math.min(current.total, current.completed + 1) } : current)
      }
    }
    const remainingEntries = await listPendingVaultAttachments(activeCacheMeta.id)
    setPendingAttachmentCount(remainingEntries.length)
    setFailedAttachmentCount(remainingEntries.filter((entry) => entry.status === "failed").length)
    return { cancelled: Boolean(run?.cancelled), errorMessage, failedNoteIds }
  }

  const refreshVault = async (noteIds?: ReadonlySet<string>) => {
    if (!vaultSession) {
      if (activeCacheMeta?.sourceKind === "webdav" && webDavConfigured) {
        if (!isOnline) {
          setVaultError("当前设备离线，本地修改已保留；恢复网络后再同步")
          return
        }
        const config = loadWebDavConfig()
        if (config.rememberPassword) {
          setIsRefreshingVault(true)
          setVaultError(null)
          try {
            const storedPassword = await loadWebDavPassword(config)
            if (storedPassword) {
              // 用户仍需主动点击同步；这里只省略重复输密码，不会在应用启动时自动写云端。
              await connectWebDav(config, storedPassword)
              return
            }
          } catch {
            await deleteWebDavPassword(config).catch(() => undefined)
            setVaultError("此设备保存的应用密码已失效，请重新输入")
          } finally {
            setIsRefreshingVault(false)
          }
        }
        // Web 端或凭据不可用时，在原页面只补录密码，避免打断阅读和滚动位置。
        setQuickConnectOpen(true)
        return
      }
      navigate("/settings/webdav")
      return
    }
    if (vaultSession.kind === "webdav" && !isOnline) {
      setVaultError("当前设备离线，本地修改已保留；恢复网络后再同步")
      return
    }
    // React 状态更新存在一个渲染间隔，使用运行令牌阻止手动与自动同步在同一时刻重复启动。
    if (activeSyncRunRef.current) return

    setIsRefreshingVault(true)
    setVaultError(null)
    const run: SyncRun = { cancelled: false }
    activeSyncRunRef.current = run
    try {
      const pendingAttachments = activeCacheMeta?.sourceKind === "webdav"
        ? (await listPendingVaultAttachments(activeCacheMeta.id))
          .filter((entry) => !noteIds || noteIds.has(entry.noteId)).length
        : 0
      const pendingNotes = notes.filter((note) => note.source === "webdav"
        && note.syncStatus === "modified"
        && (!noteIds || noteIds.has(note.id))).length
      setSyncProgress({ completed: 0, currentLabel: "准备同步", phase: "attachments", total: pendingAttachments + pendingNotes })
      // 所有手动/自动同步都汇入同一条带版本校验的写入链路，避免不同入口产生覆盖差异。
      const attachmentResult = await pushPendingWebDavAttachments(vaultSession, noteIds, run)
      if (run.cancelled) {
        setSyncLogs(appendSyncLog({ message: "同步已取消，未处理项目仍保留在本机队列", status: "error" }))
        return
      }
      const eligibleNoteIds = attachmentResult.failedNoteIds.size > 0
        ? new Set(notes
            .filter((note) => (!noteIds || noteIds.has(note.id)) && !attachmentResult.failedNoteIds.has(note.id))
            .map((note) => note.id))
        : noteIds
      const syncResult = await pushPendingWebDavNotes(vaultSession, notes, eligibleNoteIds, run)
      if (run.cancelled || syncResult.cancelled) {
        setSyncLogs(appendSyncLog({ message: "同步已取消，已完成项目状态已保存", status: "error" }))
        return
      }
      setSyncProgress((current) => current ? { ...current, currentLabel: "刷新远端列表", phase: "refreshing" } : current)
      await loadVault(vaultSession, true, syncResult.notes)
      const combinedError = attachmentResult.errorMessage ?? syncResult.errorMessage
      if (combinedError) {
        setVaultError(combinedError)
        setSyncLogs(appendSyncLog({ message: `同步完成，但部分内容失败：${combinedError}`, status: "error" }))
      } else {
        const pendingCount = notes.filter((note) => note.source === "webdav"
          && (note.pendingOperation || note.syncStatus === "modified")).length
        setSyncLogs(appendSyncLog({
          message: pendingCount > 0 ? `同步完成，已处理 ${pendingCount} 篇本地修改` : "同步检查完成，云端与本机一致",
          status: "success",
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "刷新笔记库失败"
      setVaultError(message)
      setSyncLogs(appendSyncLog({ message: `同步失败：${message}`, status: "error" }))
    } finally {
      if (activeSyncRunRef.current === run) activeSyncRunRef.current = null
      setSyncProgress(null)
      setIsRefreshingVault(false)
    }
  }

  const cancelSync = () => {
    if (!activeSyncRunRef.current) return
    activeSyncRunRef.current.cancelled = true
    setSyncProgress((current) => current ? { ...current, currentLabel: "正在安全停止…" } : current)
  }

  const retryFailedSync = async () => {
    const failedNoteIds = new Set(notes
      .filter((note) => note.source === "webdav" && Boolean(note.syncError))
      .map((note) => note.id))
    if (activeCacheMeta?.sourceKind === "webdav") {
      const attachments = await listPendingVaultAttachments(activeCacheMeta.id)
      for (const entry of attachments) {
        if (entry.status === "failed") failedNoteIds.add(entry.noteId)
      }
    }
    if (failedNoteIds.size > 0) await refreshVault(failedNoteIds)
  }

  refreshVaultRef.current = refreshVault

  useEffect(() => {
    const justReconnected = !previousOnlineRef.current && isOnline
    previousOnlineRef.current = isOnline
    const shouldSync = autoSyncMode === "background"
      || (autoSyncMode === "reconnect" && justReconnected)
    if (!shouldSync || !isOnline || isRefreshingVault || pendingSyncCount === 0 || vaultSession?.kind !== "webdav") return

    // 后台模式采用防抖，避免每次按键都请求 WebDAV；联网模式只在离线转在线时触发一次。
    const timer = window.setTimeout(() => {
      void refreshVaultRef.current()
    }, autoSyncMode === "background" ? 4_000 : 600)
    return () => window.clearTimeout(timer)
  }, [autoSyncMode, isOnline, isRefreshingVault, pendingSyncCount, vaultSession])

  const changeAutoSyncMode = (mode: AutoSyncMode) => {
    setAutoSyncMode(mode)
    saveSyncPreferences({ autoSyncMode: mode })
  }

  const clearLocalSyncLogs = () => {
    clearSyncLog()
    setSyncLogs([])
  }

  const rebuildSearchIndex = async () => {
    if (!activeCacheMeta || !supportsNativeSearchIndex()) return
    await rebuildNativeSearchIndex()
    const entries = notes
      .filter((note) => note.contentLoaded && note.remotePath)
      .map((note) => ({
        content: note.content,
        noteId: note.remotePath!,
        path: note.remotePath!,
        tags: note.tags?.join(" ") ?? "",
        title: note.title,
      }))
    // 清空后立刻从当前离线快照回填，用户不需要重新连接坚果云才能恢复搜索。
    await upsertNativeSearchIndex(activeCacheMeta.id, entries)
  }

  useEffect(() => {
    if (!vaultSession?.watchChanges) return
    let disposed = false
    let refreshTimer: number | undefined
    let stopWatching: (() => void) | undefined
    void vaultSession.watchChanges(() => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        if (disposed || activeSyncRunRef.current) return
        // 外部编辑只重新读取本地 Vault；保留当前路由、滚动位置和仍在编辑的工作副本。
        void loadVault(vaultSession, true, notesRef.current).catch((error) => {
          if (!disposed) setVaultError(error instanceof Error ? error.message : "刷新本地笔记库失败")
        })
      }, 500)
    }).then((unwatch) => {
      if (disposed) unwatch()
      else stopWatching = unwatch
    }).catch(() => undefined)
    return () => {
      disposed = true
      window.clearTimeout(refreshTimer)
      stopWatching?.()
    }
  }, [vaultSession])

  const selectVaultCache = async (cacheId: string) => {
    try {
      const snapshot = await loadVaultCache(cacheId)
      if (!snapshot) throw new Error("缓存不存在，可能已被浏览器清理")
      // 重新保存一次只用于记录“最后使用的缓存”，快照内容不会发生改变。
      await saveVaultCache(snapshot)
      applyCachedSnapshot(snapshot)
      setVaultCaches(await listVaultCaches())
      setMobileScreen("notes")
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "切换缓存失败")
    }
  }

  const removeVaultCache = async (cacheId: string) => {
    if (cacheId === activeCacheMeta?.id) {
      setVaultError("当前正在使用的缓存不能删除，请先切换到其他笔记库")
      return
    }
    try {
      await deleteVaultCache(cacheId)
      setVaultCaches(await listVaultCaches())
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "删除缓存失败")
    }
  }

  const clearActiveVaultCache = async () => {
    const target = activeCacheMeta
    if (!target) return

    // 顺序不能调换：必须先切断所有写回通道再删库。
    // latestCacheSnapshotRef 同时服务于 450ms 防抖写入和 visibilitychange 立即 flush，
    // 置空后两者都会跳过；activeCacheMeta 变为 null 后，缓存写入 effect 也会提前返回。
    latestCacheSnapshotRef.current = null
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer)
    saveTimersRef.current.clear()
    saveQueuesRef.current.clear()
    loadingNoteIdsRef.current.clear()
    revisionByPathRef.current.clear()
    // 递增代际让仍在运行的后台索引批次自行退出，不再往已清空的列表里回填正文。
    indexGenerationRef.current += 1

    setActiveCacheMeta(null)
    // 适配器闭包持有 WebDAV 应用密码，断开会话即释放；Web 端密码本就不落任何存储。
    setVaultSession(null)
    setNotes([])
    setVaultDirectories([])
    setTrashEntries([])
    setActiveNoteId("")
    setVaultNoteCount(0)
    setSelectedFolder(null)
    setQuery("")
    setIndexProgress(null)
    setSaveStates({})
    setVaultError(null)

    try {
      await deleteVaultCache(target.id)
      await clearNativeSearchIndex(target.id).catch(() => undefined)
      setVaultCaches(await listVaultCaches())
      navigate("/notes")
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "清除缓存失败")
    }
  }

  const openLocalVault = async () => {
    setIsOpeningVault(true)
    setVaultError(null)
    try {
      const adapter = await selectLocalVaultAdapter()
      if (adapter) await loadVault(adapter)
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "读取本地笔记库失败")
    } finally {
      setIsOpeningVault(false)
    }
  }

  const loadNoteDocument = useCallback(async (note: Note) => {
    if (note.contentLoaded || !note.remotePath || !vaultSession || loadingNoteIdsRef.current.has(note.id)) return

    // 详情、路由恢复和嵌入预览共用同一读取入口，集合去重避免对坚果云产生重复 GET。
    loadingNoteIdsRef.current.add(note.id)

    try {
      const document = await vaultSession.readTextFile(note.remotePath)
      revisionByPathRef.current.set(note.remotePath, document.revision)
      setNotes((current) =>
        current.map((currentNote) =>
          currentNote.id === note.id
            ? {
                ...currentNote,
                baseContent: document.content,
                content: document.content,
                ...indexNoteContent(document.content),
                revision: document.revision,
                contentLoaded: true,
                readOnly: currentNote.format === "canvas" || (currentNote.source === "webdav" ? false : currentNote.readOnly),
                syncStatus: currentNote.source === "webdav" ? "synced" : currentNote.syncStatus,
              }
            : currentNote,
        ),
      )
      if (note.source === "webdav") {
        setSaveStates((current) => ({ ...current, [note.id]: { status: "saved" } }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取笔记失败"
      setNotes((current) =>
        current.map((currentNote) =>
          currentNote.id === note.id
            ? { ...currentNote, content: `# 读取失败\n\n${message}`, contentLoaded: true }
            : currentNote,
        ),
      )
    } finally {
      loadingNoteIdsRef.current.delete(note.id)
    }
  }, [vaultSession])

  const selectNote = async (note: Note) => {
    setActiveNoteId(note.id)
    setMobileScreen("editor")
    await loadNoteDocument(note)
  }

  const openNote = (note: Note) => {
    // 路由状态记录来源列表，刷新详情后依然能返回原目录，而不是退回一个含旧筛选的伪 `/notes`。
    const returnTo = noteRouteMatch
      ? getNoteReturnRoute(location.state, libraryView, selectedFolder)
      : getNotesListRoute(libraryView, selectedFolder)
    navigate(`/notes/${encodeURIComponent(note.id)}`, { state: { returnTo } })
    void selectNote(note)
  }

  useEffect(() => {
    const routeNoteId = noteRouteMatch?.params.noteId
    if (!routeNoteId) return
    const decodedNoteId = decodeURIComponent(routeNoteId)
    const routeNote = notes.find((note) => note.id === decodedNoteId)
    if (!routeNote) return
    setMobileScreen("editor")
    if (routeNote.id !== activeNoteId || (!routeNote.contentLoaded && vaultSession)) {
      void selectNote(routeNote)
    }
  }, [activeNoteId, noteRouteMatch?.params.noteId, notes, vaultSession])

  const reloadActiveNote = async () => {
    if (!activeNote) return
    if (activeNote.syncStatus === "modified" || activeNote.syncStatus === "conflict") {
      setVaultError("当前笔记有尚未同步的本地修改，不能直接用远端正文覆盖")
      return
    }
    const path = activeNote.remotePath
    if (!path || !vaultSession) return

    const pendingTimer = saveTimersRef.current.get(activeNote.id)
    if (pendingTimer) {
      window.clearTimeout(pendingTimer)
      saveTimersRef.current.delete(activeNote.id)
    }
    setSaveStates((current) => ({ ...current, [activeNote.id]: { status: "saving" } }))

    try {
      const document = await vaultSession.readTextFile(path)
      revisionByPathRef.current.set(path, document.revision)
      setNotes((current) => current.map((note) =>
        note.id === activeNote.id
          ? {
              ...note,
              baseContent: document.content,
              content: document.content,
              preview: buildNotePreview(document.content, note.format),
              ...indexNoteContent(document.content),
              revision: document.revision,
              updatedAt: "刚刚重新加载",
            }
          : note,
      ))
      setSaveStates((current) => ({
        ...current,
        [activeNote.id]: { status: "saved" },
      }))
      setVaultError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : "重新加载笔记失败"
      setSaveStates((current) => ({
        ...current,
        [activeNote.id]: { message, status: "error" },
      }))
      setVaultError(message)
    }
  }

  const resolveActiveConflict = async (strategy: "local" | "merge" | "remote") => {
    const note = activeNote
    const path = note?.previousRemotePath ?? note?.remotePath
    if (!note || note.syncStatus !== "conflict" || !path || !vaultSession) return
    if (strategy === "remote" && !window.confirm("采用云端版本会放弃这篇笔记尚未同步的本地修改，是否继续？")) {
      return
    }

    setSaveStates((current) => ({ ...current, [note.id]: { status: "saving" } }))
    setVaultError(null)
    try {
      // 三种选择都先读取最新远端版本：后续上传会基于新的 ETag，避免冲突处理期间再次覆盖他人修改。
      const remoteDocument = await vaultSession.readTextFile(path)
      const mergeResult = strategy === "merge"
        ? mergeMarkdownVersions(note.baseContent, note.content, remoteDocument.content)
        : null
      revisionByPathRef.current.set(path, remoteDocument.revision)
      setNotes((current) => current.map((candidate) => {
        if (candidate.id !== note.id) return candidate
        if (strategy === "local") {
          return {
            ...candidate,
            baseContent: remoteDocument.content,
            mergeConflictCount: undefined,
            revision: remoteDocument.revision,
            syncError: undefined,
            syncStatus: "modified",
          }
        }
        if (strategy === "merge" && mergeResult) {
          return {
            ...candidate,
            ...indexNoteContent(mergeResult.content),
            baseContent: remoteDocument.content,
            content: mergeResult.content,
            mergeConflictCount: mergeResult.conflictCount || undefined,
            preview: buildNotePreview(mergeResult.content, candidate.format),
            revision: remoteDocument.revision,
            syncError: undefined,
            syncStatus: mergeResult.conflictCount > 0 ? "conflict" : "modified",
            updatedAt: mergeResult.conflictCount > 0 ? "合并后仍有重叠修改" : "刚刚自动合并",
          }
        }
        return {
          ...candidate,
          baseContent: remoteDocument.content,
          content: remoteDocument.content,
          contentLoaded: true,
          ...indexNoteContent(remoteDocument.content),
          folder: deriveRemoteFolder(vaultSession.getDisplayPath?.(path) ?? path),
          id: `${vaultSession.kind}:${path}`,
          mergeConflictCount: undefined,
          pendingOperation: undefined,
          previousRemotePath: undefined,
          preview: buildNotePreview(remoteDocument.content, candidate.format),
          readOnly: false,
          remotePath: path,
          revision: remoteDocument.revision,
          syncError: undefined,
          syncStatus: "synced",
          title: path.split("/").pop()?.replace(/\.md$/i, "") ?? candidate.title,
          updatedAt: "刚刚采用云端版本",
        }
      }))
      setSaveStates((current) => ({
        ...current,
        [note.id]: strategy === "remote"
          ? { status: "saved" }
          : mergeResult && mergeResult.conflictCount > 0
            ? { message: `仍有 ${mergeResult.conflictCount} 处重叠修改`, status: "conflict" }
            : { status: "pending" },
      }))
      if (strategy === "remote" && note.id !== `${vaultSession.kind}:${path}`) {
        const restoredId = `${vaultSession.kind}:${path}`
        setSaveStates((current) => {
          const next = { ...current }
          delete next[note.id]
          next[restoredId] = { status: "saved" }
          return next
        })
        setActiveNoteId(restoredId)
        navigate(`/notes/${encodeURIComponent(restoredId)}`, { replace: true })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取云端冲突版本失败"
      setSaveStates((current) => ({ ...current, [note.id]: { message, status: "conflict" } }))
      setVaultError(message)
    }
  }

  const moveActiveNote = async (folderPath: string | null, requestedTitle?: string) => {
    const note = activeNote
    const adapter = vaultSession
    const isWebDavNote = note?.source === "webdav"
    if (!note?.remotePath || note.readOnly || (!adapter && !isWebDavNote)) {
      setVaultError("当前笔记不能移动，请打开一个可写的本地 Vault")
      return
    }
    if (saveStates[note.id]?.status === "saving") {
      setVaultError("笔记仍在保存，请稍后再移动")
      return
    }
    const pathSegments = note.remotePath.split("/").filter(Boolean)
    const normalizedTitle = requestedTitle?.trim().replace(/[\\/:*?"<>|]/g, "-")
    const filename = normalizedTitle ? `${normalizedTitle}.md` : pathSegments[pathSegments.length - 1]
    if (!filename) return
    const directory = folderPath?.split(/\s*\/\s*/).filter(Boolean).join("/") ?? ""
    const targetPath = directory ? `${directory}/${filename}` : filename
    const webDavConfig = loadWebDavConfig()
    const offlineWebDavTarget = `${webDavConfig.remotePath.replace(/\/+$/g, "")}/${targetPath.replace(/^\/+/, "")}`
      .replace(/\/{2,}/g, "/")
    const storageTargetPath = adapter?.getStoragePath?.(targetPath)
      ?? (isWebDavNote ? offlineWebDavTarget : targetPath)
    if (storageTargetPath === note.remotePath) return

    if (note.pendingOperation === "create") {
      const nextId = `webdav:${storageTargetPath}`
      // 尚未上传的新笔记移动时只改本地目标路径，不会产生任何远端 MOVE 请求。
      setNotes((current) => current.map((candidate) => candidate.id === note.id
        ? {
            ...candidate,
            folder: deriveRemoteFolder(targetPath),
            id: nextId,
            remotePath: storageTargetPath,
            title: normalizedTitle || candidate.title,
            updatedAt: "刚刚移动 · 待同步",
          }
        : candidate))
      setSaveStates((current) => {
        const next = { ...current }
        delete next[note.id]
        next[nextId] = { status: "pending" }
        return next
      })
      setActiveNoteId(nextId)
      if (activeCacheMeta?.sourceKind === "webdav") {
        void remapVaultAttachmentNoteId(activeCacheMeta.id, note.id, nextId)
      }
      navigate(`/notes/${encodeURIComponent(nextId)}`, { replace: true })
      return
    }

    if (isWebDavNote) {
      const nextId = `webdav:${storageTargetPath}`
      // 已存在的云端笔记先记录原路径；真正 MOVE 仅由显式同步触发并携带 ETag 条件。
      setNotes((current) => current.map((candidate) => candidate.id === note.id
        ? {
            ...candidate,
            folder: deriveRemoteFolder(targetPath),
            id: nextId,
            pendingOperation: "move",
            previousRemotePath: candidate.previousRemotePath ?? candidate.remotePath,
            remotePath: storageTargetPath,
            syncError: undefined,
            syncStatus: "modified",
            writeContentAfterMove: true,
            title: normalizedTitle || candidate.title,
            updatedAt: "刚刚移动 · 待同步",
          }
        : candidate))
      setSaveStates((current) => {
        const next = { ...current }
        delete next[note.id]
        next[nextId] = { status: "pending" }
        return next
      })
      setActiveNoteId(nextId)
      if (activeCacheMeta?.sourceKind === "webdav") {
        void remapVaultAttachmentNoteId(activeCacheMeta.id, note.id, nextId)
      }
      navigate(`/notes/${encodeURIComponent(nextId)}`, { replace: true })
      return
    }

    if (!adapter?.moveTextFile) {
      setVaultError("当前笔记库不支持移动文件")
      return
    }

    setIsManagingNote(true)
    setVaultError(null)
    try {
      const result = await adapter.moveTextFile(note.remotePath, storageTargetPath)
      const nextId = `${adapter.kind}:${result.path}`
      revisionByPathRef.current.delete(note.remotePath)
      revisionByPathRef.current.set(result.path, result.revision)
      saveQueuesRef.current.delete(note.remotePath)
      setNotes((current) => current.map((candidate) => candidate.id === note.id
        ? {
            ...candidate,
            folder: deriveRemoteFolder(result.path),
            id: nextId,
            remotePath: result.path,
            revision: result.revision,
            title: normalizedTitle || candidate.title,
            updatedAt: "刚刚移动",
            modifiedAt: Date.now(),
          }
        : candidate))
      setSaveStates((current) => {
        const next = { ...current }
        delete next[note.id]
        next[nextId] = { status: "saved" }
        return next
      })
      setActiveNoteId(nextId)
      navigate(`/notes/${encodeURIComponent(nextId)}`, { replace: true })
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "移动笔记失败")
    } finally {
      setIsManagingNote(false)
    }
  }

  const createLocalFolder = async (requestedName: string, parentFolder: string | null) => {
    const adapter = vaultSession
    if (!adapter?.createDirectory || (adapter.kind !== "browser" && adapter.kind !== "tauri")) {
      setVaultError("请先打开可写的本地 Vault")
      return
    }
    const name = sanitizeFolderName(requestedName)
    if (!name) {
      setVaultError("文件夹名称无效，请换一个名称")
      return
    }
    const folderPath = parentFolder ? `${parentFolder} / ${name}` : name
    if (folders.some((folder) => folder.path === folderPath)) {
      setVaultError(`文件夹已存在：${folderPath}`)
      return
    }

    setIsManagingNote(true)
    setVaultError(null)
    try {
      await adapter.createDirectory(toStorageDirectoryPath(folderPath))
      setVaultDirectories((current) => [...new Set([...current, folderPath])])
      setLibraryView("all")
      setSelectedFolder(folderPath)
      setMobileScreen("notes")
      navigate(getNotesListRoute("all", folderPath))
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "新建文件夹失败")
    } finally {
      setIsManagingNote(false)
    }
  }

  const renameLocalFolder = async (folderPath: string, requestedName: string) => {
    const adapter = vaultSession
    if (!adapter?.moveDirectory || (adapter.kind !== "browser" && adapter.kind !== "tauri")) {
      setVaultError("当前本地 Vault 不支持文件夹重命名")
      return
    }
    const name = sanitizeFolderName(requestedName)
    const segments = folderPath.split(/\s*\/\s*/).filter(Boolean)
    if (!name || segments.length === 0) {
      setVaultError("文件夹名称无效，请换一个名称")
      return
    }
    const targetFolder = [...segments.slice(0, -1), name].join(" / ")
    if (targetFolder === folderPath) return
    if (folders.some((folder) => folder.path === targetFolder)) {
      setVaultError(`目标文件夹已存在：${targetFolder}`)
      return
    }
    const candidates = notes.filter((note) => note.source === "local" && noteBelongsToFolder(note, folderPath))
    if (candidates.some((note) => saveStates[note.id]?.status === "saving")) {
      setVaultError("该目录仍有笔记正在保存，请稍后再重命名")
      return
    }

    setIsManagingNote(true)
    setVaultError(null)
    try {
      await adapter.moveDirectory(
        toStorageDirectoryPath(folderPath),
        toStorageDirectoryPath(targetFolder),
      )
      const plans = new Map(candidates.flatMap((note) => {
        const filename = note.remotePath?.split("/").pop()
        const target = filename
          ? getFolderRenameTarget(note.folder, folderPath, name, filename)
          : null
        return target ? [[note.id, {
          folder: target.folder,
          id: `${adapter.kind}:${target.relativePath}`,
          remotePath: target.relativePath,
        }] as const] : []
      }))
      // 目录级移动已经由适配器原子完成，内存索引只需同步换路径，不再逐篇重复写盘。
      setNotes((current) => current.map((note) => {
        const plan = plans.get(note.id)
        return plan ? { ...note, ...plan, modifiedAt: Date.now(), updatedAt: "刚刚移动" } : note
      }))
      setSaveStates((current) => {
        const next = { ...current }
        for (const [previousId, plan] of plans) {
          const state = next[previousId]
          delete next[previousId]
          next[plan.id] = state ?? { status: "saved" }
        }
        return next
      })
      for (const note of candidates) {
        const plan = plans.get(note.id)
        if (!plan || !note.remotePath) continue
        revisionByPathRef.current.delete(note.remotePath)
        revisionByPathRef.current.set(plan.remotePath, note.revision)
      }
      setVaultDirectories((current) => current.map((path) =>
        replaceFolderPrefix(path, folderPath, targetFolder),
      ))
      const activePlan = plans.get(activeNoteId)
      if (activePlan) setActiveNoteId(activePlan.id)
      setSelectedFolder(targetFolder)
      setLibraryView("all")
      setMobileScreen("notes")
      navigate(getNotesListRoute("all", targetFolder), { replace: true })
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "重命名文件夹失败")
    } finally {
      setIsManagingNote(false)
    }
  }

  const deleteLocalFolder = async (folderPath: string) => {
    const adapter = vaultSession
    if (!adapter?.moveDirectory || (adapter.kind !== "browser" && adapter.kind !== "tauri")) {
      setVaultError("当前本地 Vault 不支持删除文件夹")
      return
    }
    const candidates = notes.filter((note) => note.source === "local" && noteBelongsToFolder(note, folderPath))
    if (candidates.some((note) => saveStates[note.id]?.status === "saving")) {
      setVaultError("该目录仍有笔记正在保存，请稍后再删除")
      return
    }

    setIsManagingNote(true)
    setVaultError(null)
    try {
      const trashId = createTrashId()
      const originalPath = toStorageDirectoryPath(folderPath)
      const trashedPath = buildLocalTrashPath(trashId, originalPath)
      await adapter.moveDirectory(originalPath, trashedPath)
      const candidateIds = new Set(candidates.map((note) => note.id))
      const remainingNotes = notes.filter((note) => !candidateIds.has(note.id))
      setNotes(remainingNotes)
      setVaultDirectories((current) => current.filter((path) =>
        path !== folderPath && !path.startsWith(`${folderPath} / `),
      ))
      setSaveStates((current) => {
        const next = { ...current }
        for (const noteId of candidateIds) delete next[noteId]
        return next
      })
      setVaultNoteCount((count) => Math.max(0, count - candidateIds.size))
      setTrashEntries((current) => [{
        deletedAt: Date.now(),
        folderPath,
        id: trashId,
        kind: "folder",
        notes: candidates,
        originalPath,
        source: "local",
        trashedPath,
      }, ...current])
      if (candidateIds.has(activeNoteId)) setActiveNoteId(remainingNotes[0]?.id ?? "")
      setSelectedFolder(null)
      setLibraryView("all")
      setMobileScreen("library")
      navigate("/notes", { replace: true })
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "删除文件夹失败")
    } finally {
      setIsManagingNote(false)
    }
  }

  const renameWebDavFolder = (folderPath: string, requestedName: string) => {
    if (isRefreshingVault || isManagingNote) {
      setVaultError("正在处理笔记库，请稍后再重命名文件夹")
      return
    }
    if (activeCacheMeta?.sourceKind !== "webdav") {
      setVaultError("当前版本先支持坚果云文件夹批量重命名")
      return
    }
    const candidates = notes.filter((note) => note.source === "webdav"
      && note.pendingOperation !== "delete"
      && noteBelongsToFolder(note, folderPath))
    if (candidates.length === 0) return
    if (candidates.some((note) => !note.remotePath
      || (note.pendingOperation !== "create" && !note.revision))) {
      setVaultError("该目录仍有远端版本信息尚未读取，请重新连接后再重命名")
      return
    }

    const webDavConfig = loadWebDavConfig()
    const candidateIds = new Set(candidates.map((note) => note.id))
    const occupiedPaths = new Set(notes
      .filter((note) => !candidateIds.has(note.id) && note.pendingOperation !== "delete")
      .map((note) => note.remotePath)
      .filter((path): path is string => Boolean(path)))
    const plans = new Map<string, { folder: string; id: string; remotePath: string }>()

    for (const note of candidates) {
      const pathSegments = note.remotePath!.split("/").filter(Boolean)
      const filename = pathSegments[pathSegments.length - 1]
      const target = filename
        ? getFolderRenameTarget(note.folder, folderPath, requestedName, filename)
        : null
      if (!target) {
        setVaultError("文件夹名称无效，请换一个名称")
        return
      }
      const remotePath = vaultSession?.getStoragePath?.(target.relativePath)
        ?? `${webDavConfig.remotePath.replace(/\/+$/g, "")}/${target.relativePath}`.replace(/\/{2,}/g, "/")
      if (occupiedPaths.has(remotePath)) {
        setVaultError(`目标目录已存在同名笔记：${filename}`)
        return
      }
      plans.set(note.id, { folder: target.folder, id: `webdav:${remotePath}`, remotePath })
    }

    setIsManagingNote(true)
    setVaultError(null)
    // 批量重命名只改 IndexedDB 工作副本；每篇 MOVE 仍在统一同步链路中串行执行并校验 ETag。
    setNotes((current) => current.map((note) => {
      const plan = plans.get(note.id)
      if (!plan) return note
      return {
        ...note,
        ...plan,
        pendingOperation: note.pendingOperation === "create" ? "create" : "move",
        previousRemotePath: note.pendingOperation === "create"
          ? undefined
          : note.previousRemotePath ?? note.remotePath,
        syncError: undefined,
        syncStatus: "modified",
        updatedAt: "文件夹已在本机重命名 · 待同步",
        writeContentAfterMove: note.pendingOperation === "create"
          ? undefined
          : note.pendingOperation === "move" ? note.writeContentAfterMove : false,
      }
    }))
    setSaveStates((current) => {
      const next = { ...current }
      for (const [oldId, plan] of plans) {
        delete next[oldId]
        next[plan.id] = { status: "pending" }
      }
      return next
    })
    const activePlan = plans.get(activeNoteId)
    if (activePlan) setActiveNoteId(activePlan.id)
    if (activeCacheMeta?.sourceKind === "webdav") {
      for (const [previousNoteId, plan] of plans) {
        void remapVaultAttachmentNoteId(activeCacheMeta.id, previousNoteId, plan.id)
      }
    }
    const firstPlan = plans.values().next().value as { folder: string } | undefined
    if (firstPlan) {
      setSelectedFolder(firstPlan.folder.split(/\s*\/\s*/).slice(0, folderPath.split(/\s*\/\s*/).length).join(" / "))
      setLibraryView("all")
      setMobileScreen("notes")
      navigate(getNotesListRoute("all", firstPlan.folder.split(/\s*\/\s*/).slice(0, folderPath.split(/\s*\/\s*/).length).join(" / ")), { replace: true })
    }
    setIsManagingNote(false)
  }

  const deleteWebDavFolder = (folderPath: string) => {
    if (activeCacheMeta?.sourceKind !== "webdav" || isRefreshingVault) {
      setVaultError("当前状态不能删除该文件夹")
      return
    }
    const candidates = notes
      .filter((note) => note.source === "webdav" && note.pendingOperation !== "delete" && noteBelongsToFolder(note, folderPath))
    const candidateIds = new Set(candidates.map((note) => note.id))
    if (candidateIds.size === 0) return
    const createdIds = new Set(notes
      .filter((note) => candidateIds.has(note.id) && note.pendingOperation === "create")
      .map((note) => note.id))
    if (activeCacheMeta?.sourceKind === "webdav" && createdIds.size > 0) {
      void discardPendingVaultAttachments(activeCacheMeta.id, createdIds)
        .then(() => listPendingVaultAttachments(activeCacheMeta.id))
        .then((entries) => setPendingAttachmentCount(entries.length))
    }
    // 已上传文件进入可撤销墓碑；从未上传的新文件直接撤销创建，因此不会产生远端 DELETE。
    setNotes((current) => current
      .filter((note) => !createdIds.has(note.id))
      .map((note) => candidateIds.has(note.id)
        ? {
            ...note,
            operationBeforeDelete: note.pendingOperation === "move" ? "move" as const : undefined,
            pendingOperation: "delete" as const,
            previousRemotePath: note.previousRemotePath ?? note.remotePath,
            syncError: undefined,
            syncStatus: "modified" as const,
            updatedAt: "文件夹已在本机删除 · 待同步",
          }
        : note))
    setSaveStates((current) => {
      const next = { ...current }
      for (const noteId of candidateIds) {
        if (createdIds.has(noteId)) delete next[noteId]
        else next[noteId] = { status: "pending" }
      }
      return next
    })
    setVaultNoteCount((count) => Math.max(0, count - candidateIds.size))
    setTrashEntries((current) => [{
      deletedAt: Date.now(),
      folderPath,
      id: createTrashId(),
      kind: "folder",
      notes: candidates,
      originalPath: folderPath,
      source: "webdav",
    }, ...current])
    if (candidateIds.has(activeNoteId)) {
      const fallback = availableNotes.find((note) => !candidateIds.has(note.id))
      setActiveNoteId(fallback?.id ?? "")
    }
    setSelectedFolder(null)
    setLibraryView("all")
    setMobileScreen("library")
    navigate("/notes", { replace: true })
  }

  const renameFolder = (folderPath: string, requestedName: string) => {
    if (vaultSession?.kind === "browser" || vaultSession?.kind === "tauri") {
      void renameLocalFolder(folderPath, requestedName)
      return
    }
    renameWebDavFolder(folderPath, requestedName)
  }

  const deleteFolder = (folderPath: string) => {
    if (vaultSession?.kind === "browser" || vaultSession?.kind === "tauri") {
      void deleteLocalFolder(folderPath)
      return
    }
    deleteWebDavFolder(folderPath)
  }

  const deleteActiveNote = async () => {
    const note = activeNote
    const adapter = vaultSession
    const isWebDavNote = note?.source === "webdav"
    if (!note?.remotePath || note.readOnly || (!adapter && !isWebDavNote)) {
      setVaultError("当前笔记不能删除，请打开一个可写的本地 Vault")
      return
    }
    if (saveStates[note.id]?.status === "saving") {
      setVaultError("笔记仍在保存，请稍后再删除")
      return
    }
    const notePath = note.remotePath
    if (isWebDavNote && note.pendingOperation === "create" && activeCacheMeta?.sourceKind === "webdav") {
      await discardPendingVaultAttachments(activeCacheMeta.id, new Set([note.id]))
      setPendingAttachmentCount((await listPendingVaultAttachments(activeCacheMeta.id)).length)
    }

    if (note.pendingOperation === "create") {
      const currentIndex = notes.findIndex((candidate) => candidate.id === note.id)
      const remainingNotes = notes.filter((candidate) => candidate.id !== note.id)
      const nextNote = remainingNotes[Math.min(Math.max(currentIndex, 0), remainingNotes.length - 1)] ?? null
      // 未同步的新笔记只存在于本机，删除它等价于撤销创建，不涉及远端数据。
      setNotes(remainingNotes)
      setSaveStates((current) => {
        const next = { ...current }
        delete next[note.id]
        return next
      })
      setVaultNoteCount((count) => Math.max(0, count - 1))
      setTrashEntries((current) => [{
        deletedAt: Date.now(),
        id: createTrashId(),
        kind: "note",
        notes: [note],
        originalPath: notePath,
        source: "webdav",
      }, ...current])
      setActiveNoteId(nextNote?.id ?? "")
      setMobileScreen(nextNote ? "editor" : "notes")
      navigate(nextNote ? `/notes/${encodeURIComponent(nextNote.id)}` : "/notes", { replace: true })
      return
    }

    if (isWebDavNote) {
      const currentIndex = availableNotes.findIndex((candidate) => candidate.id === note.id)
      const nextVisibleNotes = availableNotes.filter((candidate) => candidate.id !== note.id)
      const nextNote = nextVisibleNotes[Math.min(Math.max(currentIndex, 0), nextVisibleNotes.length - 1)] ?? null
      // 删除先写入本地墓碑并从界面隐藏，远端 DELETE 仍需用户点击同步才会执行。
      setNotes((current) => current.map((candidate) => candidate.id === note.id
        ? {
            ...candidate,
            operationBeforeDelete: candidate.pendingOperation === "move" ? "move" : undefined,
            pendingOperation: "delete",
            previousRemotePath: candidate.previousRemotePath ?? candidate.remotePath,
            syncError: undefined,
            syncStatus: "modified",
            updatedAt: "已在本机删除 · 待同步",
          }
        : candidate))
      setSaveStates((current) => ({ ...current, [note.id]: { status: "pending" } }))
      setVaultNoteCount((count) => Math.max(0, count - 1))
      setTrashEntries((current) => [{
        deletedAt: Date.now(),
        id: createTrashId(),
        kind: "note",
        notes: [note],
        originalPath: notePath,
        source: "webdav",
      }, ...current])
      setActiveNoteId(nextNote?.id ?? "")
      setMobileScreen(nextNote ? "editor" : "notes")
      navigate(nextNote ? `/notes/${encodeURIComponent(nextNote.id)}` : "/notes", { replace: true })
      return
    }

    if (!adapter?.moveTextFile) {
      setVaultError("当前笔记库不支持删除文件")
      return
    }

    setIsManagingNote(true)
    setVaultError(null)
    try {
      const trashId = createTrashId()
      const trashedPath = buildLocalTrashPath(trashId, notePath)
      await adapter.moveTextFile(notePath, trashedPath)
      const currentIndex = notes.findIndex((candidate) => candidate.id === note.id)
      const remainingNotes = notes.filter((candidate) => candidate.id !== note.id)
      const nextNote = remainingNotes[Math.min(Math.max(currentIndex, 0), remainingNotes.length - 1)] ?? null

      revisionByPathRef.current.delete(note.remotePath)
      saveQueuesRef.current.delete(note.remotePath)
      setNotes(remainingNotes)
      setSaveStates((current) => {
        const next = { ...current }
        delete next[note.id]
        return next
      })
      setVaultNoteCount((count) => Math.max(0, count - 1))
      setTrashEntries((current) => [{
        deletedAt: Date.now(),
        id: trashId,
        kind: "note",
        notes: [note],
        originalPath: notePath,
        source: "local",
        trashedPath,
      }, ...current])
      setActiveNoteId(nextNote?.id ?? "")
      setMobileScreen(nextNote ? "editor" : "notes")
      navigate(nextNote ? `/notes/${encodeURIComponent(nextNote.id)}` : "/notes", { replace: true })
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "删除笔记失败")
    } finally {
      setIsManagingNote(false)
    }
  }

  const restoreTrashEntries = async (entryIds: ReadonlySet<string>) => {
    const entries = trashEntries.filter((entry) => entryIds.has(entry.id))
    if (entries.length === 0) return
    setIsManagingNote(true)
    setVaultError(null)
    const restoredEntryIds = new Set<string>()
    let restoredNoteCount = 0

    for (const entry of entries) {
      try {
        if (entry.source === "local") {
          const adapter = vaultSession
          if (!adapter || (adapter.kind !== "browser" && adapter.kind !== "tauri") || !entry.trashedPath) {
            throw new Error("请重新打开原本地 Vault 后再恢复")
          }
          if (entry.kind === "folder") {
            if (!adapter.moveDirectory) throw new Error("当前客户端不支持恢复文件夹")
            await adapter.moveDirectory(entry.trashedPath, entry.originalPath)
          } else {
            if (!adapter.moveTextFile) throw new Error("当前客户端不支持恢复文件")
            await adapter.moveTextFile(entry.trashedPath, entry.originalPath)
          }
          const restoredNotes = await Promise.all(entry.notes.map(async (note) => {
            if (!note.remotePath) return { ...note, updatedAt: "刚刚恢复" }
            const document = await adapter.readTextFile(note.remotePath)
            revisionByPathRef.current.set(note.remotePath, document.revision)
            return { ...note, revision: document.revision, updatedAt: "刚刚恢复" }
          }))
          setNotes((current) => [...restoredNotes, ...current])
          setSaveStates((current) => ({
            ...current,
            ...Object.fromEntries(entry.notes.map((note) => [note.id, { status: "saved" as const }])),
          }))
          if (adapter.listDirectories) {
            const directories = await adapter.listDirectories()
            setVaultDirectories(directories.map(deriveDirectoryPath))
          }
        } else {
          // 同步前仍保留墓碑时直接撤销；远端已经删除时则以原正文建立“待创建”工作副本。
          setNotes((current) => {
            const next = [...current]
            for (const snapshot of entry.notes) {
              const existingIndex = next.findIndex((note) => note.id === snapshot.id && note.pendingOperation === "delete")
              if (existingIndex >= 0) {
                const existing = next[existingIndex]
                next[existingIndex] = {
                  ...existing,
                  operationBeforeDelete: undefined,
                  pendingOperation: existing.operationBeforeDelete,
                  syncError: undefined,
                  syncStatus: existing.operationBeforeDelete ? "modified" : "synced",
                  updatedAt: "刚刚恢复",
                }
                continue
              }
              const remotePath = snapshot.remotePath ?? entry.originalPath
              next.unshift({
                ...snapshot,
                id: `webdav:${remotePath}`,
                operationBeforeDelete: undefined,
                pendingOperation: "create",
                previousRemotePath: undefined,
                readOnly: false,
                remotePath,
                revision: undefined,
                syncError: undefined,
                syncStatus: "modified",
                updatedAt: "已从回收站恢复 · 待同步",
              })
            }
            return next
          })
          setSaveStates((current) => ({
            ...current,
            ...Object.fromEntries(entry.notes.map((note) => [note.id, { status: "pending" as const }])),
          }))
        }
        restoredNoteCount += entry.notes.length
        restoredEntryIds.add(entry.id)
      } catch (error) {
        setVaultError(error instanceof Error ? error.message : "恢复回收站项目失败")
      }
    }

    if (restoredEntryIds.size > 0) {
      setTrashEntries((current) => current.filter((entry) => !restoredEntryIds.has(entry.id)))
      setVaultNoteCount((count) => count + restoredNoteCount)
    }
    setIsManagingNote(false)
  }

  const purgeTrashEntries = async (entryIds: ReadonlySet<string>) => {
    const entries = trashEntries.filter((entry) => entryIds.has(entry.id))
    const purgedIds = new Set<string>()
    for (const entry of entries) {
      try {
        if (entry.source === "local") {
          const adapter = vaultSession
          if (!adapter || (adapter.kind !== "browser" && adapter.kind !== "tauri") || !entry.trashedPath) continue
          if (entry.kind === "folder") {
            if (!adapter.deleteDirectory) continue
            await adapter.deleteDirectory(entry.trashedPath)
          } else {
            if (!adapter.deleteTextFile) continue
            await adapter.deleteTextFile(entry.trashedPath)
          }
        }
        purgedIds.add(entry.id)
      } catch (error) {
        setVaultError(error instanceof Error ? error.message : "清理回收站失败")
      }
    }
    if (purgedIds.size > 0) setTrashEntries((current) => current.filter((entry) => !purgedIds.has(entry.id)))
  }

  const restoreDeletedNote = (noteId: string) => {
    const entry = trashEntries.find((candidate) => candidate.notes.some((note) => note.id === noteId))
    if (!entry) return
    if (entry.notes.length === 1) {
      void restoreTrashEntries(new Set([entry.id]))
      return
    }
    const note = notes.find((candidate) => candidate.id === noteId && candidate.pendingOperation === "delete")
    if (!note) return
    setNotes((current) => current.map((candidate) => candidate.id === noteId
      ? {
          ...candidate,
          operationBeforeDelete: undefined,
          pendingOperation: candidate.operationBeforeDelete,
          syncError: undefined,
          syncStatus: candidate.operationBeforeDelete ? "modified" : "synced",
          updatedAt: "刚刚恢复",
        }
      : candidate))
    setTrashEntries((current) => current.map((candidate) => candidate.id === entry.id
      ? { ...candidate, notes: candidate.notes.filter((item) => item.id !== noteId) }
      : candidate))
    setSaveStates((current) => ({
      ...current,
      [noteId]: note.operationBeforeDelete ? { status: "pending" } : { status: "saved" },
    }))
    setVaultNoteCount((count) => count + 1)
  }

  const changeTrashRetention = (retention: TrashRetentionDays) => {
    saveTrashRetention(retention)
    setTrashRetention(retention)
  }

  useEffect(() => {
    const expiredIds = new Set(trashEntries
      .filter((entry) => isTrashEntryExpired(entry, trashRetention))
      .map((entry) => entry.id))
    if (expiredIds.size > 0) void purgeTrashEntries(expiredIds)
    // 保留期限变化或重新连接本地 Vault 时再次尝试，未连接的本地回收项不会只删元数据而遗留孤儿文件。
  }, [trashEntries, trashRetention, vaultSession])

  const findWikiNote = useCallback((target: string, sourceNotes: Note[] = notes) => {
    const { noteTarget } = splitWikiTarget(target)
    const normalizedTarget = normalizeNoteTarget(noteTarget)
    // 空笔记目标表示同文档锚点；标准 Markdown 与旧双链都回退到当前打开的笔记。
    if (!normalizedTarget) return activeNote ?? null
    const markdownHref = parseMarkdownNoteHref(noteTarget)
    const resolvedPath = markdownHref && activeNote?.remotePath
      ? resolveVaultAssetPath(activeNote.remotePath, markdownHref)
      : null
    if (resolvedPath) {
      const normalizedPath = resolvedPath.replace(/^\/+/, "").toLocaleLowerCase()
      const exactNote = sourceNotes.find((note) => note.remotePath?.replace(/^\/+/, "").toLocaleLowerCase() === normalizedPath)
      if (exactNote) return exactNote
    }
    return sourceNotes.find((note) =>
      normalizeNoteTarget(note.title) === normalizedTarget
      || (note.remotePath && normalizeNoteTarget(note.remotePath) === normalizedTarget),
    )
  }, [activeNote, notes])

  const resolveWikiNote = useCallback((target: string) => {
    const linkedNote = findWikiNote(target)
    if (!linkedNote) return { status: "missing" as const }
    return linkedNote.contentLoaded
      ? { note: { content: linkedNote.content, title: linkedNote.title }, status: "ready" as const }
      : { status: "loading" as const }
  }, [findWikiNote])

  const loadWikiNote = useCallback((target: string) => {
    const linkedNote = findWikiNote(target, notesRef.current)
    if (linkedNote) void loadNoteDocument(linkedNote)
  }, [findWikiNote, loadNoteDocument])

  const openWikiLink = (target: string) => {
    const { anchor, noteTarget } = splitWikiTarget(target)
    const normalizedTarget = normalizeNoteTarget(noteTarget)
    // 标准 Markdown 优先按相对文件路径精确匹配；旧双链再按标题兼容匹配。
    const markdownHref = parseMarkdownNoteHref(noteTarget)
    const resolvedPath = markdownHref && activeNote?.remotePath
      ? resolveVaultAssetPath(activeNote.remotePath, markdownHref)
      : null
    const normalizedPath = resolvedPath?.replace(/^\/+/, "").toLocaleLowerCase()
    const linkedNote = normalizedPath
      ? notes.find((note) => note.remotePath?.replace(/^\/+/, "").toLocaleLowerCase() === normalizedPath)
      : normalizedTarget ? notes.find((note) =>
          normalizeNoteTarget(note.title) === normalizedTarget
          || (note.remotePath && normalizeNoteTarget(note.remotePath) === normalizedTarget),
        )
      : activeNote

    if (linkedNote) {
      setVaultError(null)
      pendingWikiAnchorRef.current = anchor
      openNote(linkedNote)
      return
    }

    setVaultError(`找不到链接笔记：${target}`)
  }

  const openActiveSourceFile = async () => {
    if (!activeNote?.remotePath) return
    try {
      if (vaultSession?.openSourceFile) {
        await vaultSession.openSourceFile(activeNote.remotePath)
        return
      }
      // Web 与 WebDAV 不能调用本机默认应用，显式下载原始文本是可恢复且不修改云端的降级路径。
      const url = URL.createObjectURL(new Blob([activeNote.content], { type: "text/markdown;charset=utf-8" }))
      const anchor = document.createElement("a")
      anchor.download = activeNote.remotePath.split("/").pop() ?? `${activeNote.title}.excalidraw.md`
      anchor.href = url
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "无法打开原始文件")
    }
  }

  useEffect(() => {
    const anchor = pendingWikiAnchorRef.current
    if (!anchor || !activeNote?.contentLoaded) return
    const id = obsidianAnchorId(anchor)
    let attempts = 0
    let frame = 0
    let cancelled = false
    // 预览模块按需加载，短暂逐帧等待目标出现，避免路由完成但标题 DOM 尚未挂载导致定位失效。
    const scrollWhenReady = () => {
      if (cancelled) return
      const element = Array.from(document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`))
        .find((candidate) => candidate.getClientRects().length > 0)
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" })
        pendingWikiAnchorRef.current = ""
        return
      }
      attempts += 1
      if (attempts < 20) frame = window.requestAnimationFrame(scrollWhenReady)
      else pendingWikiAnchorRef.current = ""
    }
    frame = window.requestAnimationFrame(scrollWhenReady)
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [activeNote?.contentLoaded, activeNote?.id])

  return (
    <>
      <Routes>
      <Route element={<Navigate replace to="/notes" />} path="/" />
      <Route
        path="/notes/*"
        element={(
          <Workspace
            activeCacheId={activeCacheMeta?.id ?? null}
            activeNote={activeNote}
            activeNoteId={activeNoteId}
            availableTags={availableTags}
            backlinks={backlinks}
            cloudConnected={vaultSession?.kind === "webdav"}
            connectionLabel={connectionLabel}
            connected={connected}
            canCreateNote={Boolean(
              (vaultSession && (vaultSession.kind === "webdav" || (vaultSession.createTextFile && !vaultSession.readOnly)))
              || (!vaultSession && activeCacheMeta?.sourceKind === "webdav" && webDavConfigured),
            )}
            canCreateFolder={Boolean(
              vaultSession?.createDirectory
              && (vaultSession.kind === "browser" || vaultSession.kind === "tauri"),
            )}
            canInsertAttachment={canWriteVaultAttachments(vaultSession)
              || (activeNote?.source === "webdav" && activeCacheMeta?.sourceKind === "webdav")}
            folders={folders}
            folderManagementMode={vaultSession?.kind === "browser" || vaultSession?.kind === "tauri"
              ? "local"
              : activeCacheMeta?.sourceKind === "webdav" ? "webdav" : null}
            isOpeningVault={isOpeningVault}
            isCreatingNote={isCreatingNote}
            isManagingNote={isManagingNote}
            isNoteDetailRoute={Boolean(noteRouteMatch?.params.noteId)}
            includeNestedFolderNotes={includeNestedFolderNotes}
            isRefreshingVault={isRefreshingVault}
            libraryView={libraryView}
            localVaultSupported={canSelectLocalVault()}
            mobileScreen={mobileScreen}
            mobileConnectionLabel={mobileConnectionLabel}
            mobileListStateKey={normalizedQuery}
            noteSort={noteSort}
            notes={visibleNotes}
            onCreateNote={() => void createNote()}
            onCreateFolder={(name, parentFolder) => void createLocalFolder(name, parentFolder)}
            onDeleteNote={() => void deleteActiveNote()}
            onDeleteFolder={deleteFolder}
            onFormat={formatActiveNote}
            onFormatNote={formatNoteById}
            onInsertAttachments={insertActiveNoteAttachments}
            onIncludeNestedFolderNotesChange={(include) => {
              // 聚合偏好绑定到当前路径，切换目录时无需等待 effect 即可恢复“仅当前层”，避免旧内容闪现。
              setNestedFolderNotesPath(include ? selectedFolder : null)
            }}
            onMobileScreenChange={(screen) => {
              setMobileScreen(screen)
              if (screen === "library") {
                navigate("/notes")
                return
              }
              if (screen === "notes" && noteRouteMatch) {
                navigate(getNoteReturnRoute(location.state, libraryView, selectedFolder), { replace: true })
              }
            }}
            onNavigate={navigate}
            onMoveNote={(folderPath) => void moveActiveNote(folderPath)}
            onRenameFolder={renameFolder}
            onRenameNote={(title) => void moveActiveNote(activeNote?.folder === "根目录" ? null : activeNote?.folder ?? null, title)}
            onOpenLocalVault={() => void openLocalVault()}
            onOpenSourceFile={() => void openActiveSourceFile()}
            onOpenWikiLink={openWikiLink}
            onOpenSettings={() => navigate(webDavConfigured ? "/settings/sync" : "/settings/webdav")}
            onQueryChange={setQuery}
            onNoteSortChange={setNoteSort}
            onReloadNote={() => void reloadActiveNote()}
            onRefreshVault={() => void refreshVault()}
            onResolveConflict={(strategy) => void resolveActiveConflict(strategy)}
            onResolveAsset={resolveActiveAsset}
            onLoadWikiNote={loadWikiNote}
            onResolveWikiNote={resolveWikiNote}
            onToggleNoteTask={(noteId, line, checked) => toggleTask({
              checked,
              id: `${noteId}:${line}`,
              line,
              noteId,
              noteTitle: "",
              text: "",
            }, checked)}
            onSelectFolder={(folder) => {
              setLibraryView("all")
              setSelectedFolder(folder)
              setMobileScreen("notes")
              navigate(folder ? getNotesListRoute("all", folder) : getNotesListRoute("all", null))
            }}
            onSelectLibraryView={(view) => {
              setLibraryView(view)
              setSelectedFolder(null)
              setMobileScreen("notes")
              navigate(getNotesListRoute(view, null))
            }}
            onSelectNote={openNote}
            onSelectTag={setSelectedTag}
            onSelectVaultCache={(cacheId) => void selectVaultCache(cacheId)}
            onUpdateNote={updateActiveNote}
            query={query}
            selectedFolder={selectedFolder}
            selectedTag={selectedTag}
            saveState={saveStates[activeNoteId] ?? {
              status: activeNote ? getNoteSaveState(activeNote).status : "saved",
            }}
            syncLabel={syncLabel}
            starredNoteCount={availableNotes.filter((note) => note.starred).length}
            totalNoteCount={availableNotes.length}
            vaultError={vaultError}
            vaultCaches={vaultCaches}
          />
        )}
      />
      <Route
        path="/todos"
        element={(
          <TodoPage
            connected={connected}
            indexProgress={indexProgress}
            notes={availableNotes}
            onCreateTask={createTask}
            quickTaskTargetTitle={quickTaskTarget?.title ?? null}
            onNavigate={navigate}
            onOpenNote={(note) => {
              openNote(note)
            }}
            onOpenSync={() => navigate("/settings/sync")}
            onToggleTask={toggleTask}
          />
        )}
      />
      <Route
        path="/settings"
        element={<SettingsLayout connected={connected} onNavigate={navigate} onOpenSync={() => navigate("/settings/sync")} />}
      >
        <Route index element={<SettingsOverview onNavigate={navigate} />} />
        <Route
          path="sync"
          element={(
            <SyncSettingsPage
              autoSyncMode={autoSyncMode}
              connected={vaultSession?.kind === "webdav"}
              failedAttachmentCount={failedAttachmentCount}
              indexProgress={indexProgress}
              isOnline={isOnline}
              isSyncing={isRefreshingVault}
              lastSyncedAt={activeCacheMeta?.lastSyncedAt}
              notes={notes}
              pendingAttachmentCount={pendingAttachmentCount}
              onAutoSyncModeChange={changeAutoSyncMode}
              onCancelSync={cancelSync}
              onClearSyncLog={clearLocalSyncLogs}
              onOpenNote={openNote}
              onOpenWebDav={() => {
                if (webDavConfigured && activeCacheMeta?.sourceKind === "webdav") void refreshVault()
                else navigate("/settings/webdav")
              }}
              onRetry={(noteId) => void refreshVault(new Set([noteId]))}
              onRetryFailed={() => void retryFailedSync()}
              onRestoreDeletedNote={restoreDeletedNote}
              onSync={() => void refreshVault()}
              sourceLabel={activeCacheMeta?.label ?? "坚果云"}
              syncProgress={syncProgress}
              syncLogs={syncLogs}
            />
          )}
        />
        <Route
          path="webdav"
          element={(
            <WebDavSettingsForm
              onConnect={connectWebDav}
              onConnected={() => navigate("/notes")}
              onSaved={() => setWebDavConfigured(true)}
            />
          )}
        />
        <Route
          path="cache"
          element={(
            <CacheSettingsPage
              activeCacheId={activeCacheMeta?.id ?? null}
              cachePrivacyMode={cachePrivacyMode}
              caches={vaultCaches}
              onClearActiveCache={() => void clearActiveVaultCache()}
              onDeleteCache={(cacheId) => void removeVaultCache(cacheId)}
              onSelectCache={(cacheId) => {
                void selectVaultCache(cacheId).then(() => navigate("/notes"))
              }}
              onPrivacyModeChange={(mode) => {
                saveCachePrivacyMode(mode)
                setCachePrivacyMode(mode)
                if (mode === "metadata" && activeCacheMeta) {
                  void deleteSyncedVaultAttachments(activeCacheMeta.id)
                }
              }}
            />
          )}
        />
        <Route
          path="storage"
          element={(
            <StorageMaintenancePage
              activeCacheId={activeCacheMeta?.id ?? null}
              notes={notes}
              onRebuildSearchIndex={rebuildSearchIndex}
            />
          )}
        />
        <Route
          path="trash"
          element={(
            <TrashSettingsPage
              busy={isManagingNote}
              entries={trashEntries}
              onPurge={(entryIds) => void purgeTrashEntries(entryIds)}
              onRestore={(entryIds) => void restoreTrashEntries(entryIds)}
              onRetentionChange={changeTrashRetention}
              retention={trashRetention}
            />
          )}
        />
        <Route path="about" element={<AboutSettingsPage />} />
      </Route>
      <Route element={<Navigate replace to="/notes" />} path="*" />
      </Routes>
      <QuickWebDavConnectDialog
        account={loadWebDavConfig().username}
        onConnect={async (password) => {
          const config = loadWebDavConfig()
          await connectWebDav(config, password)
          if (config.rememberPassword) {
            await saveWebDavPassword(config, password).catch(() => undefined)
          }
        }}
        onOpenChange={setQuickConnectOpen}
        open={quickConnectOpen}
      />
    </>
  )
}

function formatRemoteDate(lastModified?: string) {
  if (!lastModified) return "文件时间未知"
  const date = new Date(lastModified)
  if (Number.isNaN(date.getTime())) return "文件时间未知"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function parseRemoteTimestamp(lastModified?: string) {
  if (!lastModified) return undefined
  const timestamp = Date.parse(lastModified)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function deriveRemoteFolder(path: string) {
  const segments = path.split("/").filter(Boolean)
  return segments.slice(0, -1).join(" / ") || "根目录"
}

function deriveDirectoryPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).join(" / ")
}

function toStorageDirectoryPath(path: string) {
  return path.split(/\s*\/\s*/).filter(Boolean).join("/")
}

function sanitizeFolderName(name: string) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/^-+|-+$/g, "")
}

function replaceFolderPrefix(path: string, sourceFolder: string, targetFolder: string) {
  if (path === sourceFolder) return targetFolder
  return path.startsWith(`${sourceFolder} / `)
    ? `${targetFolder}${path.slice(sourceFolder.length)}`
    : path
}

function formatFileTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

async function readVaultDocuments(adapter: VaultAdapter, paths: string[]) {
  const documents = new Map<string, Awaited<ReturnType<VaultAdapter["readTextFile"]>>>()
  const batchSize = adapter.kind === "webdav" ? 4 : 12

  // 坚果云有请求频率限制：批次内并行避免串行瀑布，批次之间收敛并发避免大量正文同时触发 429。
  for (let index = 0; index < paths.length; index += batchSize) {
    const batch = await Promise.all(paths.slice(index, index + batchSize).map(async (path) => [
      path,
      await adapter.readTextFile(path),
    ] as const))
    for (const [path, document] of batch) documents.set(path, document)
  }

  return documents
}

function getNoteSaveState(note: Note): NoteSaveState {
  if (note.syncStatus === "conflict") return { status: "conflict" }
  if (note.syncStatus === "modified" && note.syncError) return { message: note.syncError, status: "error" }
  if (note.syncStatus === "modified") return { status: "pending" }
  if (note.readOnly) return { status: "readonly" }
  return { status: "saved" }
}

function indexNoteContent(content: string) {
  const frontmatter = extractFrontmatter(content)
  return {
    frontmatter: frontmatter.properties,
    outgoingLinks: extractWikiLinks(content),
    searchText: `${content} ${frontmatter.tags.join(" ")}`.toLocaleLowerCase(),
    tags: frontmatter.tags,
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

export default App
