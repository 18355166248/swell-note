import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))

import { mergeMarkdownVersions } from "@/services/sync/three-way-merge"
import { createWebDavVaultAdapter } from "@/services/vault/webdav-vault-adapter"
import { VaultConflictError } from "@/services/vault/vault-adapter"

const config = {
  provider: "jianguoyun" as const,
  remotePath: "/Swell/",
  serverUrl: "https://dav.jianguoyun.com/dav/",
  username: "integration@example.com",
}

afterEach(() => vi.unstubAllGlobals())

describe("WebDAV 多设备同步集成", () => {
  it("保留过期设备修改，并在读取最新版本后三方合并", async () => {
    const server = createStatefulWebDavServer()
    vi.stubGlobal("fetch", server.fetch)
    const deviceA = createWebDavVaultAdapter(config, "password")
    const deviceB = createWebDavVaultAdapter(config, "password")

    const created = await deviceA.createTextFile!("/Swell/并发.md", "# 标题\n\n共同内容\n")
    const baseA = await deviceA.readTextFile("/Swell/并发.md")
    const baseB = await deviceB.readTextFile("/Swell/并发.md")
    expect(baseA.revision).toBe(created.revision)

    const writtenA = await deviceA.writeTextFile!(
      "/Swell/并发.md",
      "# 标题 A\n\n共同内容\n",
      baseA.revision,
    )
    await expect(deviceB.writeTextFile!(
      "/Swell/并发.md",
      "# 标题\n\n共同内容\n\n设备 B 补充\n",
      baseB.revision,
    )).rejects.toBeInstanceOf(VaultConflictError)

    const latest = await deviceB.readTextFile("/Swell/并发.md")
    const merged = mergeMarkdownVersions(
      baseB.content,
      "# 标题\n\n共同内容\n\n设备 B 补充\n",
      latest.content,
    )
    expect(merged.conflictCount).toBe(0)
    expect(merged.content).toContain("# 标题 A")
    expect(merged.content).toContain("设备 B 补充")
    await expect(deviceB.writeTextFile!("/Swell/并发.md", merged.content, latest.revision))
      .resolves.toMatchObject({ revision: expect.not.stringMatching(writtenA.revision ?? "") })
  })

  it("网络失败不改变远端，重试后使用原 ETag 安全写入", async () => {
    const server = createStatefulWebDavServer()
    vi.stubGlobal("fetch", server.fetch)
    const device = createWebDavVaultAdapter(config, "password")
    const created = await device.createTextFile!("/Swell/重试.md", "旧正文")

    server.failNextRequest()
    await expect(device.writeTextFile!("/Swell/重试.md", "新正文", created.revision))
      .rejects.toThrow("HTTP 503")
    await expect(device.readTextFile("/Swell/重试.md"))
      .resolves.toMatchObject({ content: "旧正文", revision: created.revision })
    await expect(device.writeTextFile!("/Swell/重试.md", "新正文", created.revision))
      .resolves.toMatchObject({ revision: '"v2"' })
  })
})

function createStatefulWebDavServer() {
  const files = new Map<string, { body: string; revision: number }>()
  let shouldFail = false
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (shouldFail) {
      shouldFail = false
      return new Response("temporary unavailable", { status: 503 })
    }
    const path = decodeURIComponent(String(input).replace(/^.*\/api\/webdav/, ""))
    const method = init?.method ?? "GET"
    const headers = new Headers(init?.headers)
    const current = files.get(path)

    if (method === "GET") {
      return current
        ? new Response(current.body, { headers: { etag: revisionOf(current) }, status: 200 })
        : new Response("", { status: 404 })
    }
    if (method === "PUT") {
      if (headers.get("If-None-Match") === "*" && current) return new Response("", { status: 412 })
      if (headers.has("If-Match") && headers.get("If-Match") !== (current ? revisionOf(current) : null)) {
        return new Response("", { status: 412 })
      }
      const next = { body: String(init?.body ?? ""), revision: (current?.revision ?? 0) + 1 }
      files.set(path, next)
      return new Response(current ? null : "", { headers: { etag: revisionOf(next) }, status: current ? 204 : 201 })
    }
    return new Response("unsupported", { status: 405 })
  })

  return {
    failNextRequest() {
      shouldFail = true
    },
    fetch,
  }
}

function revisionOf(file: { revision: number }) {
  return `"v${file.revision}"`
}
