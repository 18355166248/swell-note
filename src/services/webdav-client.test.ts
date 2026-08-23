import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))

import {
  createMarkdownFile,
  deleteMarkdownFile,
  moveMarkdownFile,
  WebDavRevisionConflictError,
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
})

describe("WebDAV queued file operations", () => {
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
