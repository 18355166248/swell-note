export type VaultSourceKind = "browser" | "tauri" | "webdav"

export type VaultFileEntry = {
  name: string
  path: string
  revision?: string
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
  revision?: string
}

export type VaultCreateResult = VaultWriteResult & {
  path: string
}

export class VaultConflictError extends Error {
  readonly conflictPath: string

  constructor(conflictPath: string, message?: string) {
    super(message ?? `源文件已被其他程序修改，当前草稿已保留为冲突副本：${conflictPath}`)
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
  getStoragePath?(displayPath: string): string
  ensureDirectory?(path: string): Promise<void>
  createDirectory?(path: string): Promise<void>
  deleteDirectory?(path: string): Promise<void>
  listDirectories?(): Promise<string[]>
  moveDirectory?(path: string, targetPath: string): Promise<void>
  createBinaryFile?(path: string, data: Uint8Array, mimeType?: string): Promise<VaultCreateResult>
  createTextFile?(path: string, content: string): Promise<VaultCreateResult>
  deleteTextFile?(path: string, expectedRevision?: string): Promise<void>
  listMarkdownFiles(): Promise<VaultFileEntry[]>
  readBinaryFile?(path: string): Promise<VaultAsset>
  readTextFile(path: string): Promise<VaultDocument>
  moveTextFile?(path: string, targetPath: string, expectedRevision?: string): Promise<VaultCreateResult>
  writeTextFile?(path: string, content: string, expectedRevision?: string): Promise<VaultWriteResult>
}
