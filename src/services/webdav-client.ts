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

async function webDavFetch(
  config: WebDavConfig,
  password: string,
  path: string,
  init: RequestInit,
  acceptedStatuses: number[] = [],
) {
  // 原生包通过 Rust HTTP 客户端请求 WebDAV，规避各平台 WebView 的 CORS 差异；Web 预览仍走同源代理。
  const request = isTauri() ? nativeFetch : fetch
  const response = await request(buildRequestUrl(config, path), {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Basic ${encodeBasicAuth(config.username, password)}`,
    },
  })

  if (response.ok || response.status === 207 || acceptedStatuses.includes(response.status)) return response
  if (response.status === 401) throw new Error("账号或第三方应用密码不正确")
  if (response.status === 404) throw new Error(`远端目录不存在：${config.remotePath}`)
  if (response.status === 412) throw new WebDavRevisionConflictError(path)
  if (response.status === 429) throw new Error("坚果云请求过于频繁，请稍后再试")
  throw new Error(`坚果云请求失败（HTTP ${response.status}）`)
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
