import LZString from "lz-string"

export type ExcalidrawScene = {
  appState?: Record<string, unknown>
  elements: readonly Record<string, unknown>[]
  files?: Record<string, unknown>
  source?: string
  type?: string
  version?: number
}

const COMPRESSED_DRAWING = /```compressed-json\s*([\s\S]*?)```/i
const JSON_DRAWING = /```json\s*([\s\S]*?)```/i

export function parseExcalidrawMarkdown(content: string): ExcalidrawScene {
  const drawingIndex = content.search(/^## Drawing\s*$/m)
  if (drawingIndex < 0) throw new Error("找不到 Excalidraw Drawing 数据段")

  // 只解析 Drawing 段，避免正文中的普通 JSON 代码块被误认为画布数据。
  const drawingContent = content.slice(drawingIndex)
  const compressed = drawingContent.match(COMPRESSED_DRAWING)?.[1]
  const rawJson = compressed
    ? LZString.decompressFromBase64(compressed.replace(/\s/g, ""))
    : drawingContent.match(JSON_DRAWING)?.[1]

  if (!rawJson) throw new Error("找不到可读取的 Excalidraw 画布数据")

  let scene: unknown
  try {
    scene = JSON.parse(rawJson)
  } catch {
    throw new Error("Excalidraw 画布数据已损坏或格式不受支持")
  }

  if (!isExcalidrawScene(scene)) throw new Error("Excalidraw 画布缺少 elements 数据")
  return scene
}

function isExcalidrawScene(value: unknown): value is ExcalidrawScene {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ExcalidrawScene).elements))
}
