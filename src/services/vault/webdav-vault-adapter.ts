import type { WebDavConfig } from "@/lib/webdav-config"
import { listMarkdownFiles, readMarkdownFile, readWebDavAsset } from "@/services/webdav-client"
import type { VaultAdapter } from "@/services/vault/vault-adapter"

export function createWebDavVaultAdapter(
  config: WebDavConfig,
  password: string,
): VaultAdapter {
  return {
    cacheIdentity: `webdav:${config.serverUrl}:${config.username}:${config.remotePath}`,
    cacheLabel: `坚果云 · ${config.remotePath}`,
    displayName: "坚果云",
    getDisplayPath(path) {
      const rootPath = config.remotePath.replace(/^\/+|\/+$/g, "")
      const normalizedPath = path.replace(/^\/+/, "")
      return rootPath && normalizedPath.startsWith(`${rootPath}/`)
        ? normalizedPath.slice(rootPath.length + 1)
        : normalizedPath
    },
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
    readBinaryFile(path) {
      return readWebDavAsset(config, password, path)
    },
  }
}
