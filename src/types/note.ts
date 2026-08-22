export type Note = {
  id: string
  title: string
  preview: string
  content: string
  updatedAt: string
  starred: boolean
  folder?: string
  source?: "demo" | "local" | "webdav"
  remotePath?: string
  contentLoaded?: boolean
}
