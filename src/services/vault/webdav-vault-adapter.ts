import type { WebDavConfig } from "@/lib/webdav-config"
import {
  listMarkdownFiles,
  readMarkdownDocument,
  readWebDavAsset,
  WebDavRevisionConflictError,
  writeMarkdownFile,
} from "@/services/webdav-client"
import { VaultConflictError, type VaultAdapter } from "@/services/vault/vault-adapter"

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
        revision: file.revision,
        updatedAt: file.lastModified,
      }))
    },
    async readTextFile(path) {
      return readMarkdownDocument(config, password, path)
    },
    readBinaryFile(path) {
      return readWebDavAsset(config, password, path)
    },
    async writeTextFile(path, content, expectedRevision) {
      if (!expectedRevision) {
        throw new VaultConflictError(path, "缺少远端版本信息，请重新连接坚果云后再同步")
      }
      try {
        return await writeMarkdownFile(config, password, path, content, expectedRevision)
      } catch (error) {
        if (error instanceof WebDavRevisionConflictError) {
          throw new VaultConflictError(path, "坚果云中的文件已被其他设备修改，本地版本已保留，请先处理冲突")
        }
        throw error
      }
    },
  }
}
