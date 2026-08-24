export const ATTACHMENT_DIRECTORY = "attachments"

// 移动端把整个附件读进内存后再写盘，超过该体积的文件容易在低端设备触发崩溃。
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const imageMimePattern = /^image\//i
const imageExtensionPattern = /^(avif|gif|jpe?g|png|svg|webp)$/i
// 文件名只保留跨平台与 Markdown 链接都安全的字符，因此生成的相对路径无需再做百分号编码。
const unsafeNamePattern = /[^\p{Letter}\p{Number}._-]+/gu

const extensionByMimeType = new Map([
  ["image/avif", "avif"],
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
])

export function isImageAttachment(mimeType: string | undefined, fileName: string) {
  if (mimeType && imageMimePattern.test(mimeType)) return true
  return imageExtensionPattern.test(splitFileName(fileName).extension)
}

type AttachmentFileNameOptions = {
  duplicateIndex?: number
  fileName: string
  mimeType?: string
  now?: Date
}

export function buildAttachmentFileName({
  duplicateIndex = 0,
  fileName,
  mimeType,
  now = new Date(),
}: AttachmentFileNameOptions) {
  const { baseName, extension } = splitFileName(fileName)
  const safeBaseName = sanitizeNameSegment(baseName)
    || (isImageAttachment(mimeType, fileName) ? "image" : "attachment")
  const safeExtension = sanitizeNameSegment(extension).toLocaleLowerCase()
    || extensionByMimeType.get(mimeType?.split(";", 1)[0].trim().toLocaleLowerCase() ?? "")
    || "bin"
  // 时间戳保证不同批次不会互相覆盖；同一秒内的多个文件再用序号区分。
  const suffix = duplicateIndex > 0 ? `-${duplicateIndex + 1}` : ""
  return `${safeBaseName}-${formatTimestamp(now)}${suffix}.${safeExtension}`
}

export function buildAttachmentVaultPath(fileName: string) {
  return `${ATTACHMENT_DIRECTORY}/${fileName}`
}

export function buildAttachmentHref(noteDisplayPath: string, attachmentDisplayPath: string) {
  const noteSegments = splitDisplayPath(noteDisplayPath).slice(0, -1)
  const attachmentSegments = splitDisplayPath(attachmentDisplayPath)

  let sharedCount = 0
  while (
    sharedCount < noteSegments.length
    && sharedCount < attachmentSegments.length - 1
    && noteSegments[sharedCount] === attachmentSegments[sharedCount]
  ) {
    sharedCount += 1
  }

  return [
    ...Array.from({ length: noteSegments.length - sharedCount }, () => ".."),
    ...attachmentSegments.slice(sharedCount),
  ].join("/")
}

export function buildAttachmentMarkdown(label: string, href: string, image: boolean) {
  return `${image ? "!" : ""}[${label.replace(/[[\]]/g, "")}](${href})`
}

function splitDisplayPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean)
}

function splitFileName(fileName: string) {
  const name = fileName.replace(/\\/g, "/").split("/").pop() ?? ""
  const dotIndex = name.lastIndexOf(".")
  return dotIndex > 0
    ? { baseName: name.slice(0, dotIndex), extension: name.slice(dotIndex + 1) }
    : { baseName: name, extension: "" }
}

function sanitizeNameSegment(value: string) {
  return value
    .trim()
    .replace(unsafeNamePattern, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 60)
    .replace(/^[-.]+|[-.]+$/g, "")
}

function formatTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0")
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("")
}
