export type Note = {
  id: string
  title: string
  preview: string
  content: string
  updatedAt: string
  modifiedAt?: number
  starred: boolean
  folder?: string
  source?: "local" | "webdav"
  remotePath?: string
  readOnly?: boolean
  revision?: string
  searchText?: string
  outgoingLinks?: string[]
  contentLoaded?: boolean
  syncStatus?: "conflict" | "modified" | "synced"
}

export type NoteSaveState = {
  message?: string
  status: "conflict" | "error" | "pending" | "readonly" | "saved" | "saving"
}
