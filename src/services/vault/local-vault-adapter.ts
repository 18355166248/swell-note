import { isTauri } from "@tauri-apps/api/core"

import {
  VaultConflictError,
  type VaultAdapter,
  type VaultFileEntry,
} from "@/services/vault/vault-adapter"

const ignoredDirectoryNames = new Set([".git", ".obsidian", "node_modules"])

type BrowserFileSystemFileHandle = {
  kind: "file"
  name: string
  createWritable(): Promise<{
    close(): Promise<void>
    write(data: string): Promise<void>
  }>
  getFile(): Promise<File>
}

type BrowserFileSystemDirectoryHandle = {
  kind: "directory"
  name: string
  getDirectoryHandle(name: string): Promise<BrowserFileSystemDirectoryHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileSystemFileHandle>
  removeEntry(name: string): Promise<void>
  values(): AsyncIterableIterator<BrowserFileSystemFileHandle | BrowserFileSystemDirectoryHandle>
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<BrowserFileSystemDirectoryHandle>
}

export function canSelectLocalVault() {
  return isTauri() || typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
}

export async function selectLocalVaultAdapter(): Promise<VaultAdapter | null> {
  return isTauri() ? selectTauriVault() : selectBrowserVault()
}

async function selectBrowserVault(): Promise<VaultAdapter | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) {
    throw new Error("当前浏览器不支持目录读取，请使用 Chrome、Edge 或桌面客户端")
  }

  let root: BrowserFileSystemDirectoryHandle
  try {
    root = await picker()
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null
    throw error
  }

  return createBrowserVaultAdapter(root)
}

export function createBrowserVaultAdapter(root: BrowserFileSystemDirectoryHandle): VaultAdapter {
  const handles = new Map<string, BrowserFileSystemFileHandle>()
  return {
    cacheIdentity: `browser:${root.name}`,
    cacheLabel: `本地 · ${root.name}`,
    displayName: root.name,
    kind: "browser",
    readOnly: false,
    async createTextFile(path, content) {
      if (handles.has(path)) throw new Error(`文件已存在：${path}`)
      const handle = await getBrowserFileHandle(root, path, true)
      await writeBrowserFile(handle, content)
      handles.set(path, handle)
      return { path, revision: browserRevision(await handle.getFile()) }
    },
    async deleteTextFile(path) {
      const { directory, fileName } = await resolveBrowserFileParent(root, path)
      await directory.removeEntry(fileName)
      handles.delete(path)
    },
    async listMarkdownFiles() {
      const files: VaultFileEntry[] = []
      handles.clear()
      await collectBrowserMarkdownFiles(root, "", files, handles)
      return files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"))
    },
    async readTextFile(path) {
      const handle = handles.get(path)
      if (!handle) throw new Error(`找不到本地文件：${path}`)
      const file = await handle.getFile()
      return { content: await file.text(), revision: browserRevision(file) }
    },
    async readBinaryFile(path) {
      const file = await getBrowserFileHandle(root, path, false).then((handle) => handle.getFile())
      return { data: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || undefined }
    },
    async moveTextFile(path, targetPath) {
      if (handles.has(targetPath)) throw new Error(`目标文件已存在：${targetPath}`)
      const sourceHandle = handles.get(path)
      if (!sourceHandle) throw new Error(`找不到本地文件：${path}`)
      const content = await sourceHandle.getFile().then((file) => file.text())
      const targetHandle = await getBrowserFileHandle(root, targetPath, true)
      await writeBrowserFile(targetHandle, content)
      try {
        const { directory, fileName } = await resolveBrowserFileParent(root, path)
        await directory.removeEntry(fileName)
      } catch (error) {
        const { directory, fileName } = await resolveBrowserFileParent(root, targetPath)
        await directory.removeEntry(fileName).catch(() => undefined)
        throw error
      }
      handles.delete(path)
      handles.set(targetPath, targetHandle)
      return { path: targetPath, revision: browserRevision(await targetHandle.getFile()) }
    },
    async writeTextFile(path, content, expectedRevision) {
      const handle = handles.get(path)
      if (!handle) throw new Error(`找不到本地文件：${path}`)
      const currentFile = await handle.getFile()
      if (expectedRevision && browserRevision(currentFile) !== expectedRevision) {
        const conflictPath = createConflictPath(path)
        const conflictHandle = await getBrowserFileHandle(root, conflictPath, true)
        await writeBrowserFile(conflictHandle, content)
        throw new VaultConflictError(conflictPath)
      }

      await writeBrowserFile(handle, content)
      return { revision: browserRevision(await handle.getFile()) }
    },
  }
}

async function collectBrowserMarkdownFiles(
  directory: BrowserFileSystemDirectoryHandle,
  parentPath: string,
  files: VaultFileEntry[],
  handles: Map<string, BrowserFileSystemFileHandle>,
) {
  for await (const entry of directory.values()) {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name
    if (entry.kind === "directory") {
      if (!ignoredDirectoryNames.has(entry.name)) {
        await collectBrowserMarkdownFiles(entry, path, files, handles)
      }
      continue
    }
    if (!entry.name.toLocaleLowerCase().endsWith(".md")) continue

    const file = await entry.getFile()
    handles.set(path, entry)
    files.push({
      name: entry.name,
      path,
      updatedAt: new Date(file.lastModified).toISOString(),
    })
  }
}

async function selectTauriVault(): Promise<VaultAdapter | null> {
  const [{ open }, { exists, readDir, readFile, readTextFile, remove, rename, stat, writeTextFile }, { join }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/path"),
  ])
  const rootPath = await open({ directory: true, multiple: false })
  if (!rootPath) return null
  const pathSegments = rootPath.split(/[\\/]/).filter(Boolean)

  return {
    cacheIdentity: `tauri:${rootPath}`,
    cacheLabel: `本地 · ${pathSegments[pathSegments.length - 1] ?? "笔记库"}`,
    displayName: pathSegments[pathSegments.length - 1] ?? "本地笔记库",
    kind: "tauri",
    readOnly: false,
    async createTextFile(path, content) {
      const absolutePath = await join(rootPath, path)
      if (await exists(absolutePath)) throw new Error(`文件已存在：${path}`)
      await writeTextFile(absolutePath, content)
      return { path, revision: tauriRevision(await stat(absolutePath)) }
    },
    async deleteTextFile(path) {
      await remove(await join(rootPath, path))
    },
    async listMarkdownFiles() {
      const files: VaultFileEntry[] = []
      await collectTauriMarkdownFiles(rootPath, "", files, readDir, join)
      return files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"))
    },
    async readTextFile(path) {
      const absolutePath = await join(rootPath, path)
      const [content, fileInfo] = await Promise.all([
        readTextFile(absolutePath),
        stat(absolutePath),
      ])
      return { content, revision: tauriRevision(fileInfo) }
    },
    async readBinaryFile(path) {
      return { data: await readFile(await join(rootPath, path)), mimeType: mimeTypeFromPath(path) }
    },
    async moveTextFile(path, targetPath) {
      const [absolutePath, absoluteTargetPath] = await Promise.all([
        join(rootPath, path),
        join(rootPath, targetPath),
      ])
      if (await exists(absoluteTargetPath)) throw new Error(`目标文件已存在：${targetPath}`)
      await rename(absolutePath, absoluteTargetPath)
      return { path: targetPath, revision: tauriRevision(await stat(absoluteTargetPath)) }
    },
    async writeTextFile(path, content, expectedRevision) {
      const absolutePath = await join(rootPath, path)
      const currentRevision = tauriRevision(await stat(absolutePath))
      if (expectedRevision && currentRevision !== expectedRevision) {
        const conflictPath = createConflictPath(path)
        await writeTextFile(await join(rootPath, conflictPath), content)
        throw new VaultConflictError(conflictPath)
      }

      await writeTextFile(absolutePath, content)
      return { revision: tauriRevision(await stat(absolutePath)) }
    },
  }
}

function browserRevision(file: File) {
  return `${file.lastModified}:${file.size}`
}

function tauriRevision(file: Awaited<ReturnType<typeof import("@tauri-apps/plugin-fs").stat>>) {
  return `${file.mtime?.getTime() ?? 0}:${file.size}`
}

function createConflictPath(path: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  return path.replace(/\.md$/i, `.conflict-${timestamp}.md`)
}

function mimeTypeFromPath(path: string) {
  const extension = path.split(".").pop()?.toLocaleLowerCase()
  return extension === "png" ? "image/png"
    : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
      : extension === "gif" ? "image/gif"
        : extension === "webp" ? "image/webp"
          : extension === "svg" ? "image/svg+xml"
            : undefined
}

async function getBrowserFileHandle(
  root: BrowserFileSystemDirectoryHandle,
  path: string,
  create: boolean,
) {
  const segments = path.split("/").filter(Boolean)
  const fileName = segments.pop()
  if (!fileName) throw new Error("冲突副本路径无效")

  let directory = root
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment)
  }
  return directory.getFileHandle(fileName, { create })
}

async function resolveBrowserFileParent(
  root: BrowserFileSystemDirectoryHandle,
  path: string,
) {
  const segments = path.split("/").filter(Boolean)
  const fileName = segments.pop()
  if (!fileName) throw new Error("文件路径无效")
  let directory = root
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment)
  return { directory, fileName }
}

async function writeBrowserFile(handle: BrowserFileSystemFileHandle, content: string) {
  const writable = await handle.createWritable()
  try {
    await writable.write(content)
  } finally {
    await writable.close()
  }
}

async function collectTauriMarkdownFiles(
  absoluteDirectory: string,
  relativeDirectory: string,
  files: VaultFileEntry[],
  readDir: typeof import("@tauri-apps/plugin-fs").readDir,
  join: typeof import("@tauri-apps/api/path").join,
) {
  const entries = await readDir(absoluteDirectory)
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name
    if (entry.isDirectory) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        await collectTauriMarkdownFiles(
          await join(absoluteDirectory, entry.name),
          relativePath,
          files,
          readDir,
          join,
        )
      }
      continue
    }
    if (entry.isFile && entry.name.toLocaleLowerCase().endsWith(".md")) {
      files.push({ name: entry.name, path: relativePath })
    }
  }
}
