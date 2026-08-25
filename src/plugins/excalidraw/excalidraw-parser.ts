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

export function serializeExcalidrawMarkdown(content: string, scene: ExcalidrawScene) {
  const drawingIndex = content.search(/^## Drawing\s*$/m)
  if (drawingIndex < 0) throw new Error("找不到 Excalidraw Drawing 数据段")

  const drawingContent = content.slice(drawingIndex)
  const serialized = JSON.stringify(scene)
  const replacement = drawingContent.match(COMPRESSED_DRAWING)
    ? drawingContent.replace(COMPRESSED_DRAWING, `\`\`\`compressed-json\n${LZString.compressToBase64(serialized)}\n\`\`\``)
    : drawingContent.match(JSON_DRAWING)
      ? drawingContent.replace(JSON_DRAWING, `\`\`\`json\n${serialized}\n\`\`\``)
      : null

  if (!replacement) throw new Error("找不到可写入的 Excalidraw 画布数据")
  const updated = content.slice(0, drawingIndex) + replacement
  return updateTextElementsSection(updated, scene)
}

function updateTextElementsSection(content: string, scene: ExcalidrawScene) {
  const drawingIndex = content.search(/^## Drawing\s*$/m)
  const beforeDrawing = content.slice(0, drawingIndex)
  const headings = [...beforeDrawing.matchAll(/^##? Text Elements\s*$/gm)]
  const heading = headings[headings.length - 1]
  if (!heading || heading.index === undefined) return content

  const bodyStart = heading.index + heading[0].length
  const currentBody = beforeDrawing.slice(bodyStart)
  const delimiterIndex = currentBody.lastIndexOf("%%")
  const bodyWithoutDelimiter = delimiterIndex >= 0 ? currentBody.slice(0, delimiterIndex) : currentBody
  // 非标准文件若在 Text Elements 与 Drawing 之间还有其他章节，则只更新画布数据，避免覆盖用户正文。
  if (/^#{1,6}\s+/m.test(bodyWithoutDelimiter)) return content

  const textLines = scene.elements.flatMap((element) => {
    const text = typeof element.text === "string" ? element.text.trim() : ""
    const id = typeof element.id === "string" ? element.id : ""
    return element.type === "text" && !element.isDeleted && text && id ? [`${text} ^${id}`] : []
  })
  const delimiter = delimiterIndex >= 0 ? currentBody.slice(delimiterIndex).trim() : ""
  const nextSection = `${heading[0]}\n${textLines.join("\n\n")}${textLines.length ? "\n" : ""}${delimiter ? `\n${delimiter}\n` : "\n"}`
  return content.slice(0, heading.index) + nextSection + content.slice(drawingIndex)
}

function isExcalidrawScene(value: unknown): value is ExcalidrawScene {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ExcalidrawScene).elements))
}
