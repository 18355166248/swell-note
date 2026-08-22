import { useState } from "react"

import { Workspace, type MobileScreen } from "@/components/workspace/workspace"
import { WebDavSettingsDialog } from "@/components/webdav-settings-dialog"
import { demoNotes } from "@/data/demo-notes"
import { hasSavedWebDavConfig, type WebDavConfig } from "@/lib/webdav-config"
import {
  canSelectLocalVault,
  selectLocalVaultAdapter,
} from "@/services/vault/local-vault-adapter"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { createWebDavVaultAdapter } from "@/services/vault/webdav-vault-adapter"
import type { Note } from "@/types/note"
import "./App.css"

function App() {
  const [notes, setNotes] = useState(demoNotes)
  const [activeNoteId, setActiveNoteId] = useState(demoNotes[0].id)
  const [query, setQuery] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>("library")
  const [isOpeningVault, setIsOpeningVault] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [webDavConfigured, setWebDavConfigured] = useState(hasSavedWebDavConfig)
  const [vaultNoteCount, setVaultNoteCount] = useState(0)
  const [vaultSession, setVaultSession] = useState<VaultAdapter | null>(null)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleNotes = normalizedQuery
    ? notes.filter((note) =>
        `${note.title} ${note.preview}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : notes
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0]
  const connected = vaultNoteCount > 0
  const syncLabel = connected
    ? `${vaultSession?.displayName ?? "笔记库"} · ${vaultNoteCount} 篇`
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

  const updateActiveNote = (patch: Partial<Note>) => {
    // 编辑只进入本地状态；同步层后续监听持久化事件，界面不直接依赖 WebDAV。
    setNotes((current) =>
      current.map((note) =>
        note.id === activeNoteId ? { ...note, ...patch, updatedAt: "刚刚" } : note,
      ),
    )
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
    if (!syntax || activeNote.source === "webdav" || activeNote.source === "local") return
    const content = `${activeNote.content}${syntax}`
    updateActiveNote({
      content,
      preview: content.replace(/^#+\s*/gm, "").slice(0, 90),
    })
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
    const firstContent = await adapter.readTextFile(firstFile.path)
    const remoteNotes: Note[] = files.map((file, index) => ({
      id: `${adapter.kind}:${file.path}`,
      title: file.name.replace(/\.md$/i, ""),
      preview: file.path,
      content: index === 0 ? firstContent : "正在从笔记库读取…",
      updatedAt: formatRemoteDate(file.updatedAt),
      starred: false,
      source: adapter.kind === "webdav" ? "webdav" : "local",
      remotePath: file.path,
      contentLoaded: index === 0,
    }))

    // 适配器只保存在运行时；浏览器目录句柄和 WebDAV 密码都不会写入本地存储。
    setVaultSession(adapter)
    setNotes(remoteNotes)
    setActiveNoteId(remoteNotes[0].id)
    setVaultNoteCount(remoteNotes.length)
    setVaultError(null)
    setMobileScreen("notes")
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
      const content = await vaultSession.readTextFile(note.remotePath)
      setNotes((current) =>
        current.map((currentNote) =>
          currentNote.id === note.id
            ? { ...currentNote, content, contentLoaded: true }
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

  return (
    <>
      <Workspace
        activeNote={activeNote}
        activeNoteId={activeNoteId}
        connectionLabel={connectionLabel}
        connected={connected}
        isOpeningVault={isOpeningVault}
        localVaultSupported={canSelectLocalVault()}
        mobileScreen={mobileScreen}
        mobileConnectionLabel={mobileConnectionLabel}
        notes={visibleNotes}
        onCreateNote={createNote}
        onFormat={formatActiveNote}
        onMobileScreenChange={setMobileScreen}
        onOpenLocalVault={() => void openLocalVault()}
        onOpenSettings={() => setSettingsOpen(true)}
        onQueryChange={setQuery}
        onSelectNote={(note) => void selectNote(note)}
        onUpdateNote={updateActiveNote}
        query={query}
        syncLabel={syncLabel}
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

export default App
