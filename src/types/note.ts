export type Note = {
  // 重命名改变路径与 id，编辑会话仍沿用原标识。
  editorSessionKey?: string
  id: string
  title: string
  preview: string
  content: string
  updatedAt: string
  modifiedAt?: number
  // 本机正文编辑序号；上传期间即使改回相同文字，也能识别快照之后的输入。
  localEditSequence?: number
  starred: boolean
  // 与收藏独立；WebDAV 库通过 .swell/note-pins.json 同步，旧缓存默认未置顶。
  pinned?: boolean
  pinPending?: boolean
  // 最近确认的置顶值和源路径，用于区分远端更新与本机操作，并在重命名后迁移配置。
  pinSynced?: { remotePath: string; pinned: boolean }
  folder?: string
  frontmatter?: Record<string, string | string[]>
  format?: "canvas" | "markdown"
  source?: "local" | "webdav"
  remotePath?: string
  readOnly?: boolean
  revision?: string
  baseContent?: string
  mergeConflictCount?: number
  searchText?: string
  outgoingLinks?: string[]
  contentLoaded?: boolean
  contentCached?: boolean
  draft?: boolean
  pendingOperation?: "create" | "delete" | "move"
  writeContentAfterMove?: boolean
  operationBeforeDelete?: "move"
  previousRemotePath?: string
  syncError?: string
  syncStatus?: "conflict" | "modified" | "synced"
  tags?: string[]
}

export type NoteSaveState = {
  message?: string
  status: "conflict" | "error" | "pending" | "readonly" | "saved" | "saving"
}
