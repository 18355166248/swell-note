import { useState } from "react"

import { Workspace, type MobileScreen } from "@/components/workspace/workspace"
import { WebDavSettingsDialog } from "@/components/webdav-settings-dialog"
import { demoNotes } from "@/data/demo-notes"
import { hasSavedWebDavConfig, type WebDavConfig } from "@/lib/webdav-config"
import { listMarkdownFiles, readMarkdownFile } from "@/services/webdav-client"
import type { Note } from "@/types/note"
import "./App.css"

function App() {
  const [notes, setNotes] = useState(demoNotes)
  const [activeNoteId, setActiveNoteId] = useState(demoNotes[0].id)
  const [query, setQuery] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>("library")
  const [webDavConfigured, setWebDavConfigured] = useState(hasSavedWebDavConfig)
  const [remoteNoteCount, setRemoteNoteCount] = useState(0)
  const [webDavSession, setWebDavSession] = useState<{
    config: WebDavConfig
    password: string
  } | null>(null)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleNotes = normalizedQuery
    ? notes.filter((note) =>
        `${note.title} ${note.preview}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : notes
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0]
  const connected = remoteNoteCount > 0
  const syncLabel = connected
    ? `已读取 ${remoteNoteCount} 篇笔记`
    : webDavConfigured
      ? "等待输入应用密码"
      : "尚未连接"

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
    if (!syntax || activeNote.source === "webdav") return
    const content = `${activeNote.content}${syntax}`
    updateActiveNote({
      content,
      preview: content.replace(/^#+\s*/gm, "").slice(0, 90),
    })
  }

  const connectWebDav = async (config: WebDavConfig, password: string) => {
    const files = await listMarkdownFiles(config, password)
    if (files.length === 0) {
      throw new Error(`目录 ${config.remotePath} 下没有找到 Markdown 文件`)
    }

    const firstFile = files[0]
    const firstContent = await readMarkdownFile(config, password, firstFile.path)
    const remoteNotes: Note[] = files.map((file, index) => ({
      id: `webdav:${file.path}`,
      title: file.name.replace(/\.md$/i, ""),
      preview: file.path,
      content: index === 0 ? firstContent : "正在从坚果云读取…",
      updatedAt: formatRemoteDate(file.lastModified),
      starred: false,
      source: "webdav",
      remotePath: file.path,
      contentLoaded: index === 0,
    }))

    // 密码只保存在运行时会话，用于用户点开笔记时按需读取正文。
    setWebDavSession({ config, password })
    setNotes(remoteNotes)
    setActiveNoteId(remoteNotes[0].id)
    setRemoteNoteCount(remoteNotes.length)
    setMobileScreen("notes")
    return remoteNotes.length
  }

  const selectNote = async (note: Note) => {
    setActiveNoteId(note.id)
    setMobileScreen("editor")
    if (note.source !== "webdav" || note.contentLoaded || !note.remotePath || !webDavSession) return

    try {
      const content = await readMarkdownFile(
        webDavSession.config,
        webDavSession.password,
        note.remotePath,
      )
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
        connected={connected}
        mobileScreen={mobileScreen}
        notes={visibleNotes}
        onCreateNote={createNote}
        onFormat={formatActiveNote}
        onMobileScreenChange={setMobileScreen}
        onOpenSettings={() => setSettingsOpen(true)}
        onQueryChange={setQuery}
        onSelectNote={(note) => void selectNote(note)}
        onUpdateNote={updateActiveNote}
        query={query}
        syncLabel={syncLabel}
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
  if (!lastModified) return "云端文件"
  const date = new Date(lastModified)
  if (Number.isNaN(date.getTime())) return "云端文件"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export default App
