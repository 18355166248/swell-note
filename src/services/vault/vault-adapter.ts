export type VaultSourceKind = "browser" | "tauri" | "webdav"

export type VaultFileEntry = {
  name: string
  path: string
  updatedAt?: string
}

export interface VaultAdapter {
  readonly displayName: string
  readonly kind: VaultSourceKind
  readonly readOnly: boolean
  listMarkdownFiles(): Promise<VaultFileEntry[]>
  readTextFile(path: string): Promise<string>
}
