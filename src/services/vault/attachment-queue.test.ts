// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

import { createAttachmentQueue, type AttachmentQueueTarget } from "./attachment-queue"

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

function fakeInsertion() {
  const inserted: string[] = []
  let disposed = false
  return {
    inserted,
    isDisposed: () => disposed,
    insertions: {
      capture: () => ({ dispose: () => { disposed = true }, insert: (markdown: string) => { inserted.push(markdown); return true } }),
    },
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
    const original = queue.enqueue({ files: [file("bad.png")], target: targetA, insertions: {
      capture: () => ({ dispose, insert: () => true }),
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
    const capture = vi.fn(() => ({ dispose, insert: () => true }))
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

    queue.enqueue({
      files: [file("x.png")],
      insertions: { capture: () => ({ dispose: () => {}, insert: () => false }) },
      target: targetA,
    })
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
    const bookmarkFor = (target: AttachmentQueueTarget): { capture: () => { dispose: () => void; insert: (markdown: string) => boolean } | null } => ({
      capture: () => {
        if (active.editorSessionKey !== target.editorSessionKey) return null
        return { dispose: () => {}, insert: () => false }
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
