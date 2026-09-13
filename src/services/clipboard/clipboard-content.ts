import { invoke, isTauri } from "@tauri-apps/api/core"

import { MAX_ATTACHMENT_BYTES } from "@/services/vault/attachment-path"

export type ClipboardContent = { files: File[]; text: string | null }

export class ClipboardReadError extends Error {}

type NativeClipboardContent = { pngBase64: string | null; text: string | null }

// files 与 items 在不同 WebView 中可能只填一个，也可能指向同一文件；按对象与文件特征去重，
// 既补齐 Safari/Tauri 的 getAsFile 路径，也避免同一张截图写盘两次。
export function collectClipboardFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return []
  const files = Array.from(transfer.files ?? [])
  const unmatchedFileKeys = new Map<string, number>()
  for (const file of files) {
    const key = clipboardFileKey(file)
    unmatchedFileKeys.set(key, (unmatchedFileKeys.get(key) ?? 0) + 1)
  }
  const seenItemObjects = new Set<File>()
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file") continue
    const file = item.getAsFile()
    if (!file || seenItemObjects.has(file)) continue
    seenItemObjects.add(file)
    const key = clipboardFileKey(file)
    const duplicateCount = unmatchedFileKeys.get(key) ?? 0
    if (duplicateCount > 0) {
      unmatchedFileKeys.set(key, duplicateCount - 1)
      continue
    }
    files.push(file)
  }
  return files
}

function clipboardFileKey(file: File) {
  return `${file.name}\0${file.type}\0${file.size}\0${file.lastModified}`
}

export function readClipboardEvent(transfer: DataTransfer | null): ClipboardContent & { html: string | null } {
  const text = transfer?.getData("text/plain") || null
  const html = transfer?.getData("text/html") || null
  return { files: collectClipboardFiles(transfer), html, text }
}

export function validateClipboardFiles(files: File[]) {
  for (const file of files) {
    if (!file.size) throw new ClipboardReadError("剪贴板图片为空")
    if (file.size > MAX_ATTACHMENT_BYTES) throw new ClipboardReadError("剪贴板文件超过 20 MB，无法插入")
  }
}

export async function readClipboardContent(): Promise<ClipboardContent> {
  try {
    // 移动端原生命令按平台约定不读剪贴板；直接保留 readText，且不先 await 无用命令消耗用户激活。
    if (isTauri() && isMobileDevice()) return await fromBrowserText()
    // 原生截图命令仅在 macOS 实现；该平台避免 WebView Clipboard API 额外弹权限或读不到系统截图。
    if (isTauri()) {
      if (isMacDesktop()) return fromNative(await invoke<NativeClipboardContent>("read_clipboard_content"))
      return await fromBrowserClipboard()
    }
    return await fromBrowserClipboard()
  } catch (error) {
    if (error instanceof ClipboardReadError) throw error
    if (isTauri() && typeof error === "string" && error.trim()) throw new ClipboardReadError(error)
    if (isTauri() && error instanceof Error && error.message) throw new ClipboardReadError(error.message)
    throw new ClipboardReadError("读取剪贴板失败，请允许访问后重试")
  }
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/MacIntel/i.test(navigator.platform) && navigator.maxTouchPoints > 1)
}

function isMacDesktop() {
  return /Mac/i.test(navigator.platform)
}

async function fromBrowserText(): Promise<ClipboardContent> {
  if (!navigator.clipboard?.readText) return { files: [], text: null }
  return { files: [], text: await navigator.clipboard.readText() || null }
}

async function fromBrowserClipboard(): Promise<ClipboardContent> {
  if (navigator.clipboard?.read) {
    const items = await navigator.clipboard.read()
    const textParts: string[] = []
    for (const item of items) {
      if (item.types.includes("text/plain")) textParts.push(await (await item.getType("text/plain")).text())
    }
    const text = textParts.join("") || null
    // 网页通常同时提供文字和图片 representation；已有文字时无需读取大图片，更不能因图片失败丢掉文字。
    if (text) return { files: [], text }
    const files: File[] = []
    for (const item of items) {
      // 一个 ClipboardItem 的 PNG/JPEG 通常是同一张图的多种 representation，只取一种；
      // 不同 item 仍各保留一张，所以一次复制多图不会被合并。
      const imageTypes = item.types.filter((type) => type.startsWith("image/"))
      const type = imageTypes.includes("image/png") ? "image/png" : imageTypes[0]
      if (!type) continue
      const blob = await item.getType(type)
      assertImageSize(blob.size)
      files.push(new File([blob], screenshotFileName(type), { type }))
    }
    return { files, text: null }
  }
  if (!navigator.clipboard?.readText) throw new ClipboardReadError("当前浏览器不支持读取剪贴板图片")
  return { files: [], text: await navigator.clipboard.readText() || null }
}

function fromNative(content: NativeClipboardContent): ClipboardContent {
  // 原生命令已经遵循“文字优先”；即使异常平台同时返回两者，也保持该约定，避免网页文字被误当截图。
  if (content.text) return { files: [], text: content.text }
  if (!content.pngBase64) return { files: [], text: null }
  const binary = atob(content.pngBase64)
  assertImageSize(binary.length)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return { files: [new File([bytes], screenshotFileName("image/png"), { type: "image/png" })], text: null }
}

function assertImageSize(bytes: number) {
  if (!bytes) throw new ClipboardReadError("剪贴板图片为空")
  if (bytes > MAX_ATTACHMENT_BYTES) throw new ClipboardReadError("剪贴板图片超过 20 MB，无法插入")
}

function screenshotFileName(type: string) {
  const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1]?.replace("svg+xml", "svg") || "png"
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 15)
  return `截图-${stamp}.${extension}`
}
