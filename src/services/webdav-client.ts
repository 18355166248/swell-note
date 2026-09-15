import type { WebDavConfig } from "@/lib/webdav-config"
import { isTauri } from "@tauri-apps/api/core"
import { fetch as nativeFetch } from "@tauri-apps/plugin-http"

const MAX_DIRECTORIES = 200
const MAX_MARKDOWN_FILES = 2_000

export type WebDavFile = {
  lastModified?: string
  name: string
  path: string
  revision?: string
}

type WebDavEntry = WebDavFile & {
  directory: boolean
}

export async function listMarkdownFiles(
  config: WebDavConfig,
  password: string,
): Promise<WebDavFile[]> {
  const queue = [config.remotePath]
  const visited = new Set<string>()
  const markdownFiles: WebDavFile[] = []

  // 坚果云有请求频率限制，因此串行扫描目录，并设置明确上限防止误扫整个网盘。
  while (queue.length > 0 && visited.size < MAX_DIRECTORIES) {
    const directoryPath = queue.shift()
    if (!directoryPath || visited.has(directoryPath)) continue

    visited.add(directoryPath)
    const entries = await listDirectory(config, password, directoryPath)

    for (const entry of entries) {
      if (entry.directory) {
        if (!isIgnoredDirectory(entry.name)) queue.push(ensureTrailingSlash(entry.path))
        continue
      }

      if (/\.(?:canvas|md)$/i.test(entry.name)) {
        markdownFiles.push(entry)
        if (markdownFiles.length >= MAX_MARKDOWN_FILES) return markdownFiles
      }
    }
  }

  return markdownFiles.sort((left, right) =>
    (right.lastModified ?? "").localeCompare(left.lastModified ?? ""),
  )
}

export async function readMarkdownDocument(
  config: WebDavConfig,
  password: string,
  path: string,
) {
  const response = await webDavFetch(config, password, path, { method: "GET" })
  return {
    content: await response.text(),
    revision: response.headers.get("etag") ?? undefined,
  }
}

export async function writeMarkdownFile(
  config: WebDavConfig,
  password: string,
  path: string,
  content: string,
  expectedRevision: string,
) {
  const response = await webDavFetch(config, password, path, {
    body: content,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "If-Match": expectedRevision,
    },
    method: "PUT",
  })
  return { revision: response.headers.get("etag") ?? expectedRevision }
}

export async function createMarkdownFile(
  config: WebDavConfig,
  password: string,
  path: string,
  content: string,
) {
  const response = await webDavFetch(config, password, path, {
    body: content,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // 离线期间其他设备可能已创建同名文件，条件创建确保绝不覆盖。
      "If-None-Match": "*",
    },
    method: "PUT",
  })
  return { revision: response.headers.get("etag") ?? undefined }
}

export async function createWebDavBinaryFile(
  config: WebDavConfig,
  password: string,
  path: string,
  data: Uint8Array,
  mimeType?: string,
) {
  const response = await webDavFetch(config, password, path, {
    body: data,
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
      // 附件名包含唯一后缀，同时仍使用条件创建防止多设备意外覆盖。
      "If-None-Match": "*",
    },
    method: "PUT",
  })
  return { revision: response.headers.get("etag") ?? undefined }
}

export async function deleteMarkdownFile(
  config: WebDavConfig,
  password: string,
  path: string,
  expectedRevision: string,
) {
  await webDavFetch(config, password, path, {
    headers: { "If-Match": expectedRevision },
    method: "DELETE",
  })
}

export async function moveMarkdownFile(
  config: WebDavConfig,
  password: string,
  path: string,
  targetPath: string,
  expectedRevision: string,
) {
  // Destination 必须是远端绝对地址；浏览器开发代理只用于承载请求本身。
  const response = await webDavFetch(config, password, path, {
    headers: {
      Destination: buildRemoteUrl(config, targetPath),
      "If-Match": expectedRevision,
      Overwrite: "F",
    },
    method: "MOVE",
  })
  return { revision: response.headers.get("etag") ?? expectedRevision }
}

export async function ensureWebDavDirectory(
  config: WebDavConfig,
  password: string,
  directoryPath: string,
) {
  const rootPath = normalizePath(config.remotePath).replace(/\/+$/g, "")
  const targetPath = normalizePath(directoryPath).replace(/\/+$/g, "")
  if (targetPath === rootPath) return
  if (!targetPath.startsWith(`${rootPath}/`)) throw new Error("目标目录超出当前笔记库范围")

  let currentPath = rootPath
  for (const segment of targetPath.slice(rootPath.length + 1).split("/").filter(Boolean)) {
    currentPath = `${currentPath}/${segment}`
    // WebDAV 用 405 表示目录已经存在；逐级 MKCOL 可兼容首次创建嵌套目录。
    await webDavFetch(config, password, currentPath, { method: "MKCOL" }, [405])
  }
}

export async function readWebDavAsset(
  config: WebDavConfig,
  password: string,
  path: string,
) {
  const response = await webDavFetch(config, password, path, { method: "GET" })
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? undefined,
  }
}

// ---- 专用 JSON 元数据接口（.swell/folder-order.json）----
// 与 Markdown 接口的区别：404 是可区分的“缺失”而不是普通错误；更新失败不回落旧 ETag；
// 状态码全部可程序化区分，不通过中文错误字符串匹配。

export class WebDavHttpError extends Error {
  readonly status: number

  constructor(status: number, message?: string) {
    super(message ?? `坚果云请求失败（HTTP ${status}）`)
    this.name = "WebDavHttpError"
    this.status = status
  }
}

export class WebDavContentTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WebDavContentTooLargeError"
  }
}

export type WebDavJsonDocument = {
  bytes: Uint8Array
  // 服务端返回的 ETag 原文；弱 ETag（W/ 前缀）单独标记，不能去掉 W/ 冒充强 ETag 用于 If-Match。
  etag: string | null
  etagWeak: boolean
}

export type WebDavJsonWriteResult = {
  // PUT 可能不返回新 ETag：返回 null，调用方必须 GET 读回核对，绝不能沿用旧 ETag 表示新版本。
  etag: string | null
  etagWeak: boolean
}

function jsonResponseEtag(response: Response): WebDavJsonWriteResult {
  const etag = response.headers.get("etag")
  return { etag, etagWeak: Boolean(etag?.startsWith("W/")) }
}

function throwForJsonErrorStatus(response: Response, path: string): never {
  if (response.status === 401) throw new WebDavAuthenticationError()
  if (response.status === 412) throw new WebDavRevisionConflictError(path)
  if (response.status === 403) throw new WebDavHttpError(403, "坚果云拒绝了本次请求（HTTP 403），请检查账号权限")
  if (response.status === 404) throw new WebDavHttpError(404, `远端资源不存在：${path}`)
  if (response.status === 429) throw new WebDavHttpError(429, "坚果云请求过于频繁，请稍后再试")
  throw new WebDavHttpError(response.status)
}

// GET 读取 JSON 与 ETag；404 返回 null 表示缺失。读取按实际字节数执行上限，不能只信 Content-Length。
export async function readJsonDocument(
  config: WebDavConfig,
  password: string,
  path: string,
  maxBytes: number,
): Promise<WebDavJsonDocument | null> {
  const response = await webDavRawFetch(config, password, path, {
    headers: { "Cache-Control": "no-cache" },
    method: "GET",
  })
  if (response.status === 404) return null
  if (!response.ok) throwForJsonErrorStatus(response, path)
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new WebDavContentTooLargeError("远端排序配置超出大小上限，已保留本机顺序")
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > maxBytes) {
    throw new WebDavContentTooLargeError("远端排序配置超出大小上限，已保留本机顺序")
  }
  return { bytes, ...jsonResponseEtag(response) }
}

// 条件创建：If-None-Match: *，已存在时抛 WebDavRevisionConflictError，绝不覆盖。
export async function createJsonDocument(
  config: WebDavConfig,
  password: string,
  path: string,
  body: string,
): Promise<WebDavJsonWriteResult> {
  const response = await webDavRawFetch(config, password, path, {
    body,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "If-None-Match": "*",
    },
    method: "PUT",
  })
  if (!response.ok) throwForJsonErrorStatus(response, path)
  return jsonResponseEtag(response)
}

// 条件更新：If-Match 必须使用强 ETag（RFC 9110 §13.1.1 强比较）；弱 ETag 在调用前就应被拦截。
export async function updateJsonDocument(
  config: WebDavConfig,
  password: string,
  path: string,
  body: string,
  expectedEtag: string,
): Promise<WebDavJsonWriteResult> {
  if (expectedEtag.startsWith("W/")) {
    throw new Error("弱 ETag 不能用于 If-Match 条件更新")
  }
  const response = await webDavRawFetch(config, password, path, {
    body,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "If-Match": expectedEtag,
    },
    method: "PUT",
  })
  if (!response.ok) throwForJsonErrorStatus(response, path)
  return jsonResponseEtag(response)
}

// 确认目录存在（Depth:0 PROPFIND，开销最小）：404 返回 false，其余状态照常抛错。
// 配置 404 只有配合根目录存在才能视为“配置被重置”；根目录丢失或身份错误不能当作重置。
export async function checkWebDavDirectoryExists(
  config: WebDavConfig,
  password: string,
  directoryPath: string,
): Promise<boolean> {
  const response = await webDavRawFetch(config, password, directoryPath, {
    body: `<?xml version="1.0" encoding="utf-8" ?>
      <d:propfind xmlns:d="DAV:">
        <d:prop><d:resourcetype /></d:prop>
      </d:propfind>`,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "0",
    },
    method: "PROPFIND",
  })
  if (response.status === 404) return false
  if (response.status === 401) throw new WebDavAuthenticationError()
  if (!response.ok && response.status !== 207) throwForJsonErrorStatus(response, directoryPath)
  return true
}

async function listDirectory(
  config: WebDavConfig,
  password: string,
  directoryPath: string,
) {
  const response = await webDavFetch(config, password, directoryPath, {
    body: `<?xml version="1.0" encoding="utf-8" ?>
      <d:propfind xmlns:d="DAV:">
        <d:prop>
          <d:displayname />
          <d:resourcetype />
          <d:getlastmodified />
          <d:getetag />
        </d:prop>
      </d:propfind>`,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
    },
    method: "PROPFIND",
  })

  const xml = new DOMParser().parseFromString(await response.text(), "application/xml")
  if (xml.querySelector("parsererror")) throw new Error("坚果云返回了无法解析的目录数据")

  const requestedPath = normalizePath(directoryPath)
  return Array.from(xml.getElementsByTagNameNS("DAV:", "response")).flatMap(
    (responseNode): WebDavEntry[] => {
      const href = responseNode.getElementsByTagNameNS("DAV:", "href")[0]?.textContent
      if (!href) return []

      const path = pathFromHref(href, config.serverUrl)
      if (normalizePath(path) === requestedPath) return []

      const displayName = responseNode.getElementsByTagNameNS("DAV:", "displayname")[0]?.textContent
      const directory = responseNode.getElementsByTagNameNS("DAV:", "collection").length > 0
      const pathSegments = path.split("/").filter(Boolean)
      const name = displayName || pathSegments[pathSegments.length - 1] || path
      const lastModified = responseNode.getElementsByTagNameNS("DAV:", "getlastmodified")[0]?.textContent
      const revision = responseNode.getElementsByTagNameNS("DAV:", "getetag")[0]?.textContent

      return [{ directory, lastModified: lastModified ?? undefined, name, path, revision: revision ?? undefined }]
    },
  )
}

// 传输与认证共用入口：只把网络层异常统一成 WebDavNetworkError，状态码交给调用方区分。
async function webDavRawFetch(
  config: WebDavConfig,
  password: string,
  path: string,
  init: RequestInit,
) {
  // 原生包通过 Rust HTTP 客户端请求 WebDAV，规避各平台 WebView 的 CORS 差异；Web 预览仍走同源代理。
  const request = isTauri() ? nativeFetch : fetch
  try {
    return await request(buildRequestUrl(config, path), {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Basic ${encodeBasicAuth(config.username, password)}`,
      },
    })
  } catch {
    // 不透传底层 fetch/native HTTP 错误，避免泄露请求信息并给出可执行的恢复提示。
    throw new WebDavNetworkError()
  }
}

async function webDavFetch(
  config: WebDavConfig,
  password: string,
  path: string,
  init: RequestInit,
  acceptedStatuses: number[] = [],
) {
  const response = await webDavRawFetch(config, password, path, init)

  if (response.ok || response.status === 207 || acceptedStatuses.includes(response.status)) return response
  if (response.status === 401) throw new WebDavAuthenticationError()
  if (response.status === 404) throw new Error(`远端目录不存在：${config.remotePath}`)
  if (response.status === 412) throw new WebDavRevisionConflictError(path)
  if (response.status === 429) throw new Error("坚果云请求过于频繁，请稍后再试")
  throw new Error(`坚果云请求失败（HTTP ${response.status}）`)
}

export class WebDavAuthenticationError extends Error {
  constructor() {
    super("账号或第三方应用密码不正确")
    this.name = "WebDavAuthenticationError"
  }
}

export class WebDavNetworkError extends Error {
  constructor() {
    super("无法连接坚果云，请检查网络后重试；本地修改不会丢失")
    this.name = "WebDavNetworkError"
  }
}

export class WebDavRevisionConflictError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`远端文件已经更新：${path}`)
    this.name = "WebDavRevisionConflictError"
    this.path = path
  }
}

function buildRequestUrl(config: WebDavConfig, path: string) {
  const encodedPath = encodePath(path)
  const server = new URL(config.serverUrl)

  if (!isTauri() && server.hostname === "dav.jianguoyun.com") {
    // 真实 WebDAV 集成测试只在显式测试模式下直连；浏览器生产包仍必须经过同源代理。
    if (import.meta.env.MODE === "test" && import.meta.env.VITE_WEBDAV_E2E_DIRECT === "1") {
      return buildRemoteUrl(config, path)
    }
    const configuredProxy = import.meta.env.VITE_WEBDAV_PROXY_URL?.trim()
    // Web 生产环境不能依赖坚果云的跨域策略；统一走部署方控制的同源代理，避免上线后静默失效。
    if (configuredProxy) return buildProxyUrl(configuredProxy, encodedPath)
    if (import.meta.env.DEV) return `/api/webdav${encodedPath}`
    throw new Error("Web 版本尚未配置安全的 WebDAV 代理，请联系部署管理员")
  }

  return buildRemoteUrl(config, path)
}

function buildProxyUrl(proxyUrl: string, encodedPath: string) {
  const normalizedProxy = proxyUrl.endsWith("/") ? proxyUrl.slice(0, -1) : proxyUrl
  return `${normalizedProxy}${encodedPath}`
}

function buildRemoteUrl(config: WebDavConfig, path: string) {
  return new URL(encodePath(path).replace(/^\//, ""), config.serverUrl).toString()
}

function pathFromHref(href: string, serverUrl: string) {
  const serverPath = ensureTrailingSlash(new URL(serverUrl).pathname)
  const hrefPath = new URL(href, serverUrl).pathname
  const relativePath = hrefPath.startsWith(serverPath)
    ? hrefPath.slice(serverPath.length)
    : hrefPath.replace(/^\/+/, "")

  try {
    return `/${decodeURIComponent(relativePath)}`
  } catch {
    return `/${relativePath}`
  }
}

function encodePath(path: string) {
  return normalizePath(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function encodeBasicAuth(username: string, password: string) {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function normalizePath(path: string) {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`
  return withLeadingSlash.replace(/\/{2,}/g, "/")
}

function ensureTrailingSlash(path: string) {
  return path.endsWith("/") ? path : `${path}/`
}

function isIgnoredDirectory(name: string) {
  return name.startsWith(".") || name === "node_modules"
}
