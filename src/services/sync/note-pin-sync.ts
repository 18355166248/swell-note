import { isNotePinPath, parseNotePinsDocument, serializeNotePinsDocument } from "@/services/preferences/note-pins-document"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { WebDavRevisionConflictError } from "@/services/webdav-client"
import type { Note } from "@/types/note"

export function hasPendingNotePin(note: Note) {
  return note.source === "webdav" && Boolean(note.remotePath) && note.pendingOperation !== "delete"
    && Boolean(note.pinPending || (!note.pinSynced && note.pinned)
      || (note.pinSynced && note.pinSynced.remotePath !== note.remotePath))
}

export function notePinQueueKey(notes: readonly Note[]) {
  return JSON.stringify(notes.filter(hasPendingNotePin).map((note) => [note.id, note.remotePath, Boolean(note.pinned), note.pinSynced?.remotePath]))
}

function relativePath(adapter: VaultAdapter, path: string) {
  const relative = adapter.getDisplayPath?.(path)
  if (!isNotePinPath(relative)) throw new Error("无法确定置顶笔记的库内路径，已保留本机修改")
  return relative
}

// 调用方在整库同步屏障内运行，期间禁止本机置顶编辑；返回值与笔记快照一起持久化。
// 只覆盖本机明确修改的条目，其他条目采用刚读取的远端状态；同篇笔记以后一次成功提交为准。
export async function syncNotePins({ adapter, notes, allowUpload, isCancelled }: {
  adapter: VaultAdapter
  notes: Note[]
  allowUpload: boolean
  isCancelled?: () => boolean
}): Promise<Note[]> {
  const store = adapter.notePinStore
  if (adapter.kind !== "webdav" || !store || isCancelled?.()) return notes
  const eligible = notes.filter((note) => note.source === "webdav" && note.remotePath && !note.pendingOperation)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (isCancelled?.()) return notes
    const remote = await store.readDocument()
    if (isCancelled?.()) return notes
    if (!remote && !await store.verifyRoot()) throw new Error("无法确认远端笔记库，已保留本机置顶状态")
    if (isCancelled?.()) return notes
    const document = remote ? parseNotePinsDocument(remote.bytes) : null
    const remotePins = new Set(document?.pins ?? [])
    const mergedPins = new Set(remotePins)
    const pending = new Set<string>()
    const removedPaths = new Set<string>()
    const updates = new Map<string, boolean>()

    for (const note of eligible) {
      const path = relativePath(adapter, note.remotePath!)
      if (!hasPendingNotePin(note)) continue
      // 旧版只有 pinned：首次遇到已有云端配置时以云端为准；用户新操作由 pinPending 明确保留。
      if (!note.pinPending && !note.pinSynced && document) continue
      pending.add(note.id)
      let pinned = Boolean(note.pinned)
      if (note.pinSynced && note.pinSynced.remotePath !== note.remotePath) {
        const previousPath = relativePath(adapter, note.pinSynced.remotePath)
        // 迁移路径时尊重另一设备刚同步的取消置顶，除非本机也明确切换过置顶。
        if (!note.pinPending) pinned = remotePins.has(previousPath) || remotePins.has(path)
        removedPaths.add(previousPath)
      }
      updates.set(path, pinned)
    }
    // 先清理迁移源，再应用各笔记当前路径的意图；否则“旧 A 改名后新建并置顶 A”
    // 会因列表遍历顺序不同，被旧笔记的迁移清理误删新 A 的置顶。
    for (const path of removedPaths) mergedPins.delete(path)
    for (const [path, pinned] of updates) {
      if (pinned) mergedPins.add(path)
      else mergedPins.delete(path)
    }

    const changed = mergedPins.size !== remotePins.size || [...mergedPins].some((path) => !remotePins.has(path))
    const canConfirm = !changed || allowUpload
    if (changed && allowUpload) {
      const body = serializeNotePinsDocument(document, mergedPins)
      if (isCancelled?.()) return notes
      try {
        if (remote) {
          if (!remote.etag || remote.etagWeak) throw new Error("服务端缺少强 ETag，无法安全更新置顶配置；本机修改已保留")
          await store.updateDocument(body, remote.etag)
        } else {
          await store.ensureMetadataDirectory()
          if (isCancelled?.()) return notes
          await store.createDocument(body)
        }
        // PUT 已成功即确认本次提交；下次同步重新 GET，绝不沿用旧 ETag。
      } catch (error) {
        // 并发写入只重读并重放逐条意图，不能用新 ETag 强写旧的整表快照。
        if (error instanceof WebDavRevisionConflictError && attempt < 2) continue
        throw error
      }
    }

    const eligibleIds = new Set(eligible.map((note) => note.id))
    return notes.map((note) => {
      if (!eligibleIds.has(note.id) || (!canConfirm && pending.has(note.id))) return note
      const pinned = (canConfirm ? mergedPins : remotePins).has(relativePath(adapter, note.remotePath!))
      return { ...note, pinned, pinPending: false, pinSynced: { remotePath: note.remotePath!, pinned } }
    })
  }
  return notes
}
