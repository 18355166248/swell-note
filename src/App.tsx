import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"

import { Workspace, type MobileScreen } from "@/components/workspace/workspace"
import { WebDavSettingsDialog } from "@/components/webdav-settings-dialog"
import { demoNotes } from "@/data/demo-notes"
import { hasSavedWebDavConfig, type WebDavConfig } from "@/lib/webdav-config"
import {
  canSelectLocalVault,
  selectLocalVaultAdapter,
} from "@/services/vault/local-vault-adapter"
import type { VaultAdapter, VaultFileEntry } from "@/services/vault/vault-adapter"
import { resolveVaultAssetPath } from "@/services/vault/vault-path"
import { createWebDavVaultAdapter } from "@/services/vault/webdav-vault-adapter"
import {
  extractWikiLinks,
  indexVaultFiles,
  normalizeNoteTarget,
} from "@/services/search/note-index"
import { buildVaultFolders, noteBelongsToFolder } from "@/services/search/vault-folders"
import type { Note, NoteSaveState } from "@/types/note"
import "./App.css"

function App() {
  const [notes, setNotes] = useState(demoNotes)
  const [activeNoteId, setActiveNoteId] = useState(demoNotes[0].id)
  const [query, setQuery] = useState("")
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>("library")
  const [isOpeningVault, setIsOpeningVault] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [webDavConfigured, setWebDavConfigured] = useState(hasSavedWebDavConfig)
  const [vaultNoteCount, setVaultNoteCount] = useState(0)
  const [vaultSession, setVaultSession] = useState<VaultAdapter | null>(null)
  const [saveStates, setSaveStates] = useState<Record<string, NoteSaveState>>({})
  const [indexProgress, setIndexProgress] = useState<{ indexed: number; total: number } | null>(null)
  const saveTimersRef = useRef(new Map<string, number>())
  const saveQueuesRef = useRef(new Map<string, Promise<void>>())
  const revisionByPathRef = useRef(new Map<string, string | undefined>())
  const indexGenerationRef = useRef(0)

  useEffect(() => () => {
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer)
  }, [])

  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase()
  const folders = useMemo(() => buildVaultFolders(notes), [notes])
  const folderNotes = selectedFolder
    ? notes.filter((note) => noteBelongsToFolder(note, selectedFolder))
    : notes
  const visibleNotes = normalizedQuery
    ? folderNotes.filter((note) =>
        `${note.title} ${note.preview} ${note.searchText ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : folderNotes
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0]
  const activeTarget = normalizeNoteTarget(activeNote.title)
  const backlinks = useMemo(
    () => notes.filter((note) =>
      note.id !== activeNoteId && note.outgoingLinks?.includes(activeTarget),
    ),
    [activeNoteId, activeTarget, notes],
  )
  const connected = vaultNoteCount > 0
  const syncLabel = connected
    ? indexProgress && indexProgress.indexed < indexProgress.total
      ? `正在索引 ${indexProgress.indexed}/${indexProgress.total}`
      : `${vaultSession?.displayName ?? "笔记库"} · ${vaultNoteCount} 篇`
    : webDavConfigured
      ? "等待输入应用密码"
      : "尚未连接"
  const connectionLabel = vaultSession?.kind === "webdav"
    ? "已连接坚果云"
    : vaultSession
      ? "已打开本地笔记库"
      : "配置 WebDAV"
  const mobileConnectionLabel = vaultSession?.kind === "webdav"
    ? "已同步"
    : vaultSession
      ? "本地"
      : "未连接"

  const resolveActiveAsset = useCallback(async (source: string) => {
    const notePath = activeNote.remotePath
    if (!notePath || !vaultSession?.readBinaryFile) return null
    const assetPath = resolveVaultAssetPath(notePath, source)
    return assetPath ? vaultSession.readBinaryFile(assetPath) : null
  }, [activeNote.remotePath, vaultSession])

  const updateActiveNote = (patch: Partial<Note>) => {
    const indexedPatch: Partial<Note> = typeof patch.content === "string"
      ? {
          ...patch,
          outgoingLinks: extractWikiLinks(patch.content),
          searchText: patch.content.toLocaleLowerCase(),
        }
      : patch
    setNotes((current) =>
      current.map((note) =>
        note.id === activeNoteId ? { ...note, ...indexedPatch, updatedAt: "刚刚" } : note,
      ),
    )
    if (typeof patch.content === "string") scheduleLocalSave(activeNote, patch.content)
  }

  const scheduleLocalSave = (note: Note, content: string) => {
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
                ? { ...currentNote, revision: result.revision, updatedAt: "刚刚" }
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

  const createNote = () => {
    const id = crypto.randomUUID()
    const newNote: Note = {
      id,
      title: "无标题笔记",
      preview: "开始记录你的想法…",
      content: "# 无标题笔记\n\n开始记录你的想法…",
      updatedAt: "刚刚",
      starred: false,
      folder: "个人知识库",
    }

    setNotes((current) => [newNote, ...current])
    setActiveNoteId(id)
    setMobileScreen("editor")
  }

  const formatActiveNote = (syntax: string) => {
    if (!syntax || activeNote.readOnly) return
    const content = `${activeNote.content}${syntax}`
    updateActiveNote({
      content,
      preview: content.replace(/^#+\s*/gm, "").slice(0, 90),
    })
  }

  const startLocalIndex = (adapter: VaultAdapter, files: VaultFileEntry[]) => {
    const generation = ++indexGenerationRef.current
    setIndexProgress({ indexed: 0, total: files.length })
    void indexVaultFiles(
      adapter,
      files,
      (batch, indexed, total) => {
        const indexedByPath = new Map(batch.map((item) => [item.path, item]))
        setNotes((current) => current.map((note) => {
          const indexedNote = note.remotePath ? indexedByPath.get(note.remotePath) : undefined
          return indexedNote
            ? {
                ...note,
                outgoingLinks: indexedNote.outgoingLinks,
                searchText: indexedNote.searchText,
              }
            : note
        }))
        setIndexProgress({ indexed, total })
      },
      () => generation !== indexGenerationRef.current,
    )
  }

  const connectWebDav = async (config: WebDavConfig, password: string) => {
    return loadVault(createWebDavVaultAdapter(config, password))
  }

  const loadVault = async (adapter: VaultAdapter) => {
    const files = await adapter.listMarkdownFiles()
    if (files.length === 0) {
      throw new Error(`${adapter.displayName} 中没有找到 Markdown 文件`)
    }

    const firstFile = files[0]
    const firstDocument = await adapter.readTextFile(firstFile.path)
    revisionByPathRef.current.clear()
    revisionByPathRef.current.set(firstFile.path, firstDocument.revision)
    const remoteNotes: Note[] = files.map((file, index) => ({
      id: `${adapter.kind}:${file.path}`,
      title: file.name.replace(/\.md$/i, ""),
      preview: adapter.getDisplayPath?.(file.path) ?? file.path,
      content: index === 0 ? firstDocument.content : "正在从笔记库读取…",
      updatedAt: formatRemoteDate(file.updatedAt),
      starred: false,
      folder: deriveRemoteFolder(adapter.getDisplayPath?.(file.path) ?? file.path),
      source: adapter.kind === "webdav" ? "webdav" : "local",
      remotePath: file.path,
      readOnly: adapter.readOnly,
      revision: index === 0 ? firstDocument.revision : undefined,
      searchText: index === 0 ? firstDocument.content.toLocaleLowerCase() : undefined,
      outgoingLinks: index === 0 ? extractWikiLinks(firstDocument.content) : undefined,
      contentLoaded: index === 0,
    }))

    // 适配器只保存在运行时；浏览器目录句柄和 WebDAV 密码都不会写入本地存储。
    setVaultSession(adapter)
    setSelectedFolder(null)
    setNotes(remoteNotes)
    setActiveNoteId(remoteNotes[0].id)
    setVaultNoteCount(remoteNotes.length)
    setSaveStates(Object.fromEntries(remoteNotes.map((note) => [
      note.id,
      { status: adapter.readOnly ? "readonly" : "saved" },
    ])))
    setVaultError(null)
    setMobileScreen("notes")
    if (adapter.kind === "webdav") {
      indexGenerationRef.current += 1
      setIndexProgress(null)
    } else {
      startLocalIndex(adapter, files)
    }
    return remoteNotes.length
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
    if (note.source === "demo" || note.contentLoaded || !note.remotePath || !vaultSession) return

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
              }
            : currentNote,
        ),
      )
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

  const reloadActiveNote = async () => {
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
        [activeNote.id]: { status: activeNote.readOnly ? "readonly" : "saved" },
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

  const openWikiLink = (target: string) => {
    const normalizedTarget = normalizeNoteTarget(target)
    // Obsidian 链接可能写标题、相对路径或标题锚点，统一归一化后再路由到已加载笔记。
    const linkedNote = notes.find((note) =>
      normalizeNoteTarget(note.title) === normalizedTarget
      || (note.remotePath && normalizeNoteTarget(note.remotePath) === normalizedTarget),
    )

    if (linkedNote) {
      setVaultError(null)
      void selectNote(linkedNote)
      return
    }

    setVaultError(`找不到链接笔记：${target}`)
  }

  return (
    <>
      <Workspace
        activeNote={activeNote}
        activeNoteId={activeNoteId}
        backlinks={backlinks}
        connectionLabel={connectionLabel}
        connected={connected}
        folders={folders}
        isOpeningVault={isOpeningVault}
        localVaultSupported={canSelectLocalVault()}
        mobileScreen={mobileScreen}
        mobileConnectionLabel={mobileConnectionLabel}
        mobileListStateKey={normalizedQuery}
        notes={visibleNotes}
        onCreateNote={createNote}
        onFormat={formatActiveNote}
        onMobileScreenChange={setMobileScreen}
        onOpenLocalVault={() => void openLocalVault()}
        onOpenWikiLink={openWikiLink}
        onOpenSettings={() => setSettingsOpen(true)}
        onQueryChange={setQuery}
        onReloadNote={() => void reloadActiveNote()}
        onResolveAsset={resolveActiveAsset}
        onSelectFolder={(folder) => {
          setSelectedFolder(folder)
          setMobileScreen("notes")
        }}
        onSelectNote={(note) => void selectNote(note)}
        onUpdateNote={updateActiveNote}
        query={query}
        selectedFolder={selectedFolder}
        saveState={saveStates[activeNoteId] ?? {
          status: activeNote.readOnly ? "readonly" : "saved",
        }}
        syncLabel={syncLabel}
        totalNoteCount={notes.length}
        vaultError={vaultError}
      />
      <WebDavSettingsDialog
        onConnect={connectWebDav}
        onOpenChange={setSettingsOpen}
        onSaved={() => setWebDavConfigured(true)}
        open={settingsOpen}
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

function deriveRemoteFolder(path: string) {
  const segments = path.split("/").filter(Boolean)
  return segments.slice(0, -1).join(" / ") || "根目录"
}

export default App
