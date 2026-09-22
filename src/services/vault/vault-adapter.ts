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

// 可选的文件夹排序元数据能力：只有支持条件写入的适配器（本期为 WebDAV）实现。
// 凭据封装在适配器闭包内，组件层永远接触不到密码。
export type VaultFolderOrderDocument = {
  bytes: Uint8Array
  // 服务端 ETag 原文；弱 ETag 标记为 etagWeak，不能用于 If-Match 条件更新。
  etag: string | null
  etagWeak: boolean
}

export type VaultFolderOrderWriteResult = {
  // PUT 不返回新 ETag 时为 null：调用方必须 GET 读回核对，不能沿用旧 ETag。
  etag: string | null
  etagWeak: boolean
}

export type VaultFolderOrderStore = {
  // 首次真正写入时才创建 .swell 元数据目录；只读刷新不调用。
  ensureMetadataDirectory(): Promise<void>
  // 读取配置；文件不存在返回 null（与非法内容/读取失败区分）。
  readDocument(): Promise<VaultFolderOrderDocument | null>
  // 条件创建（If-None-Match: *）：远端已存在时抛冲突，绝不覆盖。
  createDocument(body: string): Promise<VaultFolderOrderWriteResult>
  // 条件更新（If-Match: 强 ETag）：版本不匹配时抛冲突。
  updateDocument(body: string, expectedEtag: string): Promise<VaultFolderOrderWriteResult>
  // 确认笔记库根目录仍然存在：配置 404 只有配合根目录存在才能视为“配置被重置”。
  verifyRoot(): Promise<boolean>
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
  readonly folderOrderStore?: VaultFolderOrderStore
  readonly notePinStore?: VaultFolderOrderStore
  getDisplayPath?(path: string): string
  getStoragePath?(displayPath: string): string
  ensureDirectory?(path: string): Promise<void>
  createDirectory?(path: string): Promise<void>
  deleteDirectory?(path: string): Promise<void>
  listDirectories?(): Promise<string[]>
  moveDirectory?(path: string, targetPath: string, operationId?: string): Promise<void>
  completeDirectoryMove?(targetPath: string, operationId: string): Promise<void>
  openSourceFile?(path: string): Promise<void>
  createBinaryFile?(path: string, data: Uint8Array, mimeType?: string): Promise<VaultCreateResult>
  createTextFile?(path: string, content: string): Promise<VaultCreateResult>
  deleteTextFile?(path: string, expectedRevision?: string): Promise<void>
  listMarkdownFiles(): Promise<VaultFileEntry[]>
  readBinaryFile?(path: string): Promise<VaultAsset>
  readTextFile(path: string): Promise<VaultDocument>
  moveTextFile?(path: string, targetPath: string, expectedRevision?: string): Promise<VaultCreateResult>
  watchChanges?(onChange: () => void): Promise<() => void>
  writeTextFile?(path: string, content: string, expectedRevision?: string): Promise<VaultWriteResult>
}
