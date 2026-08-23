import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { Navigate, Route, Routes, useMatch, useNavigate } from "react-router-dom"

import { Workspace, type LibraryView, type MobileScreen } from "@/components/workspace/workspace"
import {
  AboutSettingsPage,
  CacheSettingsPage,
  SettingsLayout,
  SettingsOverview,
  TodoPage,
} from "@/components/routes/app-pages"
import { WebDavSettingsForm } from "@/components/settings/webdav-settings-form"
import { hasSavedWebDavConfig, type WebDavConfig } from "@/lib/webdav-config"
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
import { createWebDavVaultAdapter } from "@/services/vault/webdav-vault-adapter"
import {
  createVaultCacheId,
  deleteVaultCache,
  listVaultCaches,
  loadLastVaultCache,
  loadVaultCache,
  saveVaultCache,
  type VaultCacheSnapshot,
  type VaultCacheSummary,
} from "@/services/cache/vault-cache"
import {
  extractWikiLinks,
  indexVaultFiles,
  normalizeNoteTarget,
} from "@/services/search/note-index"
import { sortNotes, type NoteSort } from "@/services/search/note-sort"
import { buildVaultFolders, noteBelongsToFolder } from "@/services/search/vault-folders"
import { setMarkdownTaskChecked, type MarkdownTask } from "@/services/tasks/markdown-tasks"
import {
  canReuseCachedContent,
  isWebDavWorkingCopy,
  remoteChangedFromBase,
} from "@/services/sync/webdav-working-copy"
import type { Note, NoteSaveState } from "@/types/note"
import "./App.css"

type ActiveCacheMeta = Pick<VaultCacheSnapshot, "id" | "label" | "sourceKind">

function App() {
  const navigate = useNavigate()
  const folderRouteMatch = useMatch("/notes/folder/:folderPath")
  const noteRouteMatch = useMatch("/notes/:noteId")
  const viewRouteMatch = useMatch("/notes/view/:view")
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNoteId, setActiveNoteId] = useState("")
  const [query, setQuery] = useState("")
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [libraryView, setLibraryView] = useState<LibraryView>("all")
  const [noteSort, setNoteSort] = useState<NoteSort>("updated-desc")
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>("library")
  const [isCreatingNote, setIsCreatingNote] = useState(false)
  const [isManagingNote, setIsManagingNote] = useState(false)
  const [isOpeningVault, setIsOpeningVault] = useState(false)
  const [isRefreshingVault, setIsRefreshingVault] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [webDavConfigured, setWebDavConfigured] = useState(hasSavedWebDavConfig)
  const [vaultNoteCount, setVaultNoteCount] = useState(0)
  const [vaultSession, setVaultSession] = useState<VaultAdapter | null>(null)
  const [vaultCaches, setVaultCaches] = useState<VaultCacheSummary[]>([])
  const [activeCacheMeta, setActiveCacheMeta] = useState<ActiveCacheMeta | null>(null)
  const [cacheReady, setCacheReady] = useState(false)
  const [saveStates, setSaveStates] = useState<Record<string, NoteSaveState>>({})
  const [indexProgress, setIndexProgress] = useState<{ indexed: number; total: number } | null>(null)
  const saveTimersRef = useRef(new Map<string, number>())
  const saveQueuesRef = useRef(new Map<string, Promise<void>>())
  const revisionByPathRef = useRef(new Map<string, string | undefined>())
  const indexGenerationRef = useRef(0)

  const applyCachedSnapshot = useCallback((snapshot: VaultCacheSnapshot) => {
    // 缓存恢复时主动断开运行时适配器，确保离线浏览不会误走本地文件或 WebDAV 写入链路。
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer)
    saveTimersRef.current.clear()
    saveQueuesRef.current.clear()
    revisionByPathRef.current.clear()
    indexGenerationRef.current += 1

    const cachedNotes = snapshot.notes.map((note) => ({
      ...note,
      content: note.contentLoaded
        ? note.content
        : "# 正文尚未缓存\n\n重新连接原笔记库后，可以读取这篇文档的完整内容。",
      contentLoaded: note.contentLoaded,
      // WebDAV 快照就是本地工作副本；正文已缓存时允许离线编辑，但不会在这里触发云端写入。
      readOnly: note.source === "webdav" ? !note.contentLoaded : true,
      syncStatus: note.source === "webdav"
        ? note.syncStatus ?? (note.contentLoaded ? "synced" : undefined)
        : note.syncStatus,
    }))
    const restoredActiveId = cachedNotes.some((note) => note.id === snapshot.activeNoteId)
      ? snapshot.activeNoteId
      : cachedNotes[0]?.id ?? ""

    setVaultSession(null)
    setActiveCacheMeta({ id: snapshot.id, label: snapshot.label, sourceKind: snapshot.sourceKind })
    setNotes(cachedNotes)
    setActiveNoteId(restoredActiveId)
    setVaultNoteCount(cachedNotes.length)
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
    if (!cacheReady || !activeCacheMeta || notes.length === 0) return
    const timer = window.setTimeout(() => {
      const snapshot: VaultCacheSnapshot = {
        ...activeCacheMeta,
        activeNoteId,
        notes,
        savedAt: Date.now(),
      }
      // 内容读取、收藏和本地编辑后统一刷新离线快照；敏感凭据不属于 Note 模型，因此不会进入缓存。
      void saveVaultCache(snapshot)
        .then(listVaultCaches)
        .then(setVaultCaches)
        .catch((error) => setVaultError(error instanceof Error ? error.message : "保存离线缓存失败"))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [activeCacheMeta, activeNoteId, cacheReady, notes])

  useEffect(() => () => {
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (folderRouteMatch?.params.folderPath) {
      setLibraryView("all")
      setSelectedFolder(decodeURIComponent(folderRouteMatch.params.folderPath))
      setMobileScreen("notes")
      return
    }
    const routeView = viewRouteMatch?.params.view
    if (routeView === "recent" || routeView === "starred") {
      setLibraryView(routeView)
      setSelectedFolder(null)
      setMobileScreen("notes")
    }
  }, [folderRouteMatch?.params.folderPath, viewRouteMatch?.params.view])

  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase()
  const folders = useMemo(() => buildVaultFolders(notes), [notes])
  const folderNotes = selectedFolder
    ? notes.filter((note) => noteBelongsToFolder(note, selectedFolder))
    : notes
  const libraryNotes = libraryView === "recent"
    ? sortNotes(folderNotes, "updated-desc").slice(0, 32)
    : libraryView === "starred"
      ? folderNotes.filter((note) => note.starred)
      : folderNotes
  const filteredNotes = normalizedQuery
    ? libraryNotes.filter((note) =>
        `${note.title} ${note.preview} ${note.searchText ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : libraryNotes
  const visibleNotes = sortNotes(filteredNotes, noteSort)
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? null
  const activeTarget = activeNote ? normalizeNoteTarget(activeNote.title) : ""
  const backlinks = useMemo(
    () => activeTarget
      ? notes.filter((note) =>
          note.id !== activeNoteId && note.outgoingLinks?.includes(activeTarget),
        )
      : [],
    [activeNoteId, activeTarget, notes],
  )
  const connected = vaultSession !== null && vaultNoteCount > 0
  const cached = !vaultSession && activeCacheMeta !== null && vaultNoteCount > 0
  const pendingSyncCount = notes.filter((note) =>
    note.source === "webdav" && note.syncStatus === "modified",
  ).length
  const conflictCount = notes.filter((note) =>
    note.source === "webdav" && note.syncStatus === "conflict",
  ).length
  const syncLabel = connected
    ? conflictCount > 0
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
    ? conflictCount > 0
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
    if (!notePath || !vaultSession?.readBinaryFile) return null
    const assetPath = resolveVaultAssetPath(notePath, source)
    return assetPath ? vaultSession.readBinaryFile(assetPath) : null
  }, [activeNote?.remotePath, vaultSession])

  const updateActiveNote = (patch: Partial<Note>) => {
    if (!activeNote) return
    const touchesDocument = typeof patch.content === "string" || typeof patch.title === "string"
    const indexedPatch: Partial<Note> = typeof patch.content === "string"
      ? {
          ...patch,
          outgoingLinks: extractWikiLinks(patch.content),
          searchText: patch.content.toLocaleLowerCase(),
        }
      : patch
    setNotes((current) =>
      current.map((note) =>
        note.id === activeNoteId
          ? {
              ...note,
              ...indexedPatch,
              ...(touchesDocument ? { modifiedAt: Date.now(), updatedAt: "刚刚" } : {}),
              ...(touchesDocument && note.source === "webdav"
                ? { syncStatus: note.syncStatus === "conflict" ? "conflict" as const : "modified" as const }
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
            outgoingLinks: extractWikiLinks(content),
            preview: content.replace(/^#+\s*/gm, "").slice(0, 90),
            searchText: content.toLocaleLowerCase(),
            syncStatus: candidate.source === "webdav"
              ? candidate.syncStatus === "conflict" ? "conflict" : "modified"
              : candidate.syncStatus,
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

  const createNote = async () => {
    const adapter = vaultSession
    if (!adapter?.createTextFile || adapter.readOnly) {
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
      const path = `${directory ? `${directory}/` : ""}新笔记-${timestamp}-${now.getMilliseconds().toString().padStart(3, "0")}.md`
      const content = `# ${title}\n\n`
      const result = await adapter.createTextFile(path, content)
      const id = `${adapter.kind}:${result.path}`
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
      preview: content.replace(/^#+\s*/gm, "").slice(0, 90),
    })
  }

  const startVaultIndex = (adapter: VaultAdapter, files: VaultFileEntry[]) => {
    const generation = ++indexGenerationRef.current
    if (files.length === 0) {
      setIndexProgress(null)
      return
    }
    setIndexProgress({ indexed: 0, total: files.length })
    void indexVaultFiles(
      adapter,
      files,
      (batch, indexed, total) => {
        const indexedByPath = new Map(batch.map((item) => [item.path, item]))
        setNotes((current) => current.map((note) => {
          const indexedNote = note.remotePath ? indexedByPath.get(note.remotePath) : undefined
          const hasLocalChanges = note.syncStatus === "modified" || note.syncStatus === "conflict"
          return indexedNote
            && !hasLocalChanges
            ? {
                ...note,
                content: indexedNote.content,
                contentLoaded: true,
                outgoingLinks: indexedNote.outgoingLinks,
                readOnly: note.source === "webdav" ? false : note.readOnly,
                revision: indexedNote.revision ?? note.revision,
                searchText: indexedNote.searchText,
                syncStatus: note.source === "webdav" ? "synced" : note.syncStatus,
              }
            : note
        }))
        setIndexProgress({ indexed, total })
      },
      () => generation !== indexGenerationRef.current,
      adapter.kind === "webdav"
        ? { batchSize: 2, delayMs: 350 }
        : { batchSize: 6 },
    )
  }

  const connectWebDav = async (config: WebDavConfig, password: string) => {
    return loadVault(createWebDavVaultAdapter(config, password))
  }

  const loadVault = async (
    adapter: VaultAdapter,
    preserveContext = false,
    contextNotes: Note[] = notes,
  ) => {
    const files = await adapter.listMarkdownFiles()
    if (files.length === 0) {
      throw new Error(`${adapter.displayName} 中没有找到 Markdown 文件`)
    }

    const previousNotesByPath = preserveContext
      ? new Map(contextNotes.filter((note) => note.remotePath).map((note) => [note.remotePath!, note]))
      : new Map<string, Note>()
    const preferredPath = preserveContext && activeNote?.remotePath
      && files.some((file) => file.path === activeNote.remotePath)
      ? activeNote.remotePath
      : files[0].path
    const pathsToRead = files
      .filter((file) => {
        const previousNote = previousNotesByPath.get(file.path)
        const hasLocalChanges = previousNote?.syncStatus === "modified" || previousNote?.syncStatus === "conflict"
        if (hasLocalChanges) return false
        if (!preserveContext) return file.path === preferredPath
        const remoteChanged = previousNote?.contentLoaded && (
          !previousNote.revision
          || !file.revision
          || previousNote.revision !== file.revision
        )
        return Boolean(remoteChanged)
      })
      .map((file) => file.path)
    const loadedDocuments = await readVaultDocuments(adapter, pathsToRead)
    const remoteNotes: Note[] = files.map((file) => {
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

      return {
        id: `${adapter.kind}:${file.path}`,
        title: file.name.replace(/\.md$/i, ""),
        preview: preserveWorkingCopy
          ? workingCopy!.preview
          : reuseCachedContent
            ? previousNote!.preview
            : adapter.getDisplayPath?.(file.path) ?? file.path,
        content,
        updatedAt: formatRemoteDate(file.updatedAt),
        modifiedAt: parseRemoteTimestamp(file.updatedAt),
        starred: previousNote?.starred ?? false,
        folder: deriveRemoteFolder(adapter.getDisplayPath?.(file.path) ?? file.path),
        source: adapter.kind === "webdav" ? "webdav" : "local",
        remotePath: file.path,
        readOnly: adapter.kind === "webdav" ? !contentLoaded : adapter.readOnly,
        revision: preserveWorkingCopy
          ? workingCopy!.revision
          : loadedDocument?.revision ?? file.revision,
        searchText: reuseCachedContent
          ? previousNote!.searchText
          : contentLoaded ? content.toLocaleLowerCase() : undefined,
        outgoingLinks: reuseCachedContent
          ? previousNote!.outgoingLinks
          : contentLoaded ? extractWikiLinks(content) : undefined,
        contentLoaded,
        syncStatus: adapter.kind === "webdav"
          ? preserveWorkingCopy
            ? remoteChangedWhileEditing ? "conflict" : workingCopy!.syncStatus
            : contentLoaded ? "synced" : undefined
          : undefined,
      }
    })
    const remotePaths = new Set(files.map((file) => file.path))
    // 远端删除不能顺带删除尚未上传的本地正文；保留为冲突项，交给用户显式处理。
    const orphanedWorkingCopies = Array.from(previousNotesByPath.values())
      .filter((note) => note.source === "webdav"
        && note.remotePath
        && !remotePaths.has(note.remotePath)
        && (note.syncStatus === "modified" || note.syncStatus === "conflict"))
      .map((note): Note => ({ ...note, syncStatus: "conflict" }))
    const mergedNotes = [...remoteNotes, ...orphanedWorkingCopies]
    const preservedActiveNote = preserveContext
      ? mergedNotes.find((note) => note.id === activeNoteId)
      : undefined
    const nextActiveNoteId = preservedActiveNote?.id ?? `${adapter.kind}:${preferredPath}`

    revisionByPathRef.current.clear()
    for (const note of mergedNotes) {
      if (note.remotePath) revisionByPathRef.current.set(note.remotePath, note.revision)
    }

    const cacheMeta: ActiveCacheMeta = {
      id: await createVaultCacheId(adapter.cacheIdentity),
      label: adapter.cacheLabel,
      sourceKind: adapter.kind,
    }
    const snapshot: VaultCacheSnapshot = {
      ...cacheMeta,
      activeNoteId: nextActiveNoteId,
      notes: mergedNotes,
      savedAt: Date.now(),
    }
    // 首次读取成功就立刻落盘，避免用户在延迟保存触发前刷新导致这次远程列表丢失。
    await saveVaultCache(snapshot)

    // 适配器只保存在运行时；浏览器目录句柄和 WebDAV 密码都不会写入本地存储。
    setVaultSession(adapter)
    setActiveCacheMeta(cacheMeta)
    setVaultCaches(await listVaultCaches())
    setSelectedFolder((current) => preserveContext && current
      && mergedNotes.some((note) => noteBelongsToFolder(note, current))
      ? current
      : null)
    setNotes(mergedNotes)
    setActiveNoteId(nextActiveNoteId)
    setVaultNoteCount(mergedNotes.length)
    setSaveStates(Object.fromEntries(mergedNotes.map((note) => [note.id, getNoteSaveState(note)])))
    setVaultError(null)
    if (!preserveContext) setMobileScreen("notes")
    // WebDAV 也建立全文索引，但降低并发并在批次间让出时间，避免触发坚果云频率限制。
    const filesToIndex = files.filter((file) => !mergedNotes.find((note) =>
      note.remotePath === file.path && typeof note.searchText === "string",
    ))
    startVaultIndex(adapter, filesToIndex)
    return mergedNotes.length
  }

  const pushPendingWebDavNotes = async (adapter: VaultAdapter, currentNotes: Note[]) => {
    if (adapter.kind !== "webdav" || !adapter.writeTextFile) {
      return { errorMessage: null, notes: currentNotes }
    }

    let nextNotes = currentNotes
    let errorMessage: string | null = null
    const pendingNotes = currentNotes.filter((note) =>
      note.source === "webdav" && note.syncStatus === "modified" && note.remotePath,
    )

    // 坚果云对请求频率敏感，按文件串行同步；单篇失败不会阻断其他本地稿的尝试。
    for (const pendingNote of pendingNotes) {
      const path = pendingNote.remotePath!
      setSaveStates((current) => ({ ...current, [pendingNote.id]: { status: "saving" } }))
      try {
        const result = await adapter.writeTextFile(path, pendingNote.content, pendingNote.revision)
        nextNotes = nextNotes.map((note) => note.id === pendingNote.id
          ? {
              ...note,
              revision: result.revision,
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
          ? { ...note, syncStatus: conflict ? "conflict" : "modified" }
          : note)
        setSaveStates((current) => ({
          ...current,
          [pendingNote.id]: { message, status: conflict ? "conflict" : "error" },
        }))
        setVaultError(message)
      }
    }

    setNotes(nextNotes)
    return { errorMessage, notes: nextNotes }
  }

  const refreshVault = async () => {
    if (!vaultSession) {
      navigate("/settings/webdav")
      return
    }

    setIsRefreshingVault(true)
    setVaultError(null)
    try {
      // 同步按钮是唯一的云端写入入口：先用版本条件上传本地稿，再拉取远端目录并合并。
      const syncResult = await pushPendingWebDavNotes(vaultSession, notes)
      await loadVault(vaultSession, true, syncResult.notes)
      if (syncResult.errorMessage) setVaultError(syncResult.errorMessage)
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "刷新笔记库失败")
    } finally {
      setIsRefreshingVault(false)
    }
  }

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

  const selectNote = async (note: Note) => {
    setActiveNoteId(note.id)
    setMobileScreen("editor")
    if (note.contentLoaded || !note.remotePath || !vaultSession) return

    try {
      const document = await vaultSession.readTextFile(note.remotePath)
      revisionByPathRef.current.set(note.remotePath, document.revision)
      setNotes((current) =>
        current.map((currentNote) =>
          currentNote.id === note.id
            ? {
                ...currentNote,
                content: document.content,
                searchText: document.content.toLocaleLowerCase(),
                outgoingLinks: extractWikiLinks(document.content),
                revision: document.revision,
                contentLoaded: true,
                readOnly: currentNote.source === "webdav" ? false : currentNote.readOnly,
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
    }
  }

  const openNote = (note: Note) => {
    navigate(`/notes/${encodeURIComponent(note.id)}`)
    void selectNote(note)
  }

  useEffect(() => {
    const routeNoteId = noteRouteMatch?.params.noteId
    if (!routeNoteId) return
    const decodedNoteId = decodeURIComponent(routeNoteId)
    const routeNote = notes.find((note) => note.id === decodedNoteId)
    if (!routeNote) return
    setMobileScreen("editor")
    if (routeNote.id !== activeNoteId) void selectNote(routeNote)
  }, [activeNoteId, noteRouteMatch?.params.noteId, notes])

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
              content: document.content,
              preview: document.content.replace(/^#+\s*/gm, "").slice(0, 90),
              searchText: document.content.toLocaleLowerCase(),
              outgoingLinks: extractWikiLinks(document.content),
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

  const resolveActiveConflict = async (strategy: "local" | "remote") => {
    const note = activeNote
    const path = note?.remotePath
    if (!note || note.syncStatus !== "conflict" || !path || !vaultSession) return
    if (strategy === "remote" && !window.confirm("采用云端版本会放弃这篇笔记尚未同步的本地修改，是否继续？")) {
      return
    }

    setSaveStates((current) => ({ ...current, [note.id]: { status: "saving" } }))
    setVaultError(null)
    try {
      // 两种选择都先读取最新远端版本：保留本地时只更新同步基准，下一次同步仍会带 If-Match 保护。
      const remoteDocument = await vaultSession.readTextFile(path)
      revisionByPathRef.current.set(path, remoteDocument.revision)
      setNotes((current) => current.map((candidate) => {
        if (candidate.id !== note.id) return candidate
        if (strategy === "local") {
          return { ...candidate, revision: remoteDocument.revision, syncStatus: "modified" }
        }
        return {
          ...candidate,
          content: remoteDocument.content,
          contentLoaded: true,
          outgoingLinks: extractWikiLinks(remoteDocument.content),
          preview: remoteDocument.content.replace(/^#+\s*/gm, "").slice(0, 90),
          readOnly: false,
          revision: remoteDocument.revision,
          searchText: remoteDocument.content.toLocaleLowerCase(),
          syncStatus: "synced",
          updatedAt: "刚刚采用云端版本",
        }
      }))
      setSaveStates((current) => ({
        ...current,
        [note.id]: strategy === "local" ? { status: "pending" } : { status: "saved" },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取云端冲突版本失败"
      setSaveStates((current) => ({ ...current, [note.id]: { message, status: "conflict" } }))
      setVaultError(message)
    }
  }

  const moveActiveNote = async (folderPath: string | null) => {
    const note = activeNote
    const adapter = vaultSession
    if (!note?.remotePath || note.readOnly || !adapter?.moveTextFile) {
      setVaultError("当前笔记不能移动，请打开一个可写的本地 Vault")
      return
    }
    if (saveStates[note.id]?.status === "saving") {
      setVaultError("笔记仍在保存，请稍后再移动")
      return
    }

    const pathSegments = note.remotePath.split("/").filter(Boolean)
    const filename = pathSegments[pathSegments.length - 1]
    if (!filename) return
    const directory = folderPath?.split(/\s*\/\s*/).filter(Boolean).join("/") ?? ""
    const targetPath = directory ? `${directory}/${filename}` : filename
    if (targetPath === note.remotePath) return

    setIsManagingNote(true)
    setVaultError(null)
    try {
      const result = await adapter.moveTextFile(note.remotePath, targetPath)
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

  const deleteActiveNote = async () => {
    const note = activeNote
    const adapter = vaultSession
    if (!note?.remotePath || note.readOnly || !adapter?.deleteTextFile) {
      setVaultError("当前笔记不能删除，请打开一个可写的本地 Vault")
      return
    }
    if (saveStates[note.id]?.status === "saving") {
      setVaultError("笔记仍在保存，请稍后再删除")
      return
    }

    setIsManagingNote(true)
    setVaultError(null)
    try {
      await adapter.deleteTextFile(note.remotePath)
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
      setActiveNoteId(nextNote?.id ?? "")
      setMobileScreen(nextNote ? "editor" : "notes")
      navigate(nextNote ? `/notes/${encodeURIComponent(nextNote.id)}` : "/notes", { replace: true })
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : "删除笔记失败")
    } finally {
      setIsManagingNote(false)
    }
  }

  const openWikiLink = (target: string) => {
    const normalizedTarget = normalizeNoteTarget(target)
    // Obsidian 链接可能写标题、相对路径或标题锚点，统一归一化后再路由到已加载笔记。
    const linkedNote = notes.find((note) =>
      normalizeNoteTarget(note.title) === normalizedTarget
      || (note.remotePath && normalizeNoteTarget(note.remotePath) === normalizedTarget),
    )

    if (linkedNote) {
      setVaultError(null)
      openNote(linkedNote)
      return
    }

    setVaultError(`找不到链接笔记：${target}`)
  }

  return (
    <Routes>
      <Route element={<Navigate replace to="/notes" />} path="/" />
      <Route
        path="/notes/*"
        element={(
          <Workspace
            activeCacheId={activeCacheMeta?.id ?? null}
            activeNote={activeNote}
            activeNoteId={activeNoteId}
            backlinks={backlinks}
            connectionLabel={connectionLabel}
            connected={connected}
            canCreateNote={Boolean(vaultSession?.createTextFile && !vaultSession.readOnly)}
            folders={folders}
            isOpeningVault={isOpeningVault}
            isCreatingNote={isCreatingNote}
            isManagingNote={isManagingNote}
            isRefreshingVault={isRefreshingVault}
            libraryView={libraryView}
            localVaultSupported={canSelectLocalVault()}
            mobileScreen={mobileScreen}
            mobileConnectionLabel={mobileConnectionLabel}
            mobileListStateKey={normalizedQuery}
            noteSort={noteSort}
            notes={visibleNotes}
            onCreateNote={() => void createNote()}
            onDeleteNote={() => void deleteActiveNote()}
            onFormat={formatActiveNote}
            onMobileScreenChange={(screen) => {
              setMobileScreen(screen)
              if (screen !== "editor" && noteRouteMatch) navigate("/notes")
            }}
            onNavigate={navigate}
            onMoveNote={(folderPath) => void moveActiveNote(folderPath)}
            onOpenLocalVault={() => void openLocalVault()}
            onOpenWikiLink={openWikiLink}
            onOpenSettings={() => navigate("/settings/webdav")}
            onQueryChange={setQuery}
            onNoteSortChange={setNoteSort}
            onReloadNote={() => void reloadActiveNote()}
            onRefreshVault={() => void refreshVault()}
            onResolveConflict={(strategy) => void resolveActiveConflict(strategy)}
            onResolveAsset={resolveActiveAsset}
            onSelectFolder={(folder) => {
              setLibraryView("all")
              setSelectedFolder(folder)
              setMobileScreen("notes")
              navigate(folder ? `/notes/folder/${encodeURIComponent(folder)}` : "/notes")
            }}
            onSelectLibraryView={(view) => {
              setLibraryView(view)
              setSelectedFolder(null)
              setMobileScreen("notes")
              navigate(view === "all" ? "/notes" : `/notes/view/${view}`)
            }}
            onSelectNote={openNote}
            onSelectVaultCache={(cacheId) => void selectVaultCache(cacheId)}
            onUpdateNote={updateActiveNote}
            query={query}
            selectedFolder={selectedFolder}
            saveState={saveStates[activeNoteId] ?? {
              status: activeNote ? getNoteSaveState(activeNote).status : "saved",
            }}
            syncLabel={syncLabel}
            starredNoteCount={notes.filter((note) => note.starred).length}
            totalNoteCount={notes.length}
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
            notes={notes}
            onNavigate={navigate}
            onOpenNote={(note) => {
              openNote(note)
            }}
            onOpenSync={() => navigate("/settings/webdav")}
            onToggleTask={toggleTask}
          />
        )}
      />
      <Route
        path="/settings"
        element={<SettingsLayout connected={connected} onNavigate={navigate} onOpenSync={() => navigate("/settings/webdav")} />}
      >
        <Route index element={<SettingsOverview onNavigate={navigate} />} />
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
              caches={vaultCaches}
              onDeleteCache={(cacheId) => void removeVaultCache(cacheId)}
              onSelectCache={(cacheId) => {
                void selectVaultCache(cacheId).then(() => navigate("/notes"))
              }}
            />
          )}
        />
        <Route path="about" element={<AboutSettingsPage />} />
      </Route>
      <Route element={<Navigate replace to="/notes" />} path="*" />
    </Routes>
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
  if (note.syncStatus === "modified") return { status: "pending" }
  if (note.readOnly) return { status: "readonly" }
  return { status: "saved" }
}

export default App
