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

// ==高亮== 转成 mark 节点；%%注释%% 直接从阅读视图移除（整段都是注释时隐藏该段落）。
const inlineSyntaxPattern = /(==|%%)([\s\S]*?)\1/

function expandInlineSyntax(value: string): MdNode[] {
  const nodes: MdNode[] = []
  let rest = value
  while (rest) {
    const match = rest.match(inlineSyntaxPattern)
    if (!match || match.index === undefined) {
      nodes.push({ type: "text", value: rest })
      break
    }
    if (match.index > 0) nodes.push({ type: "text", value: rest.slice(0, match.index) })
    if (match[1] === "==") {
      nodes.push({ type: "text", value: match[2], data: { hName: "mark" } })
    }
    rest = rest.slice(match.index + match[0].length)
  }
  return nodes
}

function transformInlineSyntax(node: MdNode) {
  if (!node.children?.length) return
  const expanded: MdNode[] = []
  for (const child of node.children) {
    if (child.type !== "text" || !child.value) {
      expanded.push(child)
      continue
    }
    expanded.push(...expandInlineSyntax(child.value))
  }
  node.children = expanded.filter((child) => child.type !== "text" || child.value !== "")
  if (node.type === "paragraph" && node.children.length === 0) {
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, hidden: true } }
  }
}

function visit(node: MdNode) {
  if (node.type === "blockquote") transformBlockquote(node)
  transformWikiEmbed(node)
  transformBlockId(node)
  transformInlineSyntax(node)
  node.children?.forEach(visit)
}

export function remarkObsidian() {
  return (tree: MdNode) => visit(tree)
}

export const obsidianNodeText = textContent
