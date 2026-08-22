import type { WebDavConfig } from "@/lib/webdav-config"
import { listMarkdownFiles, readMarkdownFile } from "@/services/webdav-client"
import type { VaultAdapter } from "@/services/vault/vault-adapter"

export function createWebDavVaultAdapter(
  config: WebDavConfig,
  password: string,
): VaultAdapter {
  return {
    displayName: "坚果云",
    kind: "webdav",
    readOnly: true,
    async listMarkdownFiles() {
      return (await listMarkdownFiles(config, password)).map((file) => ({
        name: file.name,
        path: file.path,
        updatedAt: file.lastModified,
      }))
    },
    async readTextFile(path) {
      return { content: await readMarkdownFile(config, password, path) }
    },
  }
}
