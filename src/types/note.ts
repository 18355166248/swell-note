export type Note = {
  id: string
  title: string
  preview: string
  content: string
  updatedAt: string
  starred: boolean
  folder?: string
  source?: "local" | "webdav"
  remotePath?: string
  readOnly?: boolean
  revision?: string
  searchText?: string
  outgoingLinks?: string[]
  contentLoaded?: boolean
}

export type NoteSaveState = {
  message?: string
  status: "conflict" | "error" | "readonly" | "saved" | "saving"
}
