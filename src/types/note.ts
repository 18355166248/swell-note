export type Note = {
  id: string
  title: string
  preview: string
  content: string
  updatedAt: string
  modifiedAt?: number
  starred: boolean
  folder?: string
  frontmatter?: Record<string, string | string[]>
  source?: "local" | "webdav"
  remotePath?: string
  readOnly?: boolean
  revision?: string
  searchText?: string
  outgoingLinks?: string[]
  contentLoaded?: boolean
  pendingOperation?: "create" | "delete" | "move"
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
