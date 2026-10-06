import { markdownLanguage } from "@codemirror/lang-markdown"
import type { Text } from "@codemirror/state"
import { unescapeMarkdownImageText } from "./image-presentation"

type Node = { from: number; to: number; getChild(name: string): Node | null }
type Destination = { source: string; title?: string }
const cachedDefinitions = new WeakMap<Text, Map<string, Destination>>()

function referenceKey(label: string) {
  return unescapeMarkdownImageText(label).trim().replace(/\s+/g, " ").toLowerCase()
}

export function markdownDestination(value: string) {
  // 只有成对的尖括号才是地址包裹，转义后的字面 > 必须仍属于真实地址。
  return unescapeMarkdownImageText(value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1) : value)
}

export function collectMarkdownDefinitions(content: string, tree = markdownLanguage.parser.parse(content)) {
  const definitions = new Map<string, Destination>()
  tree.iterate({
    enter(node) {
      if (node.name !== "LinkReference") return
      const label = node.node.getChild("LinkLabel"), url = node.node.getChild("URL"), title = node.node.getChild("LinkTitle")
      if (!label || !url) return
      const key = referenceKey(content.slice(label.from + 1, label.to - 1))
      // CommonMark 的首个定义生效；重复定义不能让离线保存与实际阅读指向不同文件。
      if (!definitions.has(key)) definitions.set(key, {
        source: markdownDestination(content.slice(url.from, url.to)),
        title: title ? content.slice(title.from + 1, title.to - 1) : undefined,
      })
      return false
    },
  })
  return definitions
}

export function resolveMarkdownReference(node: Node, slice: (from: number, to: number) => string, definitions: Map<string, Destination>) {
  if (/^!?\[\[/.test(slice(node.from, node.to))) return undefined
  const label = node.getChild("LinkLabel")
  const explicit = label ? slice(label.from + 1, label.to - 1) : ""
  const open = node.getChild("LinkMark")
  if (!open) return undefined
  const source = slice(node.from, label?.from ?? node.to)
  const close = source.lastIndexOf("]") + node.from
  if (close < open.to) return undefined
  return definitions.get(referenceKey(explicit || slice(open.to, close)))
}

export function resolveDocumentReference(node: Node, doc: Text) {
  // Wiki 双链及其内层节点由现有装饰器接管，不能再次当成引用式链接解析。
  if (/^!?\[\[/.test(doc.sliceString(node.from, node.to)) || doc.sliceString(Math.max(0, node.from - 1), node.from + 1) === "[[") return undefined
  // 只在遇到引用式链接时扫描全文，并按不可变正文缓存；普通笔记与滚动重绘不承担这项成本。
  const definitions = documentReferenceDefinitions(doc)
  return resolveMarkdownReference(node, (from, to) => doc.sliceString(from, to), definitions)
}

export function documentReferenceDefinitions(doc: Text) {
  let definitions = cachedDefinitions.get(doc)
  if (!definitions) {
    definitions = collectMarkdownDefinitions(doc.toString())
    cachedDefinitions.set(doc, definitions)
  }
  return definitions
}
