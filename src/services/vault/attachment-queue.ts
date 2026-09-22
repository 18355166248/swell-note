import type { AttachmentWriteResult } from "./attachment-writer"

/**
 * 附件插入队列。
 *
 * 在此之前，连续两批附件是「忙则拒绝」：第二批被明确提示后由用户自己重试。用户视角里
 * 这就是「拖了两次只进去一批」，而且写入期间会出现一个既不是等待、也不是失败的黑洞。
 * 这里换成真正的队列：批次按发起顺序串行写入，每一个文件都有可见状态，
 * 等待中的可以取消，失败的可以只重试失败项。
 *
 * 四条硬约束贯穿全文件：
 *
 * 1. **进度必须真实。** 底层写盘（arrayBuffer + createBinaryFile）没有字节进度回调，
 *    因此这里只暴露「第几个文件 / 共几个」与每个文件的状态，绝不算一个假百分比。
 * 2. **任务绑定发起现场。** 目标笔记与插入锚点都在 enqueue 那一刻固定，写入与落笔一律按
 *    它们走，绝不读「当前打开的笔记」——中途切笔记、重命名、切库都不该把结果写到别处。
 * 3. **已写入的文件一定要把引用落进正文。** 文件已经在磁盘/远端了，丢掉引用等于让用户白传
 *    一次；部分失败只重试失败项，绝不重新上传或重复插入已经成功的项。
 * 4. **不假装成功。** 底层写盘没有取消信号，取消运行中的批次只能停止「后续文件」；当前这个
 *    会写完并如实标成已写入。取消的批次里若已有文件写进去了，引用照样插入，并明说这一点。
 */

/**
 * 发起时的目标笔记。完成后一律按它落笔，不再回头看当前打开的是哪一篇。
 *
 * 身份用 `editorSessionKey` 而不是 `noteId`：重命名会换掉 id 与路径，但编辑会话标识不变，
 * 因此「写入期间用户把笔记改了名」应当继续算同一篇笔记，而不是被误判成「原笔记不见了」。
 * `noteId` 只作为重命名之前的兜底查找键。
 */
export type AttachmentQueueTarget = {
  /** 发起时所在的笔记库。库切换后拒绝写入：旧路径配新适配器会落到错误位置。 */
  cacheId: string | null
  editorSessionKey: string
  noteId: string
  noteTitle: string
}

export type AttachmentQueueItemStatus = "waiting" | "writing" | "done" | "failed" | "cancelled"

export type AttachmentQueueItem = {
  error?: string
  id: string
  name: string
  size: number
  status: AttachmentQueueItemStatus
  /**
   * 这一项曾经失败、后来由重试写成功。面板据此说明它为什么从失败变成了已写入，
   * 也让「这条记录当初确实失败过」不至于被抹掉。
   */
  retried?: boolean
}

export type AttachmentQueueBatchStatus = "queued" | "writing" | "done" | "failed" | "cancelled"

/**
 * 正文插入的结果。文件写入与正文插入是两件事，必须分开记录：
 * 文件已经落在磁盘/远端、引用却没进正文时，用户得到的是一份「传了但用不上」的附件，
 * 这个事实不能被「已写入 N 个」盖过去。
 */
export type AttachmentQueueInsertionStatus =
  /** 还没有文件写完，没有引用需要插入。 */
  | "none"
  /** 引用已插入发起时那篇笔记的正文。 */
  | "inserted"
  /** 锚点失效，走降级追加到原笔记末尾。 */
  | "appended"
  /** 写入成功但引用没能进正文（原笔记已删除、降级也失败）。 */
  | "failed"

export type AttachmentQueueBatch = {
  createdAt: number
  id: string
  items: AttachmentQueueItem[]
  /** 正文插入结果，与 item 的文件写入结果独立。 */
  insertion: AttachmentQueueInsertionStatus
  /** 需要额外解释的收尾说明（降级落点、取消、只重试了失败项…），面板直接展示。 */
  notice?: string
  /** 本批失败项正在被重试。面板据此锁住重试按钮：再点一次会把同一个文件传两遍。 */
  retrying?: boolean
  /** 同一条重试链共用剩余失败项，历史批次不能再上传已经恢复成功的文件。 */
  retryableCount?: number
  status: AttachmentQueueBatchStatus
  target: AttachmentQueueTarget
}

/** 一次插入的落点。insert 返回 false 表示锚点已失效，由队列改走降级。 */
export type AttachmentQueueInsertion = {
  dispose: () => void
  insert: (markdown: string) => boolean
}

export type AttachmentQueueInsertions = {
  /**
   * 取「发起时那篇笔记」当前是否还能拿到落点书签。返回 null 表示编辑器已经不在那篇笔记上
   * （切走、卸载、只读），队列必须走 fallback，绝不能改用当前打开的笔记。
   *
   * 每次入队时同步调用（含用户主动重试），排队期间由书签跟踪正文变化。
   * 重试重新取发起笔记的当前位置；身份不符则返回 null，明确降级到原笔记末尾。
   */
  capture: (options: { retry: boolean }) => AttachmentQueueInsertion | null
}

export type AttachmentQueueFallbackResult = {
  /**
   * 降级是否真的把引用写进了正文。false 表示「附件写了但正文引用没插进去」，
   * 队列会据此把它记成插入失败——这个区别必须由调用方如实汇报，不能靠字符串猜。
   */
  placed: boolean
  /** 给用户看的说明：降级落点，或为什么没能落笔。 */
  notice: string
}

export type AttachmentQueueOptions = {
  /**
   * 写入失败/降级落点的兜底：把引用追加到**原笔记**末尾，并说明结果。
   * 原笔记已被删除时不得复活它，此时必须返回 `placed: false` 并讲清楚「附件写了但没进正文」。
   */
  fallback: (target: AttachmentQueueTarget, markdown: string) => AttachmentQueueFallbackResult
  /**
   * 真正写盘。每次只传一个文件：串行约束不变，同时让每个文件都有独立状态与可重试边界
   * （底层 writer 的返回是整批聚合的，一次一批就分不出「哪个文件失败了」）。
   */
  write: (target: AttachmentQueueTarget, files: File[]) => Promise<AttachmentWriteResult>
}

// 已结束的批次保留最近几条就好：它们只是「刚才那批成了/失败了」的凭据，
// 攒太多会把编辑器顶下去，也可能让人误以为还有活在跑。
const MAX_SETTLED_BATCHES = 4

type BatchRecord = {
  batch: AttachmentQueueBatch
  cancelRequested: boolean
  files: Map<string, File>
  /** 本批失败项正在执行的那次重试。运行期间不允许再排第二批：否则同一个文件会被传两次。 */
  retrying?: string
  insertions: AttachmentQueueInsertions
  insertion: AttachmentQueueInsertion | null
  settled: boolean
  /** 所有层级的重试都直接指回首批；文件结果与锁只能有一个所有者。 */
  retrySource?: BatchRecord
  retryItems?: AttachmentQueueItem[]
}

export function createAttachmentQueue({ fallback, write }: AttachmentQueueOptions) {
  const records: BatchRecord[] = []
  const listeners = new Set<() => void>()
  let sequence = 0
  let draining = false
  let snapshot: AttachmentQueueBatch[] = []

  // 快照必须是全新对象，React 才认得出状态变了；内部记录本身按引用原地更新。
  function emit() {
    snapshot = records.map((record) => ({
      ...record.batch,
      items: record.batch.items.map((item) => ({ ...item })),
      retrying: (record.retrySource ?? record).retrying !== undefined,
      retryableCount: (record.retrySource ?? record).batch.items.filter((item) => item.status === "failed").length,
      target: { ...record.batch.target },
    }))
    for (const listener of listeners) listener()
  }

  // 只在新批次进来时裁一次，不用每次状态变化都重算已结束批次。
  function trimSettled() {
    const settled = records.filter(canDismiss)
    for (const record of settled.slice(0, Math.max(0, settled.length - MAX_SETTLED_BATCHES))) {
      records.splice(records.indexOf(record), 1)
    }
  }

  function canDismiss(record: BatchRecord) {
    return isSettled(record.batch.status) && !(record.retrySource ?? record).retrying
  }

  // 成功、失败和等待中取消都必须收尾一次：既释放入队时捕获的书签，也释放整条重试链的锁。
  // 取消的重试项仍是原始失败项，不伪装成已恢复，用户之后可重新发起。
  function settle(record: BatchRecord) {
    if (record.settled) return
    record.settled = true
    try { record.insertion?.dispose() } catch { /* 释放失败不应阻断队列收尾。 */ }
    record.insertion = null
    const source = record.retrySource
    if (source) {
      if (source.retrying === record.batch.id) source.retrying = undefined
      record.retryItems?.forEach((item, index) => {
        const result = record.batch.items[index]
        if (result.status === "done") {
          item.status = "done"
          item.retried = true
          item.error = undefined
        } else if (result.status === "failed") {
          item.error = result.error
        }
      })
      // 一部分文件之前已写入但引用失败时，后续重试成功不能把整批改报成插入成功。
      if (record.batch.insertion === "failed") {
        source.batch.insertion = "failed"
        source.batch.notice = record.batch.notice
      } else if (source.batch.insertion !== "failed" && record.batch.insertion !== "none") {
        source.batch.insertion = source.batch.insertion === "appended" ? "appended" : record.batch.insertion
        source.batch.notice = record.batch.notice
      }
      source.batch.status = source.batch.items.some((item) => item.status === "failed") ? "failed"
        : source.batch.items.some((item) => item.status === "cancelled") ? "cancelled" : "done"
    }
    emit()
  }

  async function runBatch(record: BatchRecord) {
    const { batch } = record
    batch.status = "writing"
    emit()

    const insertion = record.insertion

    const snippets: string[] = []
    for (const item of batch.items) {
      if (item.status !== "waiting") continue
      if (record.cancelRequested) {
        item.status = "cancelled"
        emit()
        continue
      }
      item.status = "writing"
      emit()
      const file = record.files.get(item.id)
      try {
        const { errors, markdown } = await write(batch.target, file ? [file] : [])
        if (errors.length > 0) {
          item.status = "failed"
          item.error = errors.join("；")
        } else {
          item.status = "done"
          if (markdown) snippets.push(markdown.trimEnd())
        }
      } catch (error) {
        item.status = "failed"
        item.error = error instanceof Error ? error.message : "写入附件失败"
      }
      emit()
    }

    // 只要写成功过就把引用落进正文：文件已经在磁盘/远端，丢掉引用等于让用户白传一次。
    // 因此这条对「部分失败」与「写入中途取消」同样成立——已写入的照插，只有没写的才跳过。
    //
    // 插入结果单独记在 batch.insertion 上，绝不与「文件写了几个」混为一谈：文件写成功而
    // 引用进不去正文时，用户拿到的是用不上的附件，这个事实不能被「已写入 N 个」盖掉。
    if (snippets.length > 0) {
      const markdown = `${snippets.join("\n\n")}\n`
      let placed = false
      if (insertion) {
        try {
          placed = insertion.insert(markdown)
        } catch {
          placed = false
        }
      }
      if (placed) {
        batch.insertion = "inserted"
      } else {
        try {
          const result = fallback(batch.target, markdown)
          batch.insertion = result.placed ? "appended" : "failed"
          batch.notice = result.notice
        } catch (error) {
          batch.insertion = "failed"
          batch.notice = error instanceof Error ? error.message : "附件已写入，但正文引用插入失败"
        }
      }
    }
    const failed = batch.items.filter((item) => item.status === "failed").length
    if (record.cancelRequested) {
      batch.status = "cancelled"
      const written = batch.items.filter((item) => item.status === "done").length
      // 取消说明只是补充，不能覆盖插入失败的真实原因：那句「引用未插入」比取消本身重得多。
      batch.notice = cancellationNotice(batch.insertion, written) ?? batch.notice ?? undefined
    } else {
      batch.status = failed > 0 ? "failed" : "done"
      // 正常结束也可能「文件写了、引用没进正文」。状态位仍是 done/failed（那是文件维度的事实），
      // 但必须留下一句说明，否则面板会照着 done 数宣称插入成功。
      if (batch.notice === undefined && batch.insertion === "failed") {
        batch.notice = "附件已写入，但正文引用未插入"
      }
    }
    settle(record)
  }

  async function drain() {
    if (draining) return
    draining = true
    try {
      for (;;) {
        const record = records.find((candidate) => candidate.batch.status === "queued")
        if (!record) break
        await runBatch(record)
      }
    } finally {
      draining = false
    }
  }

  function findRecord(batchId: string) {
    return records.find((candidate) => candidate.batch.id === batchId)
  }

  function enqueue(
    input: { files: File[]; insertions: AttachmentQueueInsertions; target: AttachmentQueueTarget },
    retry?: { source: BatchRecord; items: AttachmentQueueItem[] },
  ) {
    if (input.files.length === 0) return null
    const batch: AttachmentQueueBatch = {
      createdAt: Date.now(),
      id: `attachment-batch-${(sequence += 1)}`,
      items: input.files.map((file) => ({
        id: `attachment-item-${(sequence += 1)}`,
        name: file.name || "附件",
        size: file.size,
        status: "waiting",
      })),
      insertion: "none",
      notice: retry ? `已重试：只重传失败的 ${input.files.length} 个文件，已成功的不再上传` : undefined,
      status: "queued",
      target: input.target,
    }
    const record: BatchRecord = {
      batch,
      cancelRequested: false,
      files: new Map(input.files.map((file, index) => [batch.items[index].id, file])),
      insertions: input.insertions,
      insertion: null,
      settled: false,
      retrySource: retry?.source,
      retryItems: retry?.items,
    }
    // 先锁定，再捕获书签/通知订阅者/启动写入，防止重入时同一个失败项被再次排队。
    if (retry) retry.source.retrying = batch.id
    try { record.insertion = input.insertions.capture({ retry: Boolean(retry) }) } catch { /* 无法取得书签时走原笔记追加。 */ }
    records.push(record)
    trimSettled()
    emit()
    void drain()
    return batch.id
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot() {
      return snapshot
    },
    enqueue: (input: Parameters<typeof enqueue>[0]) => enqueue(input),
    /**
     * 只把失败项重新排队。已成功的文件不重传，正文里那条引用也不会出现第二次——
     * 这是「部分成功」唯一正确的收尾方式，否则用户要么白传一遍，要么得到两张同一张图。
     *
     * 重试不是「再开一批就完事」，原记录必须跟着一起变：
     * - 运行期间重复点击直接拒绝（`retrying` 已经指向那一批），否则同一个文件会被传两次、
     *   正文里出现两份引用，而失败项自己永远停在失败上，按钮一直是亮的；
     * - 重试成功后把原失败项就地改成已写入，重试按钮随之消失，原记录才真正收尾。
     */
    retry(batchId: string) {
      const requested = findRecord(batchId)
      if (!requested) return null
      const record = requested.retrySource ?? requested
      // 从任意历史批次点击都回到同一份原始失败项，不产生“重试的重试”独立状态树。
      if (!isSettled(record.batch.status) || record.retrying) return null
      const failed = record.batch.items.filter((item) => item.status === "failed")
      const files = failed
        .map((item) => record.files.get(item.id))
        .filter((file): file is File => Boolean(file))
      if (files.length === 0) return null
      return enqueue({ files, insertions: record.insertions, target: record.batch.target }, { source: record, items: failed })
    },
    /**
     * 取消。底层写盘没有取消信号（arrayBuffer 与远端 PUT 都不可中断），因此运行中的批次
     * 只能停止「后续文件」：当前这个文件会写完并如实标成已写入，绝不把整批假装成没发生过。
     * 还在等待的批次可以干净地整批取消。
     */
    cancel(batchId: string) {
      const record = findRecord(batchId)
      if (!record) return false
      if (isSettled(record.batch.status)) return false
      record.cancelRequested = true
      for (const item of record.batch.items) if (item.status === "waiting") item.status = "cancelled"
      if (record.batch.status === "queued") {
        record.batch.status = "cancelled"
        record.batch.notice = "已取消，未写入任何附件"
        settle(record)
        return true
      }
      emit()
      return true
    },
    /** 取消单个还没开始写的文件；已经在写的那个不受影响，交给整批取消处理。 */
    cancelItem(batchId: string, itemId: string) {
      const record = findRecord(batchId)
      if (!record || isSettled(record.batch.status)) return false
      const item = record.batch.items.find((candidate) => candidate.id === itemId)
      if (!item || item.status !== "waiting") return false
      item.status = "cancelled"
      if (record.batch.items.every((candidate) => candidate.status === "cancelled")) {
        record.cancelRequested = true
        if (record.batch.status === "queued") {
          record.batch.status = "cancelled"
          record.batch.notice = "已取消，未写入任何附件"
          settle(record)
          return true
        }
      }
      emit()
      return true
    },
    /** 从面板上撤掉一条已结束的记录；进行中的批次不允许这样清掉，必须走 cancel。 */
    dismiss(batchId: string) {
      const index = records.findIndex((candidate) => candidate.batch.id === batchId && canDismiss(candidate))
      if (index < 0) return false
      records.splice(index, 1)
      emit()
      return true
    },
    clearSettled() {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (canDismiss(records[index])) records.splice(index, 1)
      }
      emit()
    },
  }
}

export type AttachmentQueue = ReturnType<typeof createAttachmentQueue>

function isSettled(status: AttachmentQueueBatchStatus) {
  return status === "cancelled" || status === "done" || status === "failed"
}

/**
 * 取消后的收尾说明。返回 null 表示「不要动已有说明」——插入失败的原因必须原样留着：
 * 把「引用没能进正文」改写成「已写入的附件仍插入了正文」是在把失败报成成功。
 */
function cancellationNotice(insertion: AttachmentQueueInsertionStatus, written: number): string | null {
  if (written === 0) return "已取消，未写入任何附件"
  if (insertion === "failed") return null
  const suffix = insertion === "appended" ? "追加到了笔记末尾" : "仍插入了正文"
  return `已取消：当前文件已写完，${written} 个已写入的附件${suffix}`
}
