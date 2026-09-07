type HtmlNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HtmlNode[]
}

// WebKit 会把跨段落选区的背景延伸到块级祖先的留白。
// 给文本增加无布局影响的行内绘制层，让块级选区透明、文字保留高亮；不拆词、不改复制内容。
export function rehypeSelectionText() {
  return (tree: HtmlNode) => {
    const visit = (node: HtmlNode) => {
      // 代码和公式渲染器需要原始文本结构，交给它们自己的选区样式。
      if (["pre", "code", "math", "svg", "script", "style"].includes(node.tagName ?? "")) return
      node.children = node.children?.map((child) => {
        if (child.type === "text" && child.value?.trim()) {
          return { type: "element", tagName: "span", properties: { className: ["markdown-selection-text"] }, children: [child] }
        }
        if (child.children) visit(child)
        return child
      })
    }
    visit(tree)
  }
}
