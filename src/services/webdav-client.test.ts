import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))

import {
  checkWebDavDirectoryExists,
  createJsonDocument,
  createMarkdownFile,
  createWebDavBinaryFile,
  deleteMarkdownFile,
  ensureWebDavDirectory,
  moveMarkdownFile,
  moveWebDavDirectory,
  readJsonDocument,
  readWebDavAsset,
  updateJsonDocument,
  WebDavAuthenticationError,
  WebDavContentTooLargeError,
  WebDavHttpError,
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
  it("读取缺失附件时明确报告文件缺失", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })))

    await expect(readWebDavAsset(config, "app-password", "/Swell/attachments/missing.png"))
      .rejects.toThrow("远端附件不存在")
  })

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

  it("目录 MOVE 禁止覆盖，重试时以目标存在作为完成检查点", async () => {
    const propfindBody = (exists: boolean) => new Response("", { status: exists ? 207 : 404 })
    const marker = JSON.stringify({ operationId: "move-1", path: "/Swell/旧目录", targetPath: "/Swell/新目录" })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(propfindBody(true))
      .mockResolvedValueOnce(propfindBody(false))
      .mockResolvedValueOnce(new Response("", { status: 201 }))
      .mockResolvedValueOnce(new Response("", { status: 201 }))
      .mockResolvedValueOnce(propfindBody(false))
      .mockResolvedValueOnce(propfindBody(true))
      .mockResolvedValueOnce(new Response(marker, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await moveWebDavDirectory(config, "app-password", "/Swell/旧目录", "/Swell/新目录", "move-1")
    await moveWebDavDirectory(config, "app-password", "/Swell/旧目录", "/Swell/新目录", "move-1")

    const moveRequest = fetchMock.mock.calls.find(([, request]) => request.method === "MOVE")?.[1]
    expect(moveRequest).toMatchObject({
      headers: expect.objectContaining({
        Destination: "https://dav.jianguoyun.com/dav/Swell/%E6%96%B0%E7%9B%AE%E5%BD%95",
        Overwrite: "F",
      }),
      method: "MOVE",
    })
    expect(fetchMock.mock.calls.filter(([, request]) => request.method === "MOVE")).toHaveLength(1)
  })

  it("源缺失且目标同名但没有本操作凭证时拒绝冒认成功", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("", { status: 207 }))
      .mockResolvedValueOnce(new Response("other", { status: 200 })))
    await expect(moveWebDavDirectory(config, "app-password", "/Swell/旧", "/Swell/新", "move-2"))
      .rejects.toThrow("无法确认")
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

describe("WebDAV JSON metadata", () => {
  const documentPath = "/Swell/.swell/folder-order.json"

  it("读取返回字节与强 ETag，404 是缺失而不是错误", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"order":[]}', { headers: { etag: '"v7"' }, status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(readJsonDocument(config, "app-password", documentPath, 1024))
      .resolves.toMatchObject({ etag: '"v7"', etagWeak: false })
    await expect(readJsonDocument(config, "app-password", documentPath, 1024)).resolves.toBeNull()
  })

  it("弱 ETag 单独标记，不能冒充强 ETag", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("{}", { headers: { etag: 'W/"v1"' }, status: 200 }),
    ))

    await expect(readJsonDocument(config, "app-password", documentPath, 1024))
      .resolves.toMatchObject({ etag: 'W/"v1"', etagWeak: true })
  })

  it("读取按实际字节执行上限，不能只信 Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(2048), { status: 200 })))
    await expect(readJsonDocument(config, "app-password", documentPath, 1024))
      .rejects.toBeInstanceOf(WebDavContentTooLargeError)

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("ok", { headers: { "content-length": "2048" }, status: 200 }),
    ))
    await expect(readJsonDocument(config, "app-password", documentPath, 1024))
      .rejects.toBeInstanceOf(WebDavContentTooLargeError)
  })

  it("401/403/429 状态可程序化区分", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })))
    await expect(readJsonDocument(config, "wrong", documentPath, 1024))
      .rejects.toBeInstanceOf(WebDavAuthenticationError)

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })))
    await expect(readJsonDocument(config, "app-password", documentPath, 1024))
      .rejects.toBeInstanceOf(WebDavHttpError)
    await expect(readJsonDocument(config, "app-password", documentPath, 1024))
      .rejects.toMatchObject({ status: 403 })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })))
    await expect(readJsonDocument(config, "app-password", documentPath, 1024))
      .rejects.toMatchObject({ name: "WebDavHttpError", status: 429 })
  })

  it("条件创建携带 If-None-Match 与 JSON MIME，412 可识别", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { headers: { etag: '"c1"' }, status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createJsonDocument(config, "app-password", documentPath, "{}"))
      .resolves.toEqual({ etag: '"c1"', etagWeak: false })
    const [, request] = fetchMock.mock.calls[0]
    expect(request).toMatchObject({
      headers: expect.objectContaining({
        "Content-Type": "application/json; charset=utf-8",
        "If-None-Match": "*",
      }),
      method: "PUT",
    })

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 412 })))
    await expect(createJsonDocument(config, "app-password", documentPath, "{}"))
      .rejects.toBeInstanceOf(WebDavRevisionConflictError)
  })

  it("条件更新使用强 ETag；弱 ETag 直接拒绝；无新 ETag 时返回 null 而不是沿用旧值", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(updateJsonDocument(config, "app-password", documentPath, "{}", '"v3"'))
      .resolves.toEqual({ etag: null, etagWeak: false })
    const [, request] = fetchMock.mock.calls[0]
    expect(request.headers).toMatchObject({ "If-Match": '"v3"' })

    await expect(updateJsonDocument(config, "app-password", documentPath, "{}", 'W/"v3"'))
      .rejects.toThrow(/弱 ETag/)
  })

  it("根目录存在性检查：404 为 false，207 为 true，401 抛认证错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 207 })))
    await expect(checkWebDavDirectoryExists(config, "app-password", "/Swell/")).resolves.toBe(true)

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })))
    await expect(checkWebDavDirectoryExists(config, "app-password", "/Swell/")).resolves.toBe(false)

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })))
    await expect(checkWebDavDirectoryExists(config, "app-password", "/Swell/"))
      .rejects.toBeInstanceOf(WebDavAuthenticationError)
  })
})
