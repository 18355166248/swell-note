// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

import {
  buildFolderOrderConflictDialogId,
  handleScopedWebDavAuthenticationFailure,
  isCurrentFolderOrderResolution,
  nextFolderOrderConflictDismissed,
  runFolderOrderResolutionRequest,
} from "./App"
import type { WebDavConfig } from "@/lib/webdav-config"
import type { FolderOrderConflict } from "@/services/cache/folder-order-sync-store"
import type { VaultAdapter } from "@/services/vault/vault-adapter"
import { WebDavAuthenticationError } from "@/services/webdav-client"

const baseConflict: FolderOrderConflict = {
  localGeneration: 3,
  localOrder: ["A", "B"],
  remoteChangeId: "remote-1",
  remoteEtag: "\"etag\"",
  remoteExists: true,
  remoteOrder: ["B", "A"],
}

function adapter(name: string): VaultAdapter {
  return {
    cacheIdentity: name,
    cacheLabel: name,
    displayName: name,
    kind: "webdav",
    readOnly: false,
    listMarkdownFiles: async () => [],
    readTextFile: async () => ({ content: "" }),
  }
}

function deferred<T>() {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, reject, resolve }
}

const configA: WebDavConfig = {
  provider: "jianguoyun",
  remotePath: "/A/",
  serverUrl: "https://dav.example.test/",
  username: "a@example.test",
}
const configAIdentity = "webdav:https://dav.example.test/:a@example.test:/A/"

describe("App 文件夹排序冲突 UI 状态", () => {
  it("冲突身份包含库身份和完整候选顺序，避免跨库或拼接歧义复用 dismiss", () => {
    const dismissedA = buildFolderOrderConflictDialogId("cache-a", baseConflict)
    const sameCandidatesOnB = buildFolderOrderConflictDialogId("cache-b", baseConflict)
    const ambiguousLeft = buildFolderOrderConflictDialogId("cache-a", {
      ...baseConflict,
      remoteOrder: ["ab", "c"],
    })
    const ambiguousRight = buildFolderOrderConflictDialogId("cache-a", {
      ...baseConflict,
      remoteOrder: ["a", "bc"],
    })

    expect(dismissedA).not.toBe(sameCandidatesOnB)
    expect(ambiguousLeft).not.toBe(ambiguousRight)
    expect(JSON.parse(dismissedA!)).toMatchObject({
      cacheId: "cache-a",
      localGeneration: 3,
      localOrder: ["A", "B"],
      remoteChangeId: "remote-1",
      remoteExists: true,
      remoteOrder: ["B", "A"],
    })
  })

  it("只有显式同步会重新打开已暂不处理的排序冲突", () => {
    const dismissed = "dismissed-conflict"

    expect(nextFolderOrderConflictDismissed(dismissed, "explicit")).toBeNull()
    expect(nextFolderOrderConflictDismissed(dismissed, "automatic")).toBe(dismissed)
    expect(nextFolderOrderConflictDismissed(dismissed, "passive")).toBe(dismissed)
  })

  it("旧库冲突选择延迟失败后不能回填当前库错误或结束新请求状态", async () => {
    const adapterA = adapter("cache-a")
    const adapterB = adapter("cache-b")
    const scope = { adapter: adapterA, cacheId: "cache-a", requestId: 7 }
    let current = {
      activeCacheMeta: { id: "cache-a", label: "A", lastSyncedAt: 1, sourceKind: "webdav" as const },
      requestId: 7,
      vaultSession: adapterA,
    }
    const pending = deferred<{ outcome: "error"; message: string }>()
    const showFailure = vi.fn()
    const onFinally = vi.fn()

    const running = runFolderOrderResolutionRequest({
      handleAuthenticationFailure: vi.fn(),
      isCurrent: () => isCurrentFolderOrderResolution(scope, current),
      onFinally,
      resolve: () => pending.promise,
      showFailure,
    })

    current = {
      activeCacheMeta: { id: "cache-b", label: "B", lastSyncedAt: 1, sourceKind: "webdav" },
      requestId: 7,
      vaultSession: adapterB,
    }
    pending.resolve({ message: "A 排序失败", outcome: "error" })
    await running

    expect(showFailure).not.toHaveBeenCalled()
    expect(onFinally).not.toHaveBeenCalled()
  })

  it("认证失败已进入删除凭据 await 后切库，不断开 B 也不打开 B 的重连框", async () => {
    const adapterA = { ...adapter("cache-a"), cacheIdentity: configAIdentity }
    const adapterB = adapter("cache-b")
    const scope = { adapter: adapterA, cacheId: "cache-a", requestId: 7 }
    let current = {
      activeCacheMeta: { id: "cache-a", label: "A", lastSyncedAt: 1, sourceKind: "webdav" as const },
      requestId: 7,
      vaultSession: adapterA,
    }
    const resolvePending = deferred<never>()
    const deletePending = deferred<void>()
    const deletePassword = vi.fn(() => deletePending.promise)
    const applyAuthFailure = vi.fn()
    const onFinally = vi.fn()

    const running = runFolderOrderResolutionRequest({
      handleAuthenticationFailure: (message) => handleScopedWebDavAuthenticationFailure({
        adapter: adapterA,
        cacheId: "cache-a",
        config: configA,
        createCacheId: async () => "cache-a",
        deletePassword,
        isCurrent: () => isCurrentFolderOrderResolution(scope, current),
        message,
        onApply: applyAuthFailure,
      }),
      isCurrent: () => isCurrentFolderOrderResolution(scope, current),
      onFinally,
      resolve: () => resolvePending.promise,
      showFailure: vi.fn(),
    })

    resolvePending.reject(new WebDavAuthenticationError())
    await vi.waitFor(() => expect(deletePassword).toHaveBeenCalledWith(configA))
    current = {
      activeCacheMeta: { id: "cache-b", label: "B", lastSyncedAt: 1, sourceKind: "webdav" },
      requestId: 8,
      vaultSession: adapterB,
    }
    deletePending.resolve()
    await running

    expect(applyAuthFailure).not.toHaveBeenCalled()
    expect(onFinally).not.toHaveBeenCalled()
    expect(deletePassword).toHaveBeenCalledTimes(1)
  })

  it("保存配置已切到 B 时，A 排序认证失败只提示当前请求，不删除 B 凭据", async () => {
    const adapterA = { ...adapter("cache-a"), cacheIdentity: configAIdentity }
    const scope = { adapter: adapterA, cacheId: "cache-a", requestId: 7 }
    const deletePassword = vi.fn(async () => undefined)
    const applyAuthFailure = vi.fn()

    await handleScopedWebDavAuthenticationFailure({
      adapter: adapterA,
      cacheId: "cache-a",
      config: {
        ...configA,
        remotePath: "/B/",
        username: "b@example.test",
      },
      createCacheId: async () => "cache-b",
      deletePassword,
      isCurrent: () => isCurrentFolderOrderResolution(scope, {
        activeCacheMeta: { id: "cache-a", label: "A", lastSyncedAt: 1, sourceKind: "webdav" },
        requestId: 7,
        vaultSession: adapterA,
      }),
      message: "A 凭据失效",
      onApply: applyAuthFailure,
    })

    expect(deletePassword).not.toHaveBeenCalled()
    expect(applyAuthFailure).toHaveBeenCalledWith("A 凭据失效", { credentialDeleted: false })
  })

  it("A→B→A 回到同库但新请求已开始时，旧请求结果仍不能覆盖新请求", async () => {
    const adapterA = adapter("cache-a")
    const adapterB = adapter("cache-b")
    const scope = { adapter: adapterA, cacheId: "cache-a", requestId: 7 }
    let current = {
      activeCacheMeta: { id: "cache-a", label: "A", lastSyncedAt: 1, sourceKind: "webdav" as const },
      requestId: 7,
      vaultSession: adapterA,
    }
    const pending = deferred<{ outcome: "error"; message: string }>()
    const showFailure = vi.fn()
    const onFinally = vi.fn()

    const running = runFolderOrderResolutionRequest({
      handleAuthenticationFailure: vi.fn(),
      isCurrent: () => isCurrentFolderOrderResolution(scope, current),
      onFinally,
      resolve: () => pending.promise,
      showFailure,
    })

    current = {
      activeCacheMeta: { id: "cache-b", label: "B", lastSyncedAt: 1, sourceKind: "webdav" },
      requestId: 8,
      vaultSession: adapterB,
    }
    current = {
      activeCacheMeta: { id: "cache-a", label: "A", lastSyncedAt: 1, sourceKind: "webdav" },
      requestId: 9,
      vaultSession: adapterA,
    }
    pending.resolve({ message: "旧 A 请求失败", outcome: "error" })
    await running

    expect(showFailure).not.toHaveBeenCalled()
    expect(onFinally).not.toHaveBeenCalled()
  })
})
