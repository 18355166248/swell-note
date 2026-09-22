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
  /**
   * 本批已成功写入的附件引用条数。文件已经落在磁盘/远端，引用却没进正文时，
   * 用户要的是「把引用补上」而不是「重新上传一遍」，按钮的出现条件就看它。
   */
  referenceCount: number
  /** 整条重试链中仍未进入正文的引用数。 */
  pendingReferenceCount: number
  /** 本条记录实际已插入的引用数，部分撤销时不能用写入数量代替。 */
  insertedCount: number
  /**
   * 「重新插入引用」正在执行。与 `retrying` 同一套锁：重复点击会让同一批引用
   * 插进正文两次，用户得到两份一模一样的附件参考。
   */
  reinserting?: boolean
  /** 本批失败项正在被重试。面板据此锁住重试按钮：再点一次会把同一个文件传两遍。 */
  retrying?: boolean
  /** 同一条重试链共用剩余失败项，历史批次不能再上传已经恢复成功的文件。 */
  retryableCount?: number
  status: AttachmentQueueBatchStatus
  target: AttachmentQueueTarget
}

/**
 * 正文里一处占位的落点令牌。
 *
 * 队列把它当**不透明值**传递：保存写失败的那些，重试时原样交回 `capture`。它的内部结构
 * 由创建它的编辑器定义——只有编辑器知道这个占位在正文里怎么随编辑映射位置。
 */
export type AttachmentQueueSlot = {
  /** 释放这个落点，不再参与书签映射。 */
  dispose: () => void
}

/** 调用方为一批文件算好的占位位置（下标与 files 对齐，没有占位的项为 null）。 */
export type AttachmentQueueSlotInput = { from: number; text: string } | null

/**
 * 一个文件写完后的落点指令，按本批文件顺序排列。
 * `markdown: null` 表示这个文件写失败了，`reason` 是要就地留下的失败说明。
 */
export type AttachmentQueuePlacement = { markdown: string | null; reason?: string; cancelled?: boolean }

/**
 * 本批某个文件的结果，下标与 batch.items 对齐。
 *
 * `null` 表示**这次没有它的结果**（还没轮到），正文里的占位必须原样留着等重试——
 * 用 `{ markdown: null }` 代表「没有结果」会让占位被就地改写成一句凭空的失败说明。
 */
export type AttachmentQueuePlacementResult = AttachmentQueuePlacement | null

export type AttachmentQueuePlacementOutcome = {
  /** 与输入逐项对应，补插只能重放 unplaced/dropped，不能靠批次汇总猜测。 */
  results: readonly ("inserted" | "unplaced" | "dropped" | null)[]
  /** 成功原位替换的条数。 */
  placed: number
  /** 落点失效的引用文本（没有占位、或占位处的内容已被用户改过）——交由降级追加。 */
  unplaced: string
  /** 占位在正文里已不存在（典型是撤销了这次粘贴）的条数。不追加，只提示可重新插入。 */
  dropped: number
  /**
   * 落点失效时正文里还剩下的占位文字。降级追加前必须把它们从原笔记正文里删掉，
   * 否则「图片写入中…」会永远留在笔记里，而引用已经追加到了末尾。
   */
  leftover: readonly string[]
  /**
   * 与本批下标对齐的落点：已成功替换、或已经失效的下标为 null；因写入失败而**原地变成
   * 失败说明**的那处占位返回它的令牌，交给队列留着等重试复用。
   *
   * 这个区别很关键：写失败但占位还在时，用户重试一次就该把那句失败说明换成引用。
   * 拿不到令牌就只能把引用追加到笔记末尾，正文里那句「图片写入失败」永远留着。
   */
  slots: readonly (AttachmentQueueSlot | null)[]
}

/** 一次插入的落点。 */
export type AttachmentQueueInsertion = {
  /**
   * 释放尚未被取走的落点。已经在 place 里成功替换掉、或已失效的落点在此之前就已释放；
   * 只有**交还给队列等重试**的那些不在此列——它们要活到重试结束，或被记录被移除时。
   */
  dispose: () => void
  /**
   * 一次性把本批每条结果落到各自的占位上：成功的原位换成引用，失败的原地换成失败说明。
   *
   * 不是「每条结果各调一次」：占位替换要落在同一个事务里，撤销一次即可回退整次粘贴，
   * 与改为逐条落笔之前的撤销粒度一致。
   *
   * 传 null 表示这一项这次没有结果（还没轮到）：正文里的占位原样留着，不许动。
   */
  place: (placements: readonly AttachmentQueuePlacementResult[]) => AttachmentQueuePlacementOutcome
}

export type AttachmentQueueInsertions = {
  /**
   * 取「发起时那篇笔记」当前是否还能拿到落点书签。返回 null 表示编辑器已经不在那篇笔记上
   * （切走、卸载、只读），队列必须走 fallback，绝不能改用当前打开的笔记。
   *
   * 每次入队时同步调用（含用户主动重试），排队期间由书签跟踪正文变化。
   * 重试时带上原批次的失败落点（`slots`），让重试成功后引用能替换掉正文里那句失败说明；
   * 拿不到旧落点则退回重新取当前位置，身份不符时明确降级到原笔记末尾。
   */
  capture: (options: {
    retry: boolean
    /** 用户主动补插，重新取当前光标，禁止重用初次占位坐标。 */
    reinsert?: boolean
    /**
     * 原批次里写失败的占位令牌，下标与本次要传的 files 对齐。队列只原样交回，
     * 由当初创建它的编辑器解释（只有它知道这些占位在正文里怎么映射）。
     */
    slots?: readonly (AttachmentQueueSlot | null)[]
  }) => AttachmentQueueInsertion | null
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
   *
   * `leftover` 是降级时正文里还留着的占位文字（落点失效的那些文件对应的「写入中」占位）。
   * 追加前必须把它们删掉，否则笔记里会永远留着「图片写入中…」这句假消息，
   * 而引用已经追加在末尾——用户完全无从判断图片到底进没进来。
   */
  fallback: (target: AttachmentQueueTarget, markdown: string, leftover: readonly string[]) => AttachmentQueueFallbackResult
  /**
   * 真正写盘。每次只传一个文件：串行约束不变，同时让每个文件都有独立状态与可重试边界
   * （底层 writer 的返回是整批聚合的，一次一批就分不出「哪个文件失败了」）。
   */
  write: (target: AttachmentQueueTarget, files: File[]) => Promise<AttachmentWriteResult>
}

// 已结束的批次保留最近几条就好：它们只是「刚才那批成了/失败了」的凭据，
// 攒太多会把编辑器顶下去，也可能让人误以为还有活在跑。
const MAX_SETTLED_BATCHES = 4

type WrittenReference = { markdown: string; pending: boolean }

type BatchRecord = {
  batch: AttachmentQueueBatch
  cancelRequested: boolean
  files: Map<string, File>
  /** 「重新插入引用」正在跑。运行期间重复点击直接拒绝，与 retrying 同一套理由。 */
  reinserting?: boolean
  /** 本批失败项正在执行的那次重试。运行期间不允许再排第二批：否则同一个文件会被传两次。 */
  retrying?: string
  insertions: AttachmentQueueInsertions
  insertion: AttachmentQueueInsertion | null
  /**
   * 写失败项在正文里的占位，按 item.id 存着等重试。
   *
   * 重试成功后引用必须替换掉正文里那句「图片写入失败：…」，否则笔记里会留下一段
   * 与事实相反的过期文字。占位已成功替换的项不在这里。
   */
  reuse: Map<string, AttachmentQueueSlot>
  /** 落点失效时正文里还剩的占位文字，交给降级在追加前清掉。 */
  leftover: readonly string[]
  settled: boolean
  /** 所有层级的重试都直接指回首批；文件结果与锁只能有一个所有者。 */
  retrySource?: BatchRecord
  retryItems?: AttachmentQueueItem[]
  /** 本批已成功写入的附件引用（按写入顺序），供「重新插入引用」与「复制引用」使用。 */
  written: WrittenReference[]
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
      // 重试链上的记录共用源批次的已写入引用与锁：任何一环上补插都算这一批的恢复动作。
      referenceCount: (record.retrySource ?? record).written.length,
      pendingReferenceCount: (record.retrySource ?? record).written.filter((reference) => reference.pending).length,
      insertedCount: record.written.filter((reference) => !reference.pending).length,
      reinserting: (record.retrySource ?? record).reinserting ?? false,
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
      removeRecord(record)
    }
  }

  function removeRecord(record: BatchRecord) {
    records.splice(records.indexOf(record), 1)
    const source = record.retrySource ?? record
    if (record !== source) releaseSlots(record)
    // 根记录移出面板后仍可能被历史重试行引用，最后一个入口消失时才释放根书签。
    if (!records.some((candidate) => (candidate.retrySource ?? candidate) === source)) releaseSlots(source)
  }

  function canDismiss(record: BatchRecord) {
    return isSettled(record.batch.status) && !(record.retrySource ?? record).retrying && !(record.retrySource ?? record).reinserting
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
      if (record.written.length > 0) source.written = [...source.written, ...record.written]
      source.leftover = [...source.leftover, ...record.leftover]
      record.retryItems?.forEach((item, index) => {
        const result = record.batch.items[index]
        if (result.status === "done") {
          item.status = "done"
          item.retried = true
          item.error = undefined
        } else if (result.status === "failed") {
          item.error = result.error
        }
        // 落点按**原始失败项**的 id 归还，不能整份替成重试批次的表：那张表用的是重试批次
        // 自己的 item id，下一次重试按原批次 id 去查会全部落空——正文里那句失败说明
        // 就再也换不成引用了。写成功或落点已失效的项从表里删掉，剩下的继续等下一次重试。
        const slot = record.reuse.get(result.id) ?? null
        if (slot) source.reuse.set(item.id, slot)
        else source.reuse.delete(item.id)
      })
      // 令牌的所有权移交根记录，清除子记录的别名，避免关闭历史行时把仍需重试的书签释放掉。
      record.reuse.clear()
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

    // 每条结果按 batch.items 顺序收集：落笔时下标要与占位一一对应，否则引用会填到
    // 别的图片位置上，比顺序错乱更难排查。已在早期批次写过的项（重试链）跳过，
    // 它们的引用早已落笔，这里不能再填一次——那一格留 null，编辑器不会去动它的占位。
    const placements: AttachmentQueuePlacementResult[] = new Array(batch.items.length).fill(null)
    const settled: AttachmentQueuePlacement[] = []
    for (const [index, item] of batch.items.entries()) {
      if (item.status === "cancelled") {
        placements[index] = { markdown: null, cancelled: true }
        continue
      }
      if (item.status !== "waiting") continue
      if (record.cancelRequested) {
        item.status = "cancelled"
        placements[index] = { markdown: null, cancelled: true }
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
          placements[index] = { markdown: null, reason: item.error }
        } else {
          item.status = "done"
          const reference = markdown.trimEnd()
          // 文件写成了，引用就必须落进正文：文件已经在磁盘/远端，丢掉引用等于让用户白传一次。
          placements[index] = { markdown: reference || null }
          if (reference) settled.push(placements[index])
        }
      } catch (error) {
        item.status = "failed"
        item.error = error instanceof Error ? error.message : "写入附件失败"
        placements[index] = { markdown: null, reason: item.error }
      }
      emit()
    }

    // 落笔在所有文件写完之后统一做一次，但**不是**「有成功项才做」：一个都没写成时，
    // 正文里的占位还停在「图片写入中…」，必须就地换成失败说明，否则那句话会永远挂着。
    //
    // 插入结果单独记在 batch.insertion 上，绝不与「文件写了几个」混为一谈：文件写成功而
    // 引用进不去正文时，用户拿到的是用不上的附件，这个事实不能被「已写入 N 个」盖掉。
    const outcome = applyPlacements(record, placements)
    record.reuse = failedSlots(record, outcome)
    record.leftover = outcome.leftover
    const references = placements.map((placement) => placement?.markdown
      ? { markdown: placement.markdown, pending: true } : null)
    record.written = references.filter((reference): reference is WrittenReference => reference !== null)
    if (settled.length > 0) {
      applyInsertionResult(record, outcome, references)
    } else if (outcome.leftover.length) {
      cleanupCancelledPlaceholders(record, outcome.leftover)
    } else if (batch.items.some((item) => item.status === "failed")) {
      // 全批失败：占位已就地从「写入中…」改成失败原因，正文里没有过期的假消息。
      if (!batch.items.some((item) => item.status === "cancelled")) {
        appendNotice(batch, "写入失败，正文中的图片占位已标为失败")
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
      // 收尾说明只有在一条都没写出来时才需要补：applyInsertionResult 已经把「为什么没进去」讲清楚了。
      if (batch.notice === undefined && batch.insertion === "failed") {
        batch.notice = "附件已写入，但正文引用未插入"
      }
    }
    settle(record)
  }

  /** 把这一批的每条结果落到各自占位上。任何异常都按「一条都没落成」处理，交由降级收尾。 */
  function applyPlacements(
    record: BatchRecord,
    placements: readonly AttachmentQueuePlacementResult[],
  ): AttachmentQueuePlacementOutcome {
    const unwritten = placements.filter((placement): placement is AttachmentQueuePlacement =>
      Boolean(placement?.markdown))
    const empty: AttachmentQueuePlacementOutcome = { results: placements.map((placement) => placement?.markdown ? "unplaced" : null), dropped: 0, leftover: [], placed: 0, slots: [], unplaced: "" }
    if (!record.insertion) {
      // 没有书签（切走了、只读、笔记对不上）：所有写成功的引用都要走降级追加，
      // 正文里若还留着占位，也要交给降级一并清理（此时不知道具体残留，按空处理）。
      return { ...empty, unplaced: aggregate(unwritten) }
    }
    try {
      return record.insertion.place(placements)
    } catch {
      return { ...empty, unplaced: aggregate(unwritten) }
    }
  }

  /**
   * 收尾：把落笔结果如实记成 batch 的插入状态与说明。
   *
   * 三种结果必须分开讲，不能压成一句「已插入」：
   * - 全部原位替换 → inserted；
   * - 有落点失效 → 降级追加，追加成功 appended、失败 failed；
   * - 占位已被撤销 → 不追加（往笔记末尾硬塞用户删掉的内容更糟），提示可重新插入引用。
   */
  function applyInsertionResult(record: BatchRecord, outcome: AttachmentQueuePlacementOutcome, references: readonly (WrittenReference | null)[]) {
    const { batch } = record
    const notes: string[] = []
    let appended = false
    if (outcome.unplaced) {
      // 「已原位插入 N 个」只在这一批有别的下场时才说：全部原位成功时面板标题已经写着
      // 「已插入 N 个附件」，再重复一句只会把真正的收尾说明挤到后面。
      if (outcome.placed > 0) notes.push(`已原位插入 ${outcome.placed} 个附件`)
      try {
        // 降级追加时把残留占位一并清掉：否则笔记里永远留着「图片写入中…」这句假消息。
        const result = fallback(batch.target, outcome.unplaced, outcome.leftover)
        appended = result.placed
        if (appended) record.leftover = []
        batch.insertion = result.placed ? "appended" : "failed"
        if (result.notice) notes.push(result.notice)
      } catch (error) {
        batch.insertion = "failed"
        notes.push(error instanceof Error ? error.message : "附件已写入，但正文引用插入失败")
      }
      if (outcome.dropped > 0) notes.unshift(`${outcome.dropped} 个附件的占位已不存在（可能撤销了这次粘贴），未插入`)
    } else if (outcome.placed > 0) {
      batch.insertion = "inserted"
      if (outcome.dropped > 0) {
        notes.push(`已原位插入 ${outcome.placed} 个附件`, `${outcome.dropped} 个附件的占位已不存在（可能撤销了这次粘贴），未插入`)
      }
    } else if (outcome.dropped > 0) {
      // 占位已被撤销：不往笔记末尾硬塞用户删掉的内容，改为提示可重新插入。
      batch.insertion = "failed"
      notes.push("附件已写入，但正文中的占位已不存在，可点「重新插入引用」补上")
    } else {
      batch.insertion = "failed"
      notes.push("附件已写入，但正文引用未插入")
    }
    references.forEach((reference, index) => {
      if (!reference) return
      const result = outcome.results[index]
      reference.pending = result !== "inserted" && !(result === "unplaced" && appended)
    })
    // 部分占位被撤销时仍有待恢复引用，不能因为另一些成功就把整批报成全部插入。
    if (references.some((reference) => reference?.pending)) batch.insertion = "failed"
    appendNotice(batch, notes.join("；"))
  }

  /** 与本批下标对齐的落点，成功项清空——只有写失败的那些需要留着等重试。 */
  function failedSlots(record: BatchRecord, outcome: AttachmentQueuePlacementOutcome) {
    const slots = new Map<string, AttachmentQueueSlot>()
    outcome.slots.forEach((slot, index) => {
      const item = record.batch.items[index]
      if (slot && (item?.status === "failed" || (item?.status === "cancelled" && record.retrySource))) slots.set(item.id, slot)
    })
    return slots
  }

  function cleanupCancelledPlaceholders(record: BatchRecord, leftover: readonly string[]) {
    try {
      // 切走编辑器时只清理原笔记的取消占位，不追加空附件。切库/删除仍由 fallback 拒绝。
      const result = fallback(record.batch.target, "", leftover)
      if (!result.placed) appendNotice(record.batch, "已取消，原笔记占位未能清理")
    } catch { appendNotice(record.batch, "已取消，原笔记占位未能清理") }
  }

  function cancelQueuedPlacements(record: BatchRecord) {
    // 等待中的批次不会进入 runBatch，也必须把正文的“写入中”占位收尾。
    const outcome = applyPlacements(record, record.batch.items.map(() => ({ markdown: null, cancelled: true })))
    if (outcome.leftover.length) cleanupCancelledPlaceholders(record, outcome.leftover)
    // 取消重试后原失败项仍可重试，保留更新后的占位令牌。
    outcome.slots.forEach((slot, index) => { if (slot && record.retrySource) record.reuse.set(record.batch.items[index].id, slot) })
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
      referenceCount: 0,
      pendingReferenceCount: 0,
      insertedCount: 0,
      status: "queued",
      target: input.target,
    }
    const record: BatchRecord = {
      batch,
      cancelRequested: false,
      files: new Map(input.files.map((file, index) => [batch.items[index].id, file])),
      insertions: input.insertions,
      insertion: null,
      leftover: [],
      reuse: new Map(),
      settled: false,
      retrySource: retry?.source,
      retryItems: retry?.items,
      written: [],
    }
    // 先锁定，再捕获书签/通知订阅者/启动写入，防止重入时同一个失败项被再次排队。
    if (retry) retry.source.retrying = batch.id
    // 重试带上原批次的失败占位：重试成功后引用要替换掉正文里那句「图片写入失败：…」，
    // 而不是把新引用追加到末尾、把过期说明留在原地。取不到就退回重新取当前位置。
    const retrySlots = retry ? retry.items.map((item) => retry.source.reuse.get(item.id) ?? null) : undefined
    try { record.insertion = input.insertions.capture({ retry: Boolean(retry), slots: retrySlots }) } catch { /* 无法取得书签时走原笔记追加。 */ }
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
      if (!isSettled(record.batch.status) || record.retrying || record.reinserting) return null
      const failed = record.batch.items.filter((item) => item.status === "failed")
      const files = failed
        .map((item) => record.files.get(item.id))
        .filter((file): file is File => Boolean(file))
      if (files.length === 0) return null
      // 不清空 record.reuse：失败占位就在里面，清掉等于让重试成功后的引用追加到笔记末尾、
      // 而正文里那句「图片写入失败：…」永远留着。重试批次的 place 会用掉它们，
      // 仍在失败的项由 settle 把令牌原样交回这里。
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
        cancelQueuedPlacements(record)
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
          cancelQueuedPlacements(record)
          settle(record)
          return true
        }
      }
      emit()
      return true
    },
    /**
     * 本批已写入附件的引用文本（Markdown，按写入顺序拼接）；没有则空串。
     * 用于「复制引用」：文件已经在磁盘/远端了，再传一遍纯属浪费。
     */
    references(batchId: string): string {
      const record = findRecord(batchId)
      const source = record?.retrySource ?? record
      if (!source || source.written.length === 0) return ""
      return aggregate(source.written)
    },
    /**
     * 把已写入、却没进正文的引用补插一次。这是「文件写了但引用没落进正文」唯一的恢复入口，
     * 免去用户为了补一条引用重新上传一遍附件。
     *
     * 三条硬约束：
     * - 只在批次已结束时受理（进行中的批次自己会写入，插两次就是两份引用）；
     * - 同一时间只受理一次（`reinserting`），否则连点两下正文里多出一份重复引用；
     * - 无论成败都**原地更新**这一批的 insertion 与 notice，不新开记录——
     *   用户看到的是同一批附件的状态变化，而不是凭空多出一条来路不明的记录。
     *
     * 返回值只表示「受不受理」，落笔结果一律由 notice 如实汇报。
     */
    reinsert(batchId: string): boolean {
      const record = findRecord(batchId)
      if (!record) return false
      const source = record.retrySource ?? record
      if (!isSettled(source.batch.status) || source.reinserting || source.retrying) return false
      const pending = source.written.filter((reference) => reference.pending)
      if (pending.length === 0) return false
      source.reinserting = true
      // 本次恢复重新产生结论，成功后不能继续显示上一轮“引用未插入”的旧原因。
      source.batch.notice = undefined
      emit()
      try {
        // 当场重新取一次落点：首次那个早在 settle 里释放了，而用户此刻多半正开着这篇笔记，
        // 引用插在他当前的光标处远比默默追加到末尾有用。
        //
        // 身份仍由 capture 自己把关（那份 capture 闭包记的是**发起时**那篇笔记的会话标识）：
        // 用户已经切走就返回 null，于是走下面的降级追加——绝不因为「现在开着哪篇」而插错笔记。
        // 原笔记里仍有待清理占位时，走一次原子清理＋追加；不能只在当前光标另插一份。
        source.insertion = source.leftover.length ? null : source.insertions.capture({ retry: false, reinsert: true })
        const outcome = applyPlacements(source, pending)
        if (source.leftover.length) outcome.leftover = source.leftover
        applyInsertionResult(source, outcome, pending)
      } catch (error) {
        source.batch.insertion = "failed"
        appendNotice(source.batch, error instanceof Error ? error.message : "附件已写入，但正文引用插入失败")
      } finally {
        source.reinserting = false
        // 补插的落点是当场取的，用完即弃；失败占位与重试无关，不动 source.reuse。
        try { source.insertion?.dispose() } catch { /* 释放失败不应阻断收尾。 */ }
        source.insertion = null
        // 同一条重试链共享恢复结果，旧重试记录不能继续提供已完成的补插操作。
        for (const candidate of records) if (candidate.retrySource === source) {
          candidate.batch.insertion = source.batch.insertion
          candidate.batch.notice = source.batch.notice
        }
        emit()
      }
      return true
    },
    /** 从面板上撤掉一条已结束的记录；进行中的批次不允许这样清掉，必须走 cancel。 */
    dismiss(batchId: string) {
      const index = records.findIndex((candidate) => candidate.batch.id === batchId && canDismiss(candidate))
      if (index < 0) return false
      removeRecord(records[index])
      emit()
      return true
    },
    clearSettled() {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (canDismiss(records[index])) {
          removeRecord(records[index])
        }
      }
      emit()
    },
  }
}

/**
 * 记录被移出队列时释放它留着的失败占位。
 *
 * 不释放也能用，但书签会一直挂在编辑器的映射表里，随每次文档变化重算位置——
 * 一条已经没人在管的记录不该持续付这份开销。
 */
function releaseSlots(record: BatchRecord) {
  for (const slot of record.reuse.values()) {
    try { slot.dispose() } catch { /* 释放失败不应阻断移除。 */ }
  }
  record.reuse.clear()
}

export type AttachmentQueue = ReturnType<typeof createAttachmentQueue>

/**
 * 把一批写成功的引用拼成一段 Markdown，用于**无法原位落笔**时的降级追加。
 *
 * 这是唯一还保留「聚合」的地方：降级是把整段内容追加到原笔记末尾，
 * 本来就只有一个落点，逐条追加只会多出几次正文写入。
 */
function aggregate(placements: readonly AttachmentQueuePlacement[]): string {
  const snippets = placements
    .map((placement) => placement.markdown?.trimEnd() ?? "")
    .filter(Boolean)
  return snippets.length > 0 ? `${snippets.join("\n\n")}\n` : ""
}

function isSettled(status: AttachmentQueueBatchStatus) {
  return status === "cancelled" || status === "done" || status === "failed"
}

/**
 * 收尾说明一律**追加**，不覆盖。
 *
 * 记录在创建时就可能带着说明（「已重试：只重传失败的 N 个文件」），收尾时若直接赋值，
 * 这句话就没了——用户只看到「已原位插入 1 个附件」，看不出这一批是重试来的。
 */
function appendNotice(batch: AttachmentQueueBatch, note: string) {
  if (!note) return
  batch.notice = batch.notice ? `${batch.notice}；${note}` : note
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
