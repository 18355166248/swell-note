import type { WebDavConfig } from "@/lib/webdav-config"

const MAX_DIRECTORIES = 200
const MAX_MARKDOWN_FILES = 2_000

export type WebDavFile = {
  lastModified?: string
  name: string
  path: string
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

      if (entry.name.toLocaleLowerCase().endsWith(".md")) {
        markdownFiles.push(entry)
        if (markdownFiles.length >= MAX_MARKDOWN_FILES) return markdownFiles
      }
    }
  }

  return markdownFiles.sort((left, right) =>
    (right.lastModified ?? "").localeCompare(left.lastModified ?? ""),
  )
}

export async function readMarkdownFile(
  config: WebDavConfig,
  password: string,
  path: string,
) {
  const response = await webDavFetch(config, password, path, { method: "GET" })
  return response.text()
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

      return [{ directory, lastModified: lastModified ?? undefined, name, path }]
    },
  )
}

async function webDavFetch(
  config: WebDavConfig,
  password: string,
  path: string,
  init: RequestInit,
) {
  const response = await fetch(buildRequestUrl(config, path), {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Basic ${encodeBasicAuth(config.username, password)}`,
    },
  })

  if (response.ok || response.status === 207) return response
  if (response.status === 401) throw new Error("账号或第三方应用密码不正确")
  if (response.status === 404) throw new Error(`远端目录不存在：${config.remotePath}`)
  if (response.status === 429) throw new Error("坚果云请求过于频繁，请稍后再试")
  throw new Error(`坚果云请求失败（HTTP ${response.status}）`)
}

function buildRequestUrl(config: WebDavConfig, path: string) {
  const encodedPath = encodePath(path)
  const server = new URL(config.serverUrl)

  // 浏览器开发预览经 Vite 同源代理访问，原生端后续切换到 Tauri HTTP 插件。
  if (import.meta.env.DEV && server.hostname === "dav.jianguoyun.com") {
    return `/api/webdav${encodedPath}`
  }

  return new URL(encodedPath.replace(/^\//, ""), config.serverUrl).toString()
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
