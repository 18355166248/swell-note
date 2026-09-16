import type { PendingWebDavDirectoryMove } from "@/services/cache/vault-cache"
import { resolvePendingFolderMoveSourcePath } from "@/services/search/folder-rename"
import type { VaultAdapter } from "@/services/vault/vault-adapter"

export function resolveWebDavPhysicalPath(
  logicalPath: string,
  moves: readonly PendingWebDavDirectoryMove[],
  adapter: Pick<VaultAdapter, "getStoragePath"> | null,
) {
  // moved 阶段表示目录已经在目标位置；只有尚未发出 MOVE 的链路需要反向解析到物理源。
  const pendingMoves = moves.filter((move) => !move.moved)
  return resolvePendingFolderMoveSourcePath(logicalPath, pendingMoves, (folder) => (
    adapter?.getStoragePath?.(folder.split(/\s*\/\s*/).filter(Boolean).join("/"))
      ?? folder.split(/\s*\/\s*/).filter(Boolean).join("/")
  ))
}
