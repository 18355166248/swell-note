import { isTauri } from "@tauri-apps/api/core"

import type { VaultAdapter, VaultFileEntry } from "@/services/vault/vault-adapter"

const ignoredDirectoryNames = new Set([".git", ".obsidian", "node_modules"])

type BrowserFileSystemFileHandle = {
  kind: "file"
  name: string
  getFile(): Promise<File>
}

type BrowserFileSystemDirectoryHandle = {
  kind: "directory"
  name: string
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

  const handles = new Map<string, BrowserFileSystemFileHandle>()

  return {
    displayName: root.name,
    kind: "browser",
    readOnly: true,
    async listMarkdownFiles() {
      const files: VaultFileEntry[] = []
      handles.clear()
      await collectBrowserMarkdownFiles(root, "", files, handles)
      return files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"))
    },
    async readTextFile(path) {
      const handle = handles.get(path)
      if (!handle) throw new Error(`找不到本地文件：${path}`)
      return (await handle.getFile()).text()
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
  const [{ open }, { readDir, readTextFile }, { join }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/path"),
  ])
  const rootPath = await open({ directory: true, multiple: false })
  if (!rootPath) return null
  const pathSegments = rootPath.split(/[\\/]/).filter(Boolean)

  return {
    displayName: pathSegments[pathSegments.length - 1] ?? "本地笔记库",
    kind: "tauri",
    readOnly: true,
    async listMarkdownFiles() {
      const files: VaultFileEntry[] = []
      await collectTauriMarkdownFiles(rootPath, "", files, readDir, join)
      return files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"))
    },
    async readTextFile(path) {
      return readTextFile(await join(rootPath, path))
    },
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
