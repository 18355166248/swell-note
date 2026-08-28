import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))

import {
  createMarkdownFile,
  createWebDavBinaryFile,
  deleteMarkdownFile,
  ensureWebDavDirectory,
  moveMarkdownFile,
  WebDavAuthenticationError,
  WebDavNetworkError,
  WebDavRevisionConflictError,
  writeMarkdownFile,
} from "@/services/webdav-client"

const config = {
  provider: "jianguoyun" as const,
  remotePath: "/Swell/",
  serverUrl: "https://dav.jianguoyun.com/dav/",
  username: "test@example.com",
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("WebDAV conditional create", () => {
  it("附件使用条件创建并保留 MIME 类型", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    await createWebDavBinaryFile(config, "app-password", "/Swell/attachments/a.png", new Uint8Array([1, 2]), "image/png")

    const [, request] = fetchMock.mock.calls[0]
    expect(request).toMatchObject({
      headers: expect.objectContaining({ "Content-Type": "image/png", "If-None-Match": "*" }),
      method: "PUT",
    })
  })

  it("使用 If-None-Match 创建文件，避免覆盖同名远端笔记", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", {
      headers: { etag: '"created-v1"' },
      status: 201,
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createMarkdownFile(config, "app-password", "/Swell/新笔记.md", "# 新笔记"))
      .resolves.toEqual({ revision: '"created-v1"' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/webdav/Swell/%E6%96%B0%E7%AC%94%E8%AE%B0.md")
    expect(request).toMatchObject({
      body: "# 新笔记",
      headers: expect.objectContaining({ "If-None-Match": "*" }),
      method: "PUT",
    })
  })

  it("同名文件已存在时返回可识别的版本冲突", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 412 })))

    await expect(createMarkdownFile(config, "app-password", "/Swell/重复.md", "# 重复"))
      .rejects.toBeInstanceOf(WebDavRevisionConflictError)
  })

  it("密码失效时返回可识别的认证错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })))

    await expect(createMarkdownFile(config, "expired-password", "/Swell/新笔记.md", "# 新笔记"))
      .rejects.toBeInstanceOf(WebDavAuthenticationError)
  })

  it("网络异常时给出不丢本地修改的统一提示", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))

    await expect(createMarkdownFile(config, "app-password", "/Swell/新笔记.md", "# 新笔记"))
      .rejects.toBeInstanceOf(WebDavNetworkError)
  })
})

describe("WebDAV queued file operations", () => {
  it("移动到新目录前会逐级创建目录并接受已存在响应", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 405 }))
      .mockResolvedValueOnce(new Response("", { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    await ensureWebDavDirectory(config, "app-password", "/Swell/工作/项目")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url, request]) => [url, request.method])).toEqual([
      ["/api/webdav/Swell/%E5%B7%A5%E4%BD%9C", "MKCOL"],
      ["/api/webdav/Swell/%E5%B7%A5%E4%BD%9C/%E9%A1%B9%E7%9B%AE", "MKCOL"],
    ])
  })

  it("移动文件时禁止覆盖目标并校验原文件版本", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", {
      headers: { etag: '"moved-v2"' },
      status: 201,
    }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(moveMarkdownFile(
      config,
      "app-password",
      "/Swell/旧名称.md",
      "/Swell/目录/新名称.md",
      '"v1"',
    )).resolves.toEqual({ revision: '"moved-v2"' })

    const [, request] = fetchMock.mock.calls[0]
    expect(request).toMatchObject({
      headers: expect.objectContaining({
        Destination: "https://dav.jianguoyun.com/dav/Swell/%E7%9B%AE%E5%BD%95/%E6%96%B0%E5%90%8D%E7%A7%B0.md",
        "If-Match": '"v1"',
        Overwrite: "F",
      }),
      method: "MOVE",
    })
  })

  it("删除文件时携带原文件版本", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    await deleteMarkdownFile(config, "app-password", "/Swell/待删除.md", '"v3"')

    const [, request] = fetchMock.mock.calls[0]
    expect(request).toMatchObject({
      headers: expect.objectContaining({ "If-Match": '"v3"' }),
      method: "DELETE",
    })
  })
})

describe("WebDAV multi-device concurrency", () => {
  it("第二台设备使用过期 ETag 写入时被服务端拒绝", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { etag: '"v2"' }, status: 204 }))
      .mockResolvedValueOnce(new Response("", { status: 412 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(writeMarkdownFile(config, "app-password", "/Swell/并发.md", "设备 A", '"v1"'))
      .resolves.toEqual({ revision: '"v2"' })
    await expect(writeMarkdownFile(config, "app-password", "/Swell/并发.md", "设备 B", '"v1"'))
      .rejects.toBeInstanceOf(WebDavRevisionConflictError)

    expect(fetchMock.mock.calls.map(([, request]) => request.headers["If-Match"])).toEqual(['"v1"', '"v1"'])
  })
})
