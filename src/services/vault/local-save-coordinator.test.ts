import { describe, expect, it, vi } from "vitest"

import { LocalSaveCoordinator, type LocalSaveToken } from "./local-save-coordinator"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe("LocalSaveCoordinator", () => {
  it("串行写入并让旧完成保留最新请求的保存中状态", async () => {
    const coordinator = new LocalSaveCoordinator()
    const firstWrite = deferred<string>()
    const secondWrite = deferred<string>()
    const observedRevisions: Array<string | undefined> = []
    let revision: string | undefined = "r0"
    let status = "saving"

    const persist = (token: LocalSaveToken, result: Promise<string>) => coordinator.enqueue("note.md", async () => {
      observedRevisions.push(revision)
      const nextRevision = await result
      if (!coordinator.isContextCurrent(token)) return
      revision = nextRevision
      if (coordinator.settle(token)) status = "saved"
    })

    const firstToken = coordinator.begin("note")
    const first = persist(firstToken, firstWrite.promise)
    const secondToken = coordinator.begin("note")
    const second = persist(secondToken, secondWrite.promise)

    firstWrite.resolve("r1")
    await first
    expect(status).toBe("saving")
    expect(revision).toBe("r1")

    secondWrite.resolve("r2")
    await second
    expect(status).toBe("saved")
    expect(revision).toBe("r2")
    expect(observedRevisions).toEqual(["r0", "r1"])
    expect(coordinator.hasPending("note")).toBe(false)
  })

  it("旧失败不会覆盖后续请求，队列仍继续执行", async () => {
    const coordinator = new LocalSaveCoordinator()
    const firstWrite = deferred<void>()
    let status = "saving"
    const secondWrite = vi.fn(async () => undefined)

    const firstToken = coordinator.begin("note")
    const first = coordinator.enqueue("note.md", async () => {
      try {
        await firstWrite.promise
      } catch {
        if (coordinator.settle(firstToken)) status = "error"
      }
    })
    const secondToken = coordinator.begin("note")
    const second = coordinator.enqueue("note.md", async () => {
      await secondWrite()
      if (coordinator.settle(secondToken)) status = "saved"
    })

    firstWrite.reject(new Error("disk busy"))
    await first
    expect(status).toBe("saving")
    await second
    expect(secondWrite).toHaveBeenCalledOnce()
    expect(status).toBe("saved")
  })

  it("切换 Vault 后忽略旧写入的完成回调", async () => {
    const coordinator = new LocalSaveCoordinator()
    const write = deferred<string>()
    const token = coordinator.begin("same-id")
    let revision = "new-vault-revision"
    let status = "new-vault-state"

    const pending = coordinator.enqueue("same-path.md", async () => {
      const oldRevision = await write.promise
      if (!coordinator.isContextCurrent(token)) return
      revision = oldRevision
      if (coordinator.settle(token)) status = "saved"
    })
    coordinator.invalidate()
    write.resolve("old-vault-revision")
    await pending

    expect(revision).toBe("new-vault-revision")
    expect(status).toBe("new-vault-state")
    expect(coordinator.hasPending("same-id")).toBe(false)
  })

  it("切换 Vault 后保留物理串行链但不启动旧会话中尚未执行的写入", async () => {
    const coordinator = new LocalSaveCoordinator()
    const firstWrite = deferred<void>()
    const firstStarted = deferred<void>()
    const firstToken = coordinator.begin("note")
    const firstAdapterWrite = vi.fn(() => {
      firstStarted.resolve()
      return firstWrite.promise
    })
    const secondAdapterWrite = vi.fn(async () => undefined)

    const first = coordinator.enqueue("same-path.md", async () => {
      if (!coordinator.isContextCurrent(firstToken)) return
      await firstAdapterWrite()
    })
    const secondToken = coordinator.begin("note")
    const second = coordinator.enqueue("same-path.md", async () => {
      if (!coordinator.isContextCurrent(secondToken)) return
      await secondAdapterWrite()
    })

    await firstStarted.promise
    expect(firstAdapterWrite).toHaveBeenCalledOnce()
    coordinator.invalidate()

    const newToken = coordinator.begin("note")
    const newVaultWrite = vi.fn(async () => undefined)
    const current = coordinator.enqueue("same-path.md", async () => {
      if (!coordinator.isContextCurrent(newToken)) return
      await newVaultWrite()
    })

    expect(newVaultWrite).not.toHaveBeenCalled()
    firstWrite.resolve()
    await Promise.all([first, second, current])

    expect(secondAdapterWrite).not.toHaveBeenCalled()
    expect(newVaultWrite).toHaveBeenCalledOnce()
  })

  it("取消笔记会让同一 Vault 中仍在途的回调失效", () => {
    const coordinator = new LocalSaveCoordinator()
    const token = coordinator.begin("note")

    coordinator.cancelNote("note")

    expect(coordinator.isContextCurrent(token)).toBe(false)
    expect(coordinator.settle(token)).toBe(false)
  })
})
