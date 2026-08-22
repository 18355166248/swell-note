export type VaultSourceKind = "browser" | "tauri" | "webdav"

export type VaultFileEntry = {
  name: string
  path: string
  updatedAt?: string
}

export type VaultDocument = {
  content: string
  revision?: string
}

export type VaultAsset = {
  data: Uint8Array
  mimeType?: string
}

export type VaultWriteResult = {
  revision: string
}

export class VaultConflictError extends Error {
  readonly conflictPath: string

  constructor(conflictPath: string) {
    super(`源文件已被其他程序修改，当前草稿已保留为冲突副本：${conflictPath}`)
    this.name = "VaultConflictError"
    this.conflictPath = conflictPath
  }
}

export interface VaultAdapter {
  readonly displayName: string
  readonly cacheIdentity: string
  readonly cacheLabel: string
  readonly kind: VaultSourceKind
  readonly readOnly: boolean
  getDisplayPath?(path: string): string
  listMarkdownFiles(): Promise<VaultFileEntry[]>
  readBinaryFile?(path: string): Promise<VaultAsset>
  readTextFile(path: string): Promise<VaultDocument>
  writeTextFile?(path: string, content: string, expectedRevision?: string): Promise<VaultWriteResult>
}
