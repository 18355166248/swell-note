import {
  createVaultCacheId,
  saveVaultDirectoryQueueCheckpoint,
  type VaultDirectoryNoteCheckpoint,
  type PendingWebDavDirectoryMove,
  type VaultCacheSnapshot,
} from "@/services/cache/vault-cache"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { resolveWebDavPhysicalPath } from "./webdav-physical-path"

export type WebDavDirectoryQueueResult = {
  interrupted: boolean
  remainingCount: number
  snapshot: VaultCacheSnapshot
}

type WebDavDirectoryQueueOptions = {
  adapter: VaultAdapter
  adapterIdentity: string
  cacheId: string
  isCancelled?: () => boolean
  isScopeCurrent: () => boolean
  onLabel?: (label: string) => void
  onSnapshot?: (snapshot: VaultCacheSnapshot) => void
  persist?: (
    snapshot: VaultCacheSnapshot,
    noteUpdates?: readonly VaultDirectoryNoteCheckpoint[],
  ) => Promise<VaultCacheSnapshot | void>
  snapshot: VaultCacheSnapshot
}

function storageDirectory(adapter: VaultAdapter, folder: string) {
  const displayPath = folder.split(/\s*\/\s*/).filter(Boolean).join("/")
  return adapter.getStoragePath?.(displayPath) ?? displayPath
}

function pathInside(path: string | undefined, directory: string) {
  return Boolean(path && (path === directory || path.startsWith(`${directory}/`)))
}

function replaceMove(
  moves: readonly PendingWebDavDirectoryMove[],
  id: string,
  update: (move: PendingWebDavDirectoryMove) => PendingWebDavDirectoryMove | null,
) {
  return moves.flatMap((move) => {
    if (move.id !== id) return [move]
    const next = update(move)
    return next ? [next] : []
  })
}

async function reconcileMovedNoteRevisions(
  adapter: VaultAdapter,
  snapshot: VaultCacheSnapshot,
  move: PendingWebDavDirectoryMove,
  isScopeCurrent: () => boolean,
) {
  const targetDirectory = storageDirectory(adapter, move.targetFolder)
  const nextNotes = [...snapshot.notes]
  for (let index = 0; index < nextNotes.length; index += 1) {
    const note = nextNotes[index]
    if (note.source !== "webdav" || note.syncStatus !== "modified" || note.pendingOperation === "create") continue
    const logicalOrPreviousPath = note.previousRemotePath ?? note.remotePath
    const physicalPath = logicalOrPreviousPath
      ? resolveWebDavPhysicalPath(logicalOrPreviousPath, snapshot.pendingDirectoryMoves ?? [], adapter)
      : undefined
    if (!physicalPath || !pathInside(physicalPath, targetDirectory)) continue
    if (!isScopeCurrent()) return { interrupted: true, notes: nextNotes }
    const remote = await adapter.readTextFile(physicalPath)
    if (!isScopeCurrent()) return { interrupted: true, notes: nextNotes }
    const baseContent = note.baseContent ?? note.content
    nextNotes[index] = remote.content === baseContent
      ? { ...note, revision: remote.revision }
      : { ...note, syncError: undefined, syncStatus: "conflict" }
  }
  return { interrupted: false, notes: nextNotes }
}

export async function syncWebDavDirectoryQueue({
  adapter,
  adapterIdentity,
  cacheId,
  isCancelled = () => false,
  isScopeCurrent,
  onLabel,
  onSnapshot,
  persist = (snapshot, noteUpdates) => saveVaultDirectoryQueueCheckpoint(snapshot, noteUpdates),
  snapshot: initialSnapshot,
}: WebDavDirectoryQueueOptions): Promise<WebDavDirectoryQueueResult> {
  if (adapter.kind !== "webdav" || !adapter.ensureDirectory) {
    return {
      interrupted: false,
      remainingCount: (initialSnapshot.pendingDirectories?.length ?? 0) + (initialSnapshot.pendingDirectoryMoves?.length ?? 0),
      snapshot: initialSnapshot,
    }
  }
  // 队列同时绑定哈希 cacheId 与不可变 adapter identity；任何一个不一致都不得触碰远端。
  if (adapter.cacheIdentity !== adapterIdentity || await createVaultCacheId(adapter.cacheIdentity) !== cacheId) {
    throw new Error("同步会话与目录队列不属于同一笔记库")
  }
  let snapshot = initialSnapshot
  const publish = () => {
    if (isScopeCurrent()) onSnapshot?.(snapshot)
  }
  const interrupted = () => isCancelled() || !isScopeCurrent()

  for (const queuedMove of [...(snapshot.pendingDirectoryMoves ?? [])]) {
    if (interrupted()) return finish(snapshot, true)
    if (!adapter.moveDirectory) throw new Error("当前 WebDAV 客户端不支持目录重命名")
    let move = (snapshot.pendingDirectoryMoves ?? []).find((candidate) => candidate.id === queuedMove.id)
    if (!move) continue
    const sourcePath = storageDirectory(adapter, move.sourceFolder)
    const targetPath = storageDirectory(adapter, move.targetFolder)
    onLabel?.(`重命名文件夹 ${move.sourceFolder}`)

    if (!move.moved) {
      if (interrupted()) return finish(snapshot, true)
      await adapter.moveDirectory(sourcePath, targetPath, move.id)
      // MOVE 返回后即使用户切库，也必须把“已移动”阶段写回来源库；但不能更新当前库 UI 或继续发请求。
      snapshot = {
        ...snapshot,
        pendingDirectoryMoves: replaceMove(snapshot.pendingDirectoryMoves ?? [], move.id, (current) => ({ ...current, moved: true })),
        savedAt: Date.now(),
      }
      snapshot = await persist(snapshot) ?? snapshot
      if (interrupted()) return finish(snapshot, true)
      publish()
      move = { ...move, moved: true }
    }

    const reconciled = await reconcileMovedNoteRevisions(adapter, snapshot, move, isScopeCurrent)
    if (reconciled.interrupted || isCancelled()) return finish(snapshot, true)
    const noteUpdates: VaultDirectoryNoteCheckpoint[] = reconciled.notes.flatMap((note, index) => {
      const previous = snapshot.notes[index]
      return previous && (previous.revision !== note.revision || previous.syncStatus !== note.syncStatus || previous.syncError !== note.syncError)
        ? [{ id: note.id, revision: note.revision, syncError: note.syncError, syncStatus: note.syncStatus }]
        : []
    })
    snapshot = {
      ...snapshot,
      notes: reconciled.notes,
      pendingDirectoryMoves: replaceMove(snapshot.pendingDirectoryMoves ?? [], move.id, () => null),
      savedAt: Date.now(),
    }
    // 先持久化“已核对且出队”，再清远端凭证；崩溃后不会复活已完成 MOVE。
    snapshot = await persist(snapshot, noteUpdates) ?? snapshot
    if (interrupted()) return finish(snapshot, true)
    publish()
    if (adapter.completeDirectoryMove) {
      await adapter.completeDirectoryMove(targetPath, move.id).catch(() => undefined)
      if (interrupted()) return finish(snapshot, true)
    }
  }

  for (const folderPath of [...(snapshot.pendingDirectories ?? [])]) {
    if (interrupted()) return finish(snapshot, true)
    const storagePath = storageDirectory(adapter, folderPath)
    onLabel?.(`创建文件夹 ${folderPath}`)
    await adapter.ensureDirectory(storagePath)
    snapshot = {
      ...snapshot,
      pendingDirectories: (snapshot.pendingDirectories ?? []).filter((path) => path !== folderPath),
      savedAt: Date.now(),
    }
    snapshot = await persist(snapshot) ?? snapshot
    if (interrupted()) return finish(snapshot, true)
    publish()
  }

  return finish(snapshot, false)
}

function finish(snapshot: VaultCacheSnapshot, interrupted: boolean): WebDavDirectoryQueueResult {
  return {
    interrupted,
    remainingCount: (snapshot.pendingDirectories?.length ?? 0) + (snapshot.pendingDirectoryMoves?.length ?? 0),
    snapshot,
  }
}
