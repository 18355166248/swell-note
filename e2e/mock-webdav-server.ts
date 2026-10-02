import { expect, type Page, type Route } from "@playwright/test"

export const SERVER_URL = "https://webdav.e2e.test/dav/"
export const REMOTE_ROOT = "/Swell/"
export const USERNAME = "e2e@example.com"
export const PASSWORD = "e2e-app-password"
export const FOLDER_ORDER_PATH = "/Swell/.swell/folder-order.json"

// 页面 origin 是 http://127.0.0.1:4173，请求虚构主机属于跨域：route.fulfill 合成的响应
// 仍受 fetch 的跨域头可见性约束，ETag 必须显式 expose，否则页面读到的 ETag 为 null。
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers": "Authorization, Cache-Control, Content-Type, Depth, Destination, If-Match, If-None-Match, Overwrite",
  "Access-Control-Allow-Methods": "DELETE, GET, MKCOL, MOVE, OPTIONS, PROPFIND, PUT",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag",
}

type RemoteFile = { content: string; etag: string }
type FolderOrderDocument = { changeId: string; order: string[]; schemaVersion: number }

function ensureTrailingSlash(path: string) {
  return path.endsWith("/") ? path : `${path}/`
}

function parentDirectoryOf(path: string) {
  const trimmed = path.replace(/\/+$/g, "")
  const index = trimmed.lastIndexOf("/")
  return index <= 0 ? "/" : `${trimmed.slice(0, index)}/`
}

function encodeHrefPath(path: string) {
  return `/dav${path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`
}

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// 内存 WebDAV 服务：目录集合 + 文件表 + 单调递增强 ETag；记录请求日志供行为断言。
// staleFolderOrderSnapshot 是一次性“读延迟”开关：下一次 GET 排序文档返回旧版本，
// 用于在真实协议栈上复现“判定后、上传前远端被另一设备改写”的 412 竞态。
export class MockWebDavServer {
  private etagCounter = 0
  private readonly directories = new Set<string>()
  private readonly files = new Map<string, RemoteFile>()
  private readonly folderOrderHistory: { content: string; etag: string }[] = []
  readonly log: string[] = []
  staleFolderOrderSnapshot: { content: string; etag: string } | null = null

  private nextEtag() {
    this.etagCounter += 1
    return `"e${this.etagCounter}"`
  }

  addDirectory(path: string) {
    let current = ensureTrailingSlash(path)
    while (!this.directories.has(current)) {
      this.directories.add(current)
      if (current === "/") break
      current = parentDirectoryOf(current)
    }
  }

  addFile(path: string, content: string) {
    this.addDirectory(parentDirectoryOf(path))
    this.files.set(path, { content, etag: this.nextEtag() })
  }

  readFile(path: string) { return this.files.get(path)?.content }

  etagOf(path: string) {
    const file = this.files.get(path)
    if (!file) throw new Error(`mock 远端不存在文件：${path}`)
    return file.etag
  }

  readFolderOrder(): FolderOrderDocument | null {
    const file = this.files.get(FOLDER_ORDER_PATH)
    return file ? (JSON.parse(file.content) as FolderOrderDocument) : null
  }

  readNotePins(): string[] | null {
    const file = this.files.get("/Swell/.swell/note-pins.json")
    return file ? JSON.parse(file.content).pins : null
  }

  putCount(path: string) {
    return this.log.filter((entry) => entry === `PUT ${path}`).length
  }

  // 让下一次 GET 排序文档返回上一版本（模拟另一设备已推进远端后的过期读）。
  staleNextFolderOrderRead() {
    const previous = this.folderOrderHistory[this.folderOrderHistory.length - 1]
    if (!previous) throw new Error("尚无排序文档历史可回放")
    this.staleFolderOrderSnapshot = previous
  }

  readonly handler = async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = decodeURIComponent(url.pathname.replace(/^\/dav/, "")) || "/"
    const method = request.method()
    this.log.push(`${method} ${path}`)

    if (method === "OPTIONS") return route.fulfill({ headers: CORS_HEADERS, status: 204 })

    switch (method) {
      case "PROPFIND":
        return this.handlePropfind(route, path, request.headers()["depth"] ?? "1")
      case "GET":
        return this.handleGet(route, path)
      case "PUT":
        return this.handlePut(route, path, request.headers(), request.postData() ?? "")
      case "MKCOL": {
        const directory = ensureTrailingSlash(path)
        if (this.directories.has(directory)) return route.fulfill({ body: "already exists", headers: CORS_HEADERS, status: 405 })
        this.addDirectory(directory)
        return route.fulfill({ body: "", headers: CORS_HEADERS, status: 201 })
      }
      default:
        return route.fulfill({ body: "method not supported by e2e mock", headers: CORS_HEADERS, status: 405 })
    }
  }

  private handlePropfind(route: Route, path: string, depth: string) {
    const directory = ensureTrailingSlash(path)
    if (!this.directories.has(directory)) return route.fulfill({ body: "not found", headers: CORS_HEADERS, status: 404 })

    const rows: { collection: boolean; displayName: string; etag?: string; path: string }[] = [{
      collection: true,
      displayName: directory === "/" ? "" : directory.replace(/\/$/g, "").split("/").pop() ?? "",
      path: directory,
    }]
    if (depth !== "0") {
      for (const child of this.directories) {
        if (child !== directory && parentDirectoryOf(child) === directory) {
          rows.push({
            collection: true,
            displayName: child.replace(/\/$/g, "").split("/").pop() ?? "",
            path: child,
          })
        }
      }
      for (const [filePath, file] of this.files) {
        if (parentDirectoryOf(filePath) === directory) {
          rows.push({
            collection: false,
            displayName: filePath.split("/").pop() ?? "",
            etag: file.etag,
            path: filePath,
          })
        }
      }
    }

    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">${rows.map((row) => `
  <d:response>
    <d:href>${escapeXml(encodeHrefPath(row.path))}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>${escapeXml(row.displayName)}</d:displayname>
        <d:resourcetype>${row.collection ? "<d:collection/>" : ""}</d:resourcetype>
        <d:getlastmodified>Mon, 14 Sep 2026 00:00:00 GMT</d:getlastmodified>
        ${row.etag ? `<d:getetag>${escapeXml(row.etag)}</d:getetag>` : ""}
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`).join("")}
</d:multistatus>`
    return route.fulfill({ body, contentType: "application/xml; charset=utf-8", headers: CORS_HEADERS, status: 207 })
  }

  private handleGet(route: Route, path: string) {
    if (path === FOLDER_ORDER_PATH && this.staleFolderOrderSnapshot) {
      const snapshot = this.staleFolderOrderSnapshot
      this.staleFolderOrderSnapshot = null
      return route.fulfill({
        body: snapshot.content,
        contentType: "application/json; charset=utf-8",
        headers: { ...CORS_HEADERS, ETag: snapshot.etag },
        status: 200,
      })
    }
    const file = this.files.get(path)
    if (!file) return route.fulfill({ body: "not found", headers: CORS_HEADERS, status: 404 })
    return route.fulfill({ body: file.content, headers: { ...CORS_HEADERS, ETag: file.etag }, status: 200 })
  }

  private handlePut(route: Route, path: string, headers: Record<string, string>, body: string) {
    const existing = this.files.get(path)
    if (headers["if-none-match"] === "*" && existing) return route.fulfill({ body: "already exists", headers: CORS_HEADERS, status: 412 })
    const ifMatch = headers["if-match"]
    if (ifMatch && (!existing || existing.etag !== ifMatch)) return route.fulfill({ body: "etag mismatch", headers: CORS_HEADERS, status: 412 })
    const parent = parentDirectoryOf(path)
    if (!this.directories.has(parent)) return route.fulfill({ body: "parent missing", headers: CORS_HEADERS, status: 409 })

    const etag = this.nextEtag()
    this.files.set(path, { content: body, etag })
    if (path === FOLDER_ORDER_PATH) this.folderOrderHistory.push({ content: body, etag })
    return route.fulfill({ headers: { ...CORS_HEADERS, ETag: etag }, status: existing ? 204 : 201 })
  }
}

export async function connectMockWebDav(page: Page) {
  await page.goto("/#/settings/webdav")
  await page.locator("#webdav-server").fill(SERVER_URL)
  await page.locator("#webdav-username").fill(USERNAME)
  await page.locator("#webdav-password").fill(PASSWORD)
  await page.locator("#webdav-path").fill(REMOTE_ROOT)
  await page.getByRole("button", { name: "连接并同步" }).click()
  await expect(page.getByRole("button", { name: "同步当前笔记库" })).toBeVisible({ timeout: 15_000 })
}

