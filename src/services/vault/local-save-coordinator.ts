export type LocalSaveToken = Readonly<{
  generation: number
  noteEpoch: number
  noteId: string
  requestId: number
}>

/**
 * 本地正文保存的轻量状态机。文件写入仍由 App 执行，这里只负责串行顺序和会话代际，
 * 避免旧请求完成后把较新的“保存中”误标为完成，或在切库后回填旧会话状态。
 */
export class LocalSaveCoordinator {
  private generation = 0
  private nextRequestId = 0
  private readonly latestRequestByNote = new Map<string, LocalSaveToken>()
  private readonly noteEpochById = new Map<string, number>()
  private readonly queuesByPath = new Map<string, Promise<void>>()

  begin(noteId: string): LocalSaveToken {
    const token = {
      generation: this.generation,
      noteEpoch: this.noteEpochById.get(noteId) ?? 0,
      noteId,
      requestId: ++this.nextRequestId,
    }
    this.latestRequestByNote.set(noteId, token)
    return token
  }

  enqueue(path: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queuesByPath.get(path) ?? Promise.resolve()
    // 前一次失败不能截断后续正文；后续任务仍会用 App 中保留的最新 revision 再尝试。
    const next = previous.catch(() => undefined).then(task)
    this.queuesByPath.set(path, next)
    const release = () => {
      if (this.queuesByPath.get(path) === next) this.queuesByPath.delete(path)
    }
    void next.then(release, release)
    return next
  }

  isContextCurrent(token: LocalSaveToken): boolean {
    return token.generation === this.generation
      && token.noteEpoch === (this.noteEpochById.get(token.noteId) ?? 0)
  }

  isLatest(token: LocalSaveToken): boolean {
    return this.isContextCurrent(token)
      && this.latestRequestByNote.get(token.noteId)?.requestId === token.requestId
  }

  settle(token: LocalSaveToken): boolean {
    if (!this.isLatest(token)) return false
    this.latestRequestByNote.delete(token.noteId)
    return true
  }

  hasPending(noteId: string): boolean {
    return this.latestRequestByNote.has(noteId)
  }

  cancelNote(noteId: string): void {
    this.latestRequestByNote.delete(noteId)
    this.noteEpochById.set(noteId, (this.noteEpochById.get(noteId) ?? 0) + 1)
  }

  forgetPath(path: string): void {
    this.queuesByPath.delete(path)
  }

  invalidate(): void {
    this.generation += 1
    this.latestRequestByNote.clear()
    this.noteEpochById.clear()
    // 物理写入无法取消，保留路径队列直到自然结束，避免切库后同路径的新旧写入并发。
  }
}
