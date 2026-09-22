// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

import {
  createAttachmentQueue,
  type AttachmentQueueInsertions,
  type AttachmentQueuePlacementResult,
  type AttachmentQueueSlot,
  type AttachmentQueueTarget,
} from "./attachment-queue"

/**
 * 队列的行为几乎全在「异步归属」上：谁写、写到哪、失败了重试谁、取消之后还剩什么。
 * 因此这里的 write 大多是可控的 deferred，用来把并发与中断的时刻钉死，
 * 而不是让它跑完再看结果——跑完再看就没法区分「串行」和「恰好也串行」。
 */

const targetA: AttachmentQueueTarget = {
  cacheId: "cache-1",
  editorSessionKey: "session-a",
  noteId: "note-a",
  noteTitle: "甲笔记",
}
const targetB: AttachmentQueueTarget = { ...targetA, editorSessionKey: "session-b", noteId: "note-b", noteTitle: "乙笔记" }

function file(name: string, size = 10) {
  return new File([new Uint8Array(size)], name, { type: "image/png" })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, reject, resolve }
}

/** 等到断言条件成立；比 sleep 固定时长更能反映「队列真的推进了」。 */
async function until(predicate: () => boolean, label = "队列状态") {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`等待超时：${label}`)
}

/** 记录每次写入的落点与文件名，并按顺序返回结果。 */
function recordingWriter(results: (files: File[]) => { errors?: string[]; markdown?: string }) {
  const calls: { files: string[]; target: AttachmentQueueTarget }[] = []
  return {
    calls,
    write: async (target: AttachmentQueueTarget, files: File[]) => {
      calls.push({ files: files.map((item) => item.name), target: { ...target } })
      const { errors = [], markdown = files.map((item) => `![${item.name}](attachments/${item.name})`).join("\n\n") } = results(files)
      return { errors, markdown }
    },
  }
}

/**
 * 没有占位（拖入、文件选择器）时的落点桩：把整批成功项**聚合一次**落笔，
 * 与编辑器里 `insert` 那条路径同形，方便沿用「插入了什么」的断言。
 *
 * 有占位的逐条替换不在这一层验证——那是编辑器的职责，队列只负责按顺序把结果递过去。
 */
function aggregatePlacements(placements: readonly AttachmentQueuePlacementResult[]) {
  const snippets = placements.map((placement) => placement?.markdown?.trimEnd() ?? "").filter(Boolean)
  return snippets.length > 0 ? `${snippets.join("\n\n")}\n` : ""
}

function fakeInsertion() {
  const inserted: string[] = []
  let disposed = false
  const insertions: AttachmentQueueInsertions = {
    capture: () => ({
      dispose: () => { disposed = true },
      place: (placements) => {
        const markdown = aggregatePlacements(placements)
        if (markdown) inserted.push(markdown)
        return { results: placements.map((p) => p?.markdown ? "inserted" : null), dropped: 0, leftover: [], placed: markdown ? 1 : 0, slots: placements.map(() => null), unplaced: "" }
      },
    }),
  }
  return { inserted, isDisposed: () => disposed, insertions }
}

/** 一条落点失效的路径：拿不到占位，引用只能交给降级追加。 */
function fallbackInsertions(): AttachmentQueueInsertions {
  return {
    capture: () => ({
      dispose: () => {},
      place: (placements) => ({
        results: placements.map((p) => p?.markdown ? "unplaced" : null),
        dropped: 0,
        leftover: [],
        placed: 0,
        slots: placements.map(() => null),
        unplaced: aggregatePlacements(placements),
      }),
    }),
  }
}

/**
 * 模拟编辑器的**逐条占位**语义，用来验证队列这一侧：
 * - 写成功的项原位换成引用（占位文字进 `replaced`）；
 * - 写失败的项就地改成失败说明，并把该处占位做成令牌交回队列（进 `failed`）；
 * - 重试时 `capture` 收到的令牌若被复用，`place` 又把它换成引用——正是
 *   「重试成功后正文里那句失败说明会被替换掉」这条约定。
 *
 * 占位文字按下标生成，与 batch.items 一一对应；测试断言的是「哪一处被换成什么」，
 * 具体坐标由编辑器负责，队列只保证结果按 items 顺序递过去。
 */
function slotRecorder() {
  const replaced: string[] = []
  const failed: string[] = []
  const placeholders = new Map<number, string>()
  const textAt = (index: number) => placeholders.get(index) ?? `（图片写入中：第 ${index} 个）`
  const insertions: AttachmentQueueInsertions = {
    capture: ({ slots }) => ({
      dispose: () => {},
      place: (placements) => {
        let placed = 0
        const kept: (AttachmentQueueSlot | null)[] = placements.map(() => null)
        placements.forEach((placement, index) => {
          if (!placement) return
          // 复用了上一批交回的令牌 = 这次换掉的就是那句失败说明，而不是另开一处落点。
          const reused = slots?.[index] ?? null
          if (placement.markdown) {
            replaced.push(`${reused ? "复用" : "新落点"}:${textAt(index)}`)
            placed += 1
          } else {
            failed.push(placement.reason ?? "")
            kept[index] = reused ?? { dispose: () => {} }
          }
        })
        return { results: placements.map((p) => p?.markdown ? "inserted" : null), dropped: 0, leftover: [], placed, slots: kept, unplaced: "" }
      },
    }),
  }
  return {
    failed,
    /** 记录某处占位当前的文字，供「重试复用了同一处落点」的比对。 */
    setPlaceholder: (index: number, text: string) => placeholders.set(index, text),
    replaced,
    /** 某一处占位当前显示的文字。 */
    textAt,
    insertions,
  }
}

describe("附件写入队列", () => {
  it.each(["batch", "item"] as const)("取消等待中的重试（%s）会释放原记录的锁和书签", async (method) => {
    const gate = deferred<void>()
    const dispose = vi.fn()
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async (_target, files) => {
        if (files[0].name === "block.png") { await gate.promise; return { errors: [], markdown: "![阻塞](block.png)" } }
        return { errors: ["写入失败"], markdown: "" }
      },
    })
    // 这一批只在乎 dispose 被调了几次（书签是否被释放），落笔结果无关紧要。
    const original = queue.enqueue({ files: [file("bad.png")], target: targetA, insertions: {
      capture: () => ({ dispose, place: () => ({ results: [], dropped: 0, leftover: [], placed: 0, slots: [], unplaced: "" }) }),
    } })!
    await until(() => queue.getSnapshot()[0].status === "failed")
    queue.enqueue({ files: [file("block.png")], target: targetA, insertions: fakeInsertion().insertions })
    const retry = queue.retry(original)!
    const pending = queue.getSnapshot().find((batch) => batch.id === retry)!
    expect(pending.status).toBe("queued")
    if (method === "batch") queue.cancel(retry)
    else queue.cancelItem(retry, pending.items[0].id)
    gate.resolve()
    await until(() => queue.getSnapshot().every((batch) => !["writing", "queued"].includes(batch.status)))
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(queue.getSnapshot().find((batch) => batch.id === original)?.retrying).toBe(false)
    expect(queue.retry(original)).not.toBeNull()
    await until(() => queue.getSnapshot().every((batch) => !["writing", "queued"].includes(batch.status)))
  })

  it("从重试记录再次重试时，与原记录共享文件结果和运行锁", async () => {
    let attempts = 0
    const gate = deferred<void>()
    const insertion = fakeInsertion()
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async () => {
        if (++attempts < 3) return { errors: ["写入失败"], markdown: "" }
        await gate.promise
        return { errors: [], markdown: "![图](x.png)" }
      },
    })
    const original = queue.enqueue({ files: [file("x.png")], target: targetA, insertions: insertion.insertions })!
    await until(() => queue.getSnapshot()[0].status === "failed")
    const retry = queue.retry(original)!
    await until(() => queue.getSnapshot().find((batch) => batch.id === retry)?.status === "failed")
    const secondRetry = queue.retry(retry)!
    expect(queue.retry(original)).toBeNull()
    expect(queue.retry(retry)).toBeNull()
    gate.resolve()
    await until(() => queue.getSnapshot().find((batch) => batch.id === secondRetry)?.status === "done")
    expect(queue.retry(original)).toBeNull()
    expect(queue.retry(retry)).toBeNull()
    expect(queue.getSnapshot().find((batch) => batch.id === original)?.status).toBe("done")
    expect(insertion.inserted).toEqual(["![图](x.png)\n"])
    expect(attempts).toBe(3)
  })

  it("入队立即固定书签，取消等待批次会释放且不重新捕获", async () => {
    const gate = deferred<void>()
    const capture = vi.fn(() => ({ dispose, place: () => ({ results: [], dropped: 0, leftover: [], placed: 0, slots: [], unplaced: "" }) }))
    const dispose = vi.fn()
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async () => { await gate.promise; return { errors: [], markdown: "![图](x.png)" } },
    })
    queue.enqueue({ files: [file("first.png")], target: targetA, insertions: fakeInsertion().insertions })
    const waiting = queue.enqueue({ files: [file("next.png")], target: targetA, insertions: { capture } })!
    expect(capture).toHaveBeenCalledTimes(1)
    queue.cancel(waiting)
    expect(dispose).toHaveBeenCalledTimes(1)
    gate.resolve()
    await until(() => queue.getSnapshot()[0].status === "done")
    expect(capture).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("两批连续附件严格按发起顺序串行写入，且各自写进发起时的那篇笔记", async () => {
    const gate = deferred<void>()
    const { calls, write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async (target, files) => { await gate.promise; return write(target, files) },
    })

    queue.enqueue({ files: [file("a1.png")], insertions: fakeInsertion().insertions, target: targetA })
    queue.enqueue({ files: [file("b1.png"), file("b2.png")], insertions: fakeInsertion().insertions, target: targetB })

    // 第一批卡在 gate 上时，第二批一个文件都不能开始写：串行是队列唯一允许的并发度。
    expect(calls).toEqual([])
    expect(queue.getSnapshot().map((batch) => batch.status)).toEqual(["writing", "queued"])

    gate.resolve()

    await until(() => queue.getSnapshot().every((batch) => batch.status === "done"))
    expect(calls.map((call) => call.files)).toEqual([["a1.png"], ["b1.png"], ["b2.png"]])
    expect(calls.map((call) => call.target.noteId)).toEqual(["note-a", "note-b", "note-b"])
    // 每个文件一次写入：批次不会被合并成一次批量调用，否则分不出是哪个文件失败了。
    expect(calls).toHaveLength(3)
  })

  it("部分失败后只重试失败项，已成功的文件不重传、正文里也不重复插入", async () => {
    const attempts = new Map<string, number>()
    const { calls, write } = recordingWriter((files) => {
      const name = files[0]?.name ?? ""
      const attempt = (attempts.get(name) ?? 0) + 1
      attempts.set(name, attempt)
      return name === "bad.png" && attempt === 1 ? { errors: ["远端拒绝"] } : {}
    })
    const insertion = fakeInsertion()
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "降级", placed: true }), write })

    queue.enqueue({ files: [file("ok1.png"), file("bad.png"), file("ok2.png")], insertions: insertion.insertions, target: targetA })
    await until(() => queue.getSnapshot()[0].status === "failed")

    const [batch] = queue.getSnapshot()
    expect(batch.items.map((item) => item.status)).toEqual(["done", "failed", "done"])
    expect(batch.items[1].error).toBe("远端拒绝")
    // 成功的两个文件先把引用插进正文；重试不该让它们出现第二次。
    expect(insertion.inserted).toEqual(["![ok1.png](attachments/ok1.png)\n\n![ok2.png](attachments/ok2.png)\n"])

    calls.length = 0
    const retryId = queue.retry(batch.id)
    expect(retryId).not.toBeNull()
    // 只看重试那一批：原批次里那条失败记录会一直留着，用整份快照判断永远等不到。
    const retriedBatch = () => queue.getSnapshot().find((item) => item.id === retryId)!
    await until(() => retriedBatch().status === "done")

    expect(calls.map((call) => call.files)).toEqual([["bad.png"]])
    expect(retriedBatch().notice).toBe("已重试：只重传失败的 1 个文件，已成功的不再上传")
    expect(retriedBatch().items[0].status).toBe("done")
    // 重试只补上失败那一个的引用，绝不整批重插。
    expect(insertion.inserted).toHaveLength(2)
    expect(insertion.inserted[1]).toBe("![bad.png](attachments/bad.png)\n")
  })

  it("取消还在等待的批次后，它的文件一个都不会被写入，也不显示成功", async () => {
    const gate = deferred<void>()
    const { calls, write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async (target, files) => { await gate.promise; return write(target, files) },
    })

    queue.enqueue({ files: [file("first.png")], insertions: fakeInsertion().insertions, target: targetA })
    const waitingId = queue.enqueue({ files: [file("never.png")], insertions: fakeInsertion().insertions, target: targetA })!

    expect(queue.cancel(waitingId)).toBe(true)
    const cancelled = queue.getSnapshot().find((batch) => batch.id === waitingId)!
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.items[0].status).toBe("cancelled")
    expect(cancelled.notice).toBe("已取消，未写入任何附件")

    gate.resolve()
    await until(() => queue.getSnapshot().every((batch) => batch.status !== "queued" && batch.status !== "writing"))
    expect(calls.map((call) => call.files)).toEqual([["first.png"]])
  })

  it("取消运行中的批次：当前文件写完并如实保留已写入的引用，剩余文件不再写、也不假装整批没发生", async () => {
    const gate = deferred<void>()
    const insertion = fakeInsertion()
    const { calls, write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async (target, files) => { await gate.promise; return write(target, files) },
    })

    const batchId = queue.enqueue({
      files: [file("running.png"), file("later.png")],
      insertions: insertion.insertions,
      target: targetA,
    })!
    await until(() => queue.getSnapshot()[0].items[0].status === "writing")

    queue.cancel(batchId)
    gate.resolve()
    await until(() => queue.getSnapshot()[0].status === "cancelled")

    const [batch] = queue.getSnapshot()
    expect(batch.items.map((item) => item.status)).toEqual(["done", "cancelled"])
    expect(calls.map((call) => call.files)).toEqual([["running.png"]])
    expect(batch.notice).toBe("已取消：当前文件已写完，1 个已写入的附件仍插入了正文")
    // 已写入的文件必须留下引用：否则用户白传了一个文件，而界面上还写着「已取消」。
    expect(insertion.inserted).toEqual(["![running.png](attachments/running.png)\n"])
  })

  it("取消单个等待项只干掉那一个，同批其余文件照常写入", async () => {
    const gate = deferred<void>()
    const { calls, write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async (target, files) => { await gate.promise; return write(target, files) },
    })

    const batchId = queue.enqueue({
      files: [file("keep-a.png"), file("drop.png"), file("keep-b.png")],
      insertions: fakeInsertion().insertions,
      target: targetA,
    })!
    const dropItem = queue.getSnapshot()[0].items[1]
    expect(queue.cancelItem(batchId, dropItem.id)).toBe(true)

    gate.resolve()
    await until(() => queue.getSnapshot()[0].status !== "writing" && queue.getSnapshot()[0].status !== "queued")
    expect(calls.map((call) => call.files)).toEqual([["keep-a.png"], ["keep-b.png"]])
    expect(queue.getSnapshot()[0].items.map((item) => item.status)).toEqual(["done", "cancelled", "done"])
  })

  it("锚点失效时走显式降级并留下说明，绝不改写到别的笔记", async () => {
    const { write } = recordingWriter(() => ({}))
    const fallbackCalls: { markdown: string; target: AttachmentQueueTarget }[] = []
    const queue = createAttachmentQueue({
      fallback: (target, markdown) => { fallbackCalls.push({ markdown, target: { ...target } }); return { notice: "「甲笔记」编辑器已切换，附件追加到了笔记末尾", placed: true } },
      write,
    })

    // 书签取不到 = 用户已经切走这篇笔记；此时只能追加到原文末尾，不能落到当前打开的笔记上。
    queue.enqueue({ files: [file("lost.png")], insertions: { capture: () => null }, target: targetA })
    await until(() => queue.getSnapshot()[0].status === "done")

    expect(fallbackCalls).toEqual([{ markdown: "![lost.png](attachments/lost.png)\n", target: targetA }])
    expect(queue.getSnapshot()[0].notice).toBe("「甲笔记」编辑器已切换，附件追加到了笔记末尾")
  })

  it("书签拿到了但插入失败，同样落到降级路径，且不重复插入", async () => {
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "原笔记已删除，附件已写入但正文引用未插入", placed: false }), write })

    queue.enqueue({ files: [file("x.png")], insertions: fallbackInsertions(), target: targetA })
    await until(() => queue.getSnapshot()[0].status === "done")

    expect(queue.getSnapshot()[0].notice).toBe("原笔记已删除，附件已写入但正文引用未插入")
  })

  it("写入抛异常时该项标为失败并保留原因，其余项不受影响", async () => {
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async (_target, files) => {
        if (files[0]?.name === "boom.png") throw new Error("网络中断")
        return { errors: [], markdown: `![${files[0]?.name}](attachments/${files[0]?.name})` }
      },
    })

    queue.enqueue({ files: [file("boom.png"), file("ok.png")], insertions: fakeInsertion().insertions, target: targetA })
    await until(() => queue.getSnapshot()[0].status === "failed")

    const [batch] = queue.getSnapshot()
    expect(batch.items[0]).toMatchObject({ error: "网络中断", status: "failed" })
    expect(batch.items[1].status).toBe("done")
  })

  it("排队期间切走的笔记拿不到书签，第二批不会把引用插进当前打开的笔记", async () => {
    const gate = deferred<void>()
    const { write } = recordingWriter(() => ({}))
    const fallbacks: AttachmentQueueTarget[] = []
    // 模拟「甲笔记的书签只在它仍是当前笔记时可得」：切到乙之后 capture 必须返回 null，
    // 队列据此走降级；若它拿到的是乙的书签，引用就会被插进乙的正文。
    let active = targetA
    const queue = createAttachmentQueue({
      fallback: (target) => { fallbacks.push({ ...target }); return { notice: "已切换", placed: true } },
      write: async (target, files) => { await gate.promise; return write(target, files) },
    })
    const bookmarkFor = (target: AttachmentQueueTarget): AttachmentQueueInsertions => ({
      capture: () => {
        if (active.editorSessionKey !== target.editorSessionKey) return null
        return {
          dispose: () => {},
          place: (placements) => ({
        results: placements.map((p) => p?.markdown ? "unplaced" : null),
            dropped: 0,
            leftover: [],
            placed: 0,
            slots: placements.map(() => null),
            unplaced: aggregatePlacements(placements),
          }),
        }
      },
    })

    queue.enqueue({ files: [file("a.png")], insertions: bookmarkFor(targetA), target: targetA })
    queue.enqueue({ files: [file("b.png")], insertions: bookmarkFor(targetB), target: targetB })

    // 第一批还在写的时候用户切到了乙笔记。
    active = targetB
    gate.resolve()
    await until(() => queue.getSnapshot().every((batch) => batch.status === "done"))

    // 两批都没有书签（甲批是在切走之后才轮到的），各自降级回**自己发起时**那篇笔记。
    // 关键是第一条：甲批的 target 仍是甲，引用没有被写进此刻打开的乙。
    expect(fallbacks).toEqual([targetA, targetB])
  })

  it("重复点击重试只排队一次，原失败项在重试成功后收尾，按钮不再可用", async () => {
    const attempts = new Map<string, number>()
    const { calls, write } = recordingWriter((files) => {
      const name = files[0]?.name ?? ""
      const attempt = (attempts.get(name) ?? 0) + 1
      attempts.set(name, attempt)
      return attempt === 1 ? { errors: ["远端拒绝"] } : {}
    })
    // 首轮立刻失败，重试那一轮才卡在 gate 上——「重试正在跑」这个窗口才存在。
    const retryGate = deferred<void>()
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async (target, files) => {
        if ((attempts.get(files[0]?.name ?? "") ?? 0) > 1) await retryGate.promise
        return write(target, files)
      },
    })

    const batchId = queue.enqueue({ files: [file("bad.png")], insertions: fakeInsertion().insertions, target: targetA })!
    await until(() => queue.getSnapshot()[0].status === "failed")
    expect(queue.getSnapshot()[0].items[0].status).toBe("failed")

    const retryId = queue.retry(batchId)
    expect(retryId).not.toBeNull()
    // 重试期间再点一次必须被拒：否则同一个文件会被传两遍，正文里也会出现两份引用。
    expect(queue.retry(batchId)).toBeNull()
    expect(queue.getSnapshot().find((batch) => batch.id === batchId)!.retrying).toBe(true)

    retryGate.resolve()
    await until(() => queue.getSnapshot().find((batch) => batch.id === batchId)!.items[0].status === "done")

    // 重试成功后原记录的失败项就地收尾，重试按钮随之消失。
    const original = queue.getSnapshot().find((batch) => batch.id === batchId)!
    expect(original.items[0]).toMatchObject({ retried: true, status: "done" })
    expect(original.items[0].error).toBeUndefined()
    expect(original.retrying).toBe(false)
    // 同一个文件只被传了两次（首次失败 + 一次重试），没有因为连点而多传。
    expect(calls.map((call) => call.files)).toEqual([["bad.png"], ["bad.png"]])
  })

  it("重试仍失败时保持可重试，绝不把失败项说成已写入", async () => {
    const { write } = recordingWriter(() => ({ errors: ["远端仍然拒绝"] }))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "降级", placed: true }), write })

    const batchId = queue.enqueue({ files: [file("bad.png")], insertions: fakeInsertion().insertions, target: targetA })!
    await until(() => queue.getSnapshot()[0].status === "failed")
    queue.retry(batchId)
    await until(() => queue.getSnapshot().find((batch) => batch.id === batchId)!.retrying === false)

    const original = queue.getSnapshot().find((batch) => batch.id === batchId)!
    expect(original.items[0]).toMatchObject({ status: "failed" })
    // 还能再重试：上一次重试没有解决任何问题。
    expect(queue.retry(batchId)).not.toBeNull()
  })

  it("取消不能把「正文引用没插进去」改报成成功", async () => {
    const gate = deferred<void>()
    const queue = createAttachmentQueue({
      // 原笔记已被删除：附件写进去了，引用哪儿都去不了。
      fallback: () => ({ notice: "「甲笔记」已被删除，附件已写入但正文引用未插入", placed: false }),
      write: async (_target, files) => { await gate.promise; return { errors: [], markdown: `![${files[0]?.name}](attachments/${files[0]?.name})\n` } },
    })

    // 书签一开始就取不到（切走/被删）：写入照常完成，引用只能走降级。
    // 随后取消收尾，不能把「引用未插入」改写成「仍插入了正文」。
    const batchId = queue.enqueue({ files: [file("running.png"), file("later.png")], insertions: { capture: () => null }, target: targetA })!
    await until(() => queue.getSnapshot()[0].items[0].status === "writing")
    queue.cancel(batchId)
    gate.resolve()
    await until(() => queue.getSnapshot()[0].status === "cancelled")

    const [batch] = queue.getSnapshot()
    expect(batch.insertion).toBe("failed")
    expect(batch.notice).toBe("「甲笔记」已被删除，附件已写入但正文引用未插入")
    expect(batch.notice).not.toContain("仍插入了正文")
  })

  it("正常结束但引用没进正文时也如实记录，不按已写入数宣称插入成功", async () => {
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "「甲笔记」已被删除，附件已写入但正文引用未插入", placed: false }),
      write,
    })

    queue.enqueue({ files: [file("lost.png")], insertions: { capture: () => null }, target: targetA })
    await until(() => queue.getSnapshot()[0].status === "done")

    const [batch] = queue.getSnapshot()
    expect(batch.items[0].status).toBe("done")
    expect(batch.insertion).toBe("failed")
    expect(batch.notice).toBe("「甲笔记」已被删除，附件已写入但正文引用未插入")
  })

  it("降级真的追加进原笔记时记为 appended，引用仍有去处", async () => {
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "「甲笔记」编辑器已切换，附件追加到了笔记末尾", placed: true }),
      write,
    })

    queue.enqueue({ files: [file("lost.png")], insertions: { capture: () => null }, target: targetA })
    await until(() => queue.getSnapshot()[0].status === "done")

    expect(queue.getSnapshot()[0].insertion).toBe("appended")
  })

  it("写失败就地标成失败说明，并把那处占位交回队列等重试", async () => {
    const recorder = slotRecorder()
    const { write } = recordingWriter(() => ({ errors: ["远端拒绝"] }))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "不应走降级", placed: true }), write })

    queue.enqueue({ files: [file("bad.png")], insertions: recorder.insertions, target: targetA })
    await until(() => queue.getSnapshot()[0].status === "failed")

    // 全批失败也要走 place：否则正文里那句「图片写入中…」永远挂着，而面板已经写着失败。
    expect(recorder.failed).toEqual(["远端拒绝"])
    const batch = queue.getSnapshot()[0]
    expect(batch.insertion).toBe("none")
    expect(batch.notice).toContain("写入失败，正文中的图片占位已标为失败")
  })

  it("重试成功后引用替换掉正文里那句失败说明，而不是另开一处落点", async () => {
    const recorder = slotRecorder()
    let attempt = 0
    const { write } = recordingWriter(() => (++attempt === 1 ? { errors: ["远端拒绝"] } : {}))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "不应走降级", placed: true }), write })

    const batchId = queue.enqueue({ files: [file("bad.png")], insertions: recorder.insertions, target: targetA })!
    await until(() => queue.getSnapshot()[0].status === "failed")
    expect(recorder.replaced).toEqual([])

    queue.retry(batchId)
    await until(() => queue.getSnapshot().find((batch) => batch.id === batchId)!.retrying === false)
    // 「复用」是关键：占位令牌活过了重试窗口，重试的落笔换掉的是同一处失败说明。
    expect(recorder.replaced).toEqual(["复用:（图片写入中：第 0 个）"])
  })

  it("重试再失败时占位不丢，第三次重试仍能换掉那句失败说明", async () => {
    const recorder = slotRecorder()
    let attempt = 0
    const { write } = recordingWriter(() => (++attempt < 3 ? { errors: ["远端拒绝"] } : {}))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "不应走降级", placed: true }), write })

    const batchId = queue.enqueue({ files: [file("bad.png")], insertions: recorder.insertions, target: targetA })!
    await until(() => queue.getSnapshot()[0].status === "failed")
    queue.retry(batchId)
    await until(() => queue.getSnapshot().find((batch) => batch.id === batchId)!.retrying === false)
    expect(recorder.replaced).toEqual([])

    // 第三次才成功。占位令牌必须经第二次重试原样传下来——按重试批次的 item id 存会在这里丢。
    queue.retry(batchId)
    await until(() => queue.getSnapshot().find((batch) => batch.id === batchId)!.items[0].status === "done")
    expect(recorder.replaced).toEqual(["复用:（图片写入中：第 0 个）"])
  })

  it("重试期间失败项留下的占位由原记录代为释放，撤掉记录后不再参与映射", async () => {
    const recorder = slotRecorder()
    const dispose = vi.fn()
    const { write } = recordingWriter(() => ({ errors: ["远端拒绝"] }))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "降级", placed: true }), write })
    // 让交回的令牌是可观察的：dispose 被调用才说明记录真的把占位放掉了。
    const withSpy: typeof recorder.insertions = {
      capture: (options) => {
        const insertion = recorder.insertions.capture(options)
        return insertion && {
          dispose: insertion.dispose,
          place: (placements) => {
            const outcome = insertion.place(placements)
            return { ...outcome, slots: outcome.slots.map((slot) => (slot ? { dispose } : null)) }
          },
        }
      },
    }

    const batchId = queue.enqueue({ files: [file("bad.png")], insertions: withSpy, target: targetA })!
    await until(() => queue.getSnapshot()[0].status === "failed")
    expect(queue.dismiss(batchId)).toBe(true)
    expect(dispose).toHaveBeenCalled()
  })

  it("部分成功时成功项原位插入、失败项就地标失败，两条路各自如实汇报", async () => {
    const recorder = slotRecorder()
    const { write } = recordingWriter((files) => (files[0]?.name === "bad.png" ? { errors: ["远端拒绝"] } : {}))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "不应走降级", placed: true }), write })

    queue.enqueue({ files: [file("ok.png"), file("bad.png")], insertions: recorder.insertions, target: targetA })
    await until(() => queue.getSnapshot()[0].status === "failed")

    expect(recorder.replaced).toEqual(["新落点:（图片写入中：第 0 个）"])
    expect(recorder.failed).toEqual(["远端拒绝"])
    const batch = queue.getSnapshot()[0]
    expect(batch.insertion).toBe("inserted")
    // 成功那一条已经原位落好了，不能因为同批有失败就改口说「引用未插入」；
    // 失败那一条的原因由它自己的 item.error 呈现，不需要再借 notice 重复一遍。
    expect(batch.notice ?? "").not.toContain("引用未插入")
  })

  it("落点失效时不覆盖用户文字，改为降级追加并如实说明", async () => {
    const fallbackCalls: { leftover: readonly string[]; markdown: string }[] = []
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: (_target, markdown, leftover) => {
        fallbackCalls.push({ leftover, markdown })
        return { notice: "占位已被改动，引用追加到了笔记末尾", placed: true }
      },
      write,
    })

    queue.enqueue({ files: [file("x.png")], target: targetA, insertions: {
      capture: () => ({
        dispose: () => {},
        place: () => ({ results: ["unplaced"], dropped: 0, leftover: ["（图片写入中：x.png）"], placed: 0, slots: [null], unplaced: "![x.png](attachments/x.png)\n" }),
      }),
    } })
    await until(() => queue.getSnapshot()[0].status === "done")

    const batch = queue.getSnapshot()[0]
    expect(batch.insertion).toBe("appended")
    // 残留占位文字必须一并交给降级：否则笔记里会永远留着「图片写入中…」这句假消息。
    expect(fallbackCalls).toEqual([{ leftover: ["（图片写入中：x.png）"], markdown: "![x.png](attachments/x.png)\n" }])
    expect(batch.notice).toBe("占位已被改动，引用追加到了笔记末尾")
  })

  it("占位已被撤销时不往笔记末尾硬塞，提示可重新插入引用", async () => {
    const fallback = vi.fn(() => ({ notice: "不应走降级", placed: true }))
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({ fallback, write })

    queue.enqueue({ files: [file("undone.png")], target: targetA, insertions: {
      capture: () => ({
        dispose: () => {},
        place: () => ({ results: ["dropped"], dropped: 1, leftover: [], placed: 0, slots: [null], unplaced: "" }),
      }),
    } })
    await until(() => queue.getSnapshot()[0].status === "done")

    const batch = queue.getSnapshot()[0]
    expect(fallback).not.toHaveBeenCalled()
    expect(batch.insertion).toBe("failed")
    expect(batch.notice).toContain("可点「重新插入引用」")
  })

  it("references 只给已写入附件的引用，没写成一个都不给", async () => {
    const { write } = recordingWriter((files) => (files[0]?.name === "bad.png" ? { errors: ["拒绝"] } : {}))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "降级", placed: true }), write })

    queue.enqueue({ files: [file("ok.png"), file("bad.png")], insertions: fakeInsertion().insertions, target: targetA })
    await until(() => queue.getSnapshot()[0].status === "failed")
    const batchId = queue.getSnapshot()[0].id
    // 只列写成功的那个：文件已经在磁盘上了，重传一遍没有任何意义。
    expect(queue.references(batchId)).toBe("![ok.png](attachments/ok.png)\n")
    expect(queue.getSnapshot()[0].referenceCount).toBe(1)
    expect(queue.references("不存在的批次")).toBe("")
  })

  it("未结束的批次不受理补插，重试进行中也不受理", async () => {
    const gate = deferred<void>()
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "降级", placed: true }),
      write: async (target, files) => { await gate.promise; return write(target, files) },
    })

    queue.enqueue({ files: [file("running.png")], insertions: fakeInsertion().insertions, target: targetA })
    // 还在写：引用马上就会被自己插进去，此刻补插只会在正文里留下两份。
    expect(queue.reinsert(queue.getSnapshot()[0].id)).toBe(false)
    gate.resolve()
    await until(() => queue.getSnapshot()[0].status === "done")
    expect(queue.getSnapshot()[0].reinserting).toBe(false)
  })

  it("补插把之前没进正文的引用插进当前打开的原文，并就地更新状态与说明", async () => {
    const inserted: string[] = []
    let placed = 0
    // 首次落笔时笔记已经切走（capture 拿不到落点）；用户切回来之后 capture 才有东西。
    let open = false
    const insertions: AttachmentQueueInsertions = {
      capture: () => (open ? {
        dispose: () => {},
        place: (placements) => {
          const markdown = aggregatePlacements(placements)
          if (markdown) { inserted.push(markdown); placed = 1 }
          return { results: placements.map((p) => p?.markdown ? "inserted" : null), dropped: 0, leftover: [], placed, slots: placements.map(() => null), unplaced: "" }
        },
      } : null),
    }
    const fallback = vi.fn(() => ({ notice: "首次插入失败", placed: false }))
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({ fallback, write })

    const batchId = queue.enqueue({ files: [file("lost.png")], insertions, target: targetA })!
    await until(() => queue.getSnapshot()[0].status === "done")
    expect(queue.getSnapshot()[0].insertion).toBe("failed")

    // 用户切回原笔记：这次补插当场重新取落点，引用插进正文而不是又追加一遍。
    open = true
    fallback.mockClear()
    expect(queue.reinsert(batchId)).toBe(true)
    expect(inserted).toEqual(["![lost.png](attachments/lost.png)\n"])
    expect(fallback).not.toHaveBeenCalled()

    const batch = queue.getSnapshot()[0]
    // 仍是同一条记录：不新开一条来路不明的批次，用户看到的是这一批状态变了。
    expect(queue.getSnapshot()).toHaveLength(1)
    expect(batch.id).toBe(batchId)
    expect(batch.insertion).toBe("inserted")
    expect(batch.reinserting).toBe(false)
  })

  it("补插拿不到落点时如实走降级，不假装插进了正文", async () => {
    const fallback = vi.fn(() => ({ notice: "「甲笔记」已被删除，附件已写入但正文引用未插入", placed: false }))
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({ fallback, write })

    const batchId = queue.enqueue({ files: [file("lost.png")], insertions: { capture: () => null }, target: targetA })!
    await until(() => queue.getSnapshot()[0].status === "done")
    expect(queue.reinsert(batchId)).toBe(true)

    const batch = queue.getSnapshot()[0]
    expect(batch.insertion).toBe("failed")
    expect(batch.notice).toContain("已被删除")
  })

  it("已插入的引用拒绝补插，复制引用仍可使用", async () => {
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({
      fallback: () => ({ notice: "已追加到笔记末尾", placed: true }),
      write,
    })

    const batchId = queue.enqueue({ files: [file("x.png")], insertions: { capture: () => null }, target: targetA })!
    await until(() => queue.getSnapshot()[0].status === "done")
    const before = queue.references(batchId)
    expect(queue.reinsert(batchId)).toBe(false)
    // references 是「已写入过什么」的账，与插了几次无关：反复补插不会让它越滚越长。
    expect(queue.references(batchId)).toBe(before)
    expect(queue.references(batchId)).toBe("![x.png](attachments/x.png)\n")
  })

  it("已结束的批次可以撤掉，进行中的不允许，快照始终是新对象", async () => {
    const { write } = recordingWriter(() => ({}))
    const queue = createAttachmentQueue({ fallback: () => ({ notice: "降级", placed: true }), write })
    const batchId = queue.enqueue({ files: [file("one.png")], insertions: fakeInsertion().insertions, target: targetA })!

    expect(queue.dismiss(batchId)).toBe(false)
    await until(() => queue.getSnapshot()[0].status === "done")
    expect(queue.dismiss(batchId)).toBe(true)
    expect(queue.getSnapshot()).toEqual([])

    queue.enqueue({ files: [file("two.png")], insertions: fakeInsertion().insertions, target: targetA })
    const listener = vi.fn()
    queue.subscribe(listener)
    const before = queue.getSnapshot()
    queue.enqueue({ files: [file("three.png")], insertions: fakeInsertion().insertions, target: targetA })
    // 快照按引用比较，必须换对象，否则 useSyncExternalStore 收不到更新。
    expect(queue.getSnapshot()).not.toBe(before)
    expect(listener).toHaveBeenCalled()
  })
})

describe("补插在重试链中只执行一次", () => {
  it("从任意历史行补插后所有入口都拒绝重复落笔", async () => {
    let attempt = 0
    let canCapture = false
    const insertion = fakeInsertion()
    const queue = createAttachmentQueue({
      fallback: () => ({ placed: false, notice: "原笔记暂不可写" }),
      write: async (_target, files) => ++attempt === 2
        ? { errors: ["第二个文件失败"], markdown: "" }
        : { errors: [], markdown: `![图](${files[0].name})` },
    })
    const id = queue.enqueue({ target: targetA, files: [file("a.png"), file("b.png")], insertions: {
      capture: (options) => canCapture ? insertion.insertions.capture(options) : null,
    } })!
    await until(() => queue.getSnapshot()[0].status === "failed")
    const retry = queue.retry(id)!
    await until(() => queue.getSnapshot().find((batch) => batch.id === retry)?.status === "done")
    canCapture = true
    expect(queue.reinsert(retry)).toBe(true)
    expect(queue.reinsert(id)).toBe(false)
    expect(queue.reinsert(retry)).toBe(false)
    expect(insertion.inserted).toEqual(["![图](a.png)\n\n![图](b.png)\n"])
    expect(queue.getSnapshot().every((batch) => batch.pendingReferenceCount === 0 && batch.insertion === "inserted")).toBe(true)
  })
})
