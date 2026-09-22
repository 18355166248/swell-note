export const NOTE_PINS_MAX_BYTES = 256 * 1024
const MAX_PINS = 5_000

export type NotePinsDocument = {
  schemaVersion: 1
  pins: string[]
  [extra: string]: unknown
}

// 远端只记录库内相对文件路径，不能包含机器绝对路径或越出笔记库的段。
export function isNotePinPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 4096
    && !/^[a-zA-Z]:/.test(path) && !/[\\\u0000]/.test(path)
    && path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
    && !path.startsWith(".swell/")
}

export function parseNotePinsDocument(bytes: Uint8Array): NotePinsDocument {
  if (bytes.byteLength > NOTE_PINS_MAX_BYTES) throw new Error("置顶配置超过大小上限，已保留本机状态")
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new Error("置顶配置不是有效的 UTF-8 JSON，已保留本机状态")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("置顶配置格式无效")
  const document = value as Record<string, unknown>
  // 不把损坏配置或未来版本当作空列表覆盖；同版本未知字段随原文保留。
  if (document.schemaVersion !== 1) throw new Error("置顶配置版本不受支持，请升级应用后重试")
  if (!Array.isArray(document.pins) || document.pins.length > MAX_PINS || !document.pins.every(isNotePinPath)) {
    throw new Error("置顶配置包含非法路径或超出条目上限")
  }
  return { ...document, schemaVersion: 1, pins: [...new Set(document.pins)] }
}

export function serializeNotePinsDocument(base: NotePinsDocument | null, pins: ReadonlySet<string>) {
  const body = JSON.stringify({ ...base, schemaVersion: 1, pins: [...pins].sort() })
  parseNotePinsDocument(new TextEncoder().encode(body))
  return body
}
