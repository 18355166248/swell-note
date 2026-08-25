import { parseWikiEmbedHref } from "./markdown-preview-utils"

type MdNode = {
  children?: MdNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown> }
  type: string
  url?: string
  value?: string
}

function textContent(node: MdNode): string {
  return node.value ?? node.children?.map(textContent).join("") ?? ""
}

function transformBlockquote(node: MdNode) {
  const firstParagraph = node.children?.[0]
  const firstText = firstParagraph?.children?.[0]
  if (firstParagraph?.type !== "paragraph" || firstText?.type !== "text" || !firstText.value) return

  const marker = firstText.value.match(/^\[!([\w-]+)\]([+-])?(?:[ \t]+([^\n]+))?(?:\n|$)/i)
  if (!marker) return
  const [, rawType, fold, customTitle] = marker
  const calloutType = rawType.toLocaleLowerCase()
  firstText.value = firstText.value.slice(marker[0].length)
  if (!firstText.value && firstParagraph.children) firstParagraph.children.shift()
  if (firstParagraph.children?.length === 0) node.children?.shift()

  // Callout 使用 mdast 的 HTML 映射，不拼接原始 HTML，正文仍由 react-markdown 安全渲染。
  node.data = {
    hName: fold ? "details" : "aside",
    hProperties: {
      className: ["obsidian-callout"],
      "data-callout": calloutType,
      "data-fold": fold || undefined,
      open: fold === "+" ? true : undefined,
    },
  }
  node.children?.unshift({
    children: [{ type: "text", value: customTitle?.trim() || rawType }],
    data: { hName: fold ? "summary" : "div", hProperties: { className: ["obsidian-callout-title"] } },
    type: "paragraph",
  })
}

function transformWikiEmbed(node: MdNode) {
  if (node.type !== "paragraph" || node.children?.length !== 1) return
  const link = node.children[0]
  if (link.type !== "link") return
  const target = parseWikiEmbedHref(link.url)
  if (!target) return

  // 独占一行的笔记嵌入转换为块级节点，避免从链接渲染器返回 section 造成 p/section 非法嵌套。
  node.children = []
  node.data = {
    hName: "div",
    hProperties: { "data-wiki-embed": target },
  }
}

function transformBlockId(node: MdNode) {
  if (node.type !== "paragraph" || !node.children?.length) return
  const lastChild = node.children[node.children.length - 1]
  if (lastChild.type !== "text" || !lastChild.value) return
  const match = lastChild.value.match(/(?:^|\s)\^([\w-]+)\s*$/)
  if (!match) return
  lastChild.value = lastChild.value.slice(0, match.index).trimEnd()
  node.data = {
    ...node.data,
    hProperties: { ...node.data?.hProperties, id: `block-${match[1]}` },
  }
}

function visit(node: MdNode) {
  if (node.type === "blockquote") transformBlockquote(node)
  transformWikiEmbed(node)
  transformBlockId(node)
  node.children?.forEach(visit)
}

export function remarkObsidian() {
  return (tree: MdNode) => visit(tree)
}

export const obsidianNodeText = textContent
