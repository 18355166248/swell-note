import type { WebDavConfig } from "@/lib/webdav-config"
import { FOLDER_ORDER_MAX_BYTES } from "@/services/preferences/folder-order-document"
import { NOTE_PINS_MAX_BYTES } from "@/services/preferences/note-pins-document"
import {
  checkWebDavDirectoryExists,
  completeWebDavDirectoryMove,
  createJsonDocument,
  createMarkdownFile,
  createWebDavBinaryFile,
  deleteMarkdownFile,
  ensureWebDavDirectory,
  listMarkdownFiles,
  listWebDavDirectories,
  moveWebDavDirectory,
  moveMarkdownFile,
  readJsonDocument,
  readMarkdownDocument,
  readWebDavAsset,
  updateJsonDocument,
  WebDavRevisionConflictError,
  writeMarkdownFile,
} from "@/services/webdav-client"
import { VaultConflictError, type VaultAdapter } from "@/services/vault/vault-adapter"

export function createWebDavVaultAdapter(
  config: WebDavConfig,
  password: string,
): VaultAdapter {
  // 排序元数据固定在 <root>/.swell/folder-order.json；凭据留在闭包里，组件层不可见。
  const metadataDirectoryPath = `${config.remotePath.replace(/\/+$/g, "")}/.swell`
  const folderOrderDocumentPath = `${metadataDirectoryPath}/folder-order.json`
  const notePinDocumentPath = `${metadataDirectoryPath}/note-pins.json`
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
    getStoragePath(displayPath) {
      const rootPath = config.remotePath.replace(/\/+$/g, "")
      const relativePath = displayPath.replace(/^\/+/, "")
      return `${rootPath}/${relativePath}`.replace(/\/{2,}/g, "/")
    },
    kind: "webdav",
    readOnly: true,
    // 与文件夹排序共用条件写协议，置顶配置独立存储，不改写 Markdown 正文。
    notePinStore: {
      async ensureMetadataDirectory() {
        await ensureWebDavDirectory(config, password, metadataDirectoryPath)
      },
      readDocument() {
        return readJsonDocument(config, password, notePinDocumentPath, NOTE_PINS_MAX_BYTES)
      },
      createDocument(body) {
        return createJsonDocument(config, password, notePinDocumentPath, body)
      },
      updateDocument(body, expectedEtag) {
        return updateJsonDocument(config, password, notePinDocumentPath, body, expectedEtag)
      },
      verifyRoot() {
        return checkWebDavDirectoryExists(config, password, config.remotePath)
      },
    },
    folderOrderStore: {
      async ensureMetadataDirectory() {
        await ensureWebDavDirectory(config, password, metadataDirectoryPath)
      },
      readDocument() {
        return readJsonDocument(config, password, folderOrderDocumentPath, FOLDER_ORDER_MAX_BYTES)
      },
      createDocument(body) {
        return createJsonDocument(config, password, folderOrderDocumentPath, body)
      },
      updateDocument(body, expectedEtag) {
        return updateJsonDocument(config, password, folderOrderDocumentPath, body, expectedEtag)
      },
      verifyRoot() {
        return checkWebDavDirectoryExists(config, password, config.remotePath)
      },
    },
    async createBinaryFile(path, data, mimeType) {
      try {
        const result = await createWebDavBinaryFile(config, password, path, data, mimeType)
        return { path, revision: result.revision }
      } catch (error) {
        if (error instanceof WebDavRevisionConflictError) {
          throw new VaultConflictError(path, "坚果云中已存在同名附件，本地附件仍保留在同步队列")
        }
        throw error
      }
    },
    ensureDirectory(path) {
      return ensureWebDavDirectory(config, password, path)
    },
    async listMarkdownFiles() {
      return (await listMarkdownFiles(config, password)).map((file) => ({
        name: file.name,
        path: file.path,
        revision: file.revision,
        updatedAt: file.lastModified,
      }))
    },
    listDirectories() {
      return listWebDavDirectories(config, password)
    },
    moveDirectory(path, targetPath, operationId) {
      // 目录 MOVE 是唯一的远端结构动作；其下笔记和附件不再逐文件 MOVE，避免重复迁移。
      if (!operationId) throw new Error("WebDAV 目录移动缺少操作标识")
      return moveWebDavDirectory(config, password, path, targetPath, operationId)
    },
    completeDirectoryMove(targetPath, operationId) {
      return completeWebDavDirectoryMove(config, password, targetPath, operationId)
    },
    async readTextFile(path) {
      return readMarkdownDocument(config, password, path)
    },
    readBinaryFile(path) {
      return readWebDavAsset(config, password, path)
    },
    async createTextFile(path, content) {
      try {
        const result = await createMarkdownFile(config, password, path, content)
        return { path, revision: result.revision }
      } catch (error) {
        if (error instanceof WebDavRevisionConflictError) {
          throw new VaultConflictError(path, "坚果云中已存在同名文件，本地新笔记已保留")
        }
        throw error
      }
    },
    async deleteTextFile(path, expectedRevision) {
      if (!expectedRevision) {
        throw new VaultConflictError(path, "缺少远端版本信息，请重新连接坚果云后再删除")
      }
      try {
        await deleteMarkdownFile(config, password, path, expectedRevision)
      } catch (error) {
        if (error instanceof WebDavRevisionConflictError) {
          throw new VaultConflictError(path, "坚果云中的文件已被其他设备修改，本地删除请求已保留")
        }
        throw error
      }
    },
    async moveTextFile(path, targetPath, expectedRevision) {
      if (!expectedRevision) {
        throw new VaultConflictError(path, "缺少远端版本信息，请重新连接坚果云后再移动")
      }
      try {
        const result = await moveMarkdownFile(config, password, path, targetPath, expectedRevision)
        return { path: targetPath, revision: result.revision }
      } catch (error) {
        if (error instanceof WebDavRevisionConflictError) {
          throw new VaultConflictError(path, "坚果云中的文件已被其他设备修改，本地移动请求已保留")
        }
        throw error
      }
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
