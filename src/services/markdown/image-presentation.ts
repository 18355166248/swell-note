export type ImageWidth = number | "auto"

// 尺寸独立放在紧邻图片的 HTML 注释里，普通 Markdown 阅读器会忽略它，title 仍是说明。
// auto 必须显式保存：旧图片的数值 title 仍要兼容，不能一删元数据就又恢复旧宽度。
const WIDTH_COMMENT = /^<!-- swell-image:width=(auto|[1-9]\d{0,4}) -->/

export function readImageWidthComment(text: string): { length: number; width: ImageWidth } | null {
  const match = WIDTH_COMMENT.exec(text)
  if (!match) return null
  return { length: match[0].length, width: match[1] === "auto" ? "auto" : Number(match[1]) }
}

export function imageWidthComment(width: ImageWidth) {
  return `<!-- swell-image:width=${width} -->`
}

export function legacyImageWidth(title?: string) {
  const match = title?.match(/^(\d+)(?:x(\d+))?$/)
  return match ? Number(match[1]) : undefined
}

export function unescapeMarkdownImageText(text: string) {
  return text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1")
}

export function buildImageReference(alt: string, source: string, title?: string, width?: ImageWidth) {
  const label = alt.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]")
  const path = source.replace(/[\s()<>]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  const description = title ? ` "${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : ""
  return `![${label}](${path}${description})${width === undefined ? "" : imageWidthComment(width)}`
}

type ImageNode = {
  type: string
  value?: string
  children?: ImageNode[]
  data?: { hProperties?: Record<string, unknown> }
}

// 只识别紧邻图片且完整匹配的私有注释，不执行任意 HTML，也不影响用户普通注释。
export function remarkImagePresentation() {
  return (tree: ImageNode) => {
    const visit = (node: ImageNode) => {
      const children = node.children
      if (!children) return
      for (let index = 0; index < children.length - 1; index++) {
        const image = children[index], comment = children[index + 1]
        if (image.type !== "image" || comment.type !== "html" || !comment.value) continue
        const parsed = readImageWidthComment(comment.value)
        if (!parsed || parsed.length !== comment.value.length) continue
        image.data = { ...image.data, hProperties: { ...image.data?.hProperties, "data-image-width": String(parsed.width) } }
        children.splice(index + 1, 1)
      }
      children.forEach(visit)
    }
    visit(tree)
  }
}
