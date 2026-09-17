import { diffLines } from "diff"

export type EditorLabId = "codemirror" | "vditor" | "milkdown"

export type MarkdownStats = {
  characters: number
  lines: number
  words: number
}

export type MarkdownDiffSummary = {
  addedLines: number
  exact: boolean
  removedLines: number
}

export const EDITOR_LAB_IDS: readonly EditorLabId[] = ["codemirror", "vditor", "milkdown"]

export const DEFAULT_EDITOR_LAB_MARKDOWN = `---
title: 编辑器实验室验收笔记
tags: [Swell Note, editor-lab]
---

# 编辑器实验室验收笔记

这是一篇用于桌面端与移动端对比的真实 Markdown 样本。请在每个编辑器中分别输入中文，例如：**今天开始验证中文输入法**。

## 行内格式与链接

普通文本、**粗体**、*斜体*、~~删除线~~、\`inline code\`、==高亮==，以及 [Swell Note 项目](https://github.com/)。

> [!NOTE]
> 观察光标进入引用、选中文字和连续退格时，界面是否跳动。

## 任务与嵌套列表

- [x] 打开同一篇 Markdown
- [ ] 测试拼音组合输入
  - 长按选择一段文字
  - 使用格式工具栏
1. 输入一行文字
2. 撤销，再重做
3. 检查序号是否连续

## 表格

| 编辑器 | 中文输入 | 表格操作 | 撤销 | Markdown 往返 |
| :--- | :---: | ---: | :---: | --- |
| CodeMirror | 待测 | 12 ms | ✅ | 原文优先 |
| Vditor | 待测 | 18 ms | ✅ | 待比较 |
| Milkdown | 待测 | 16 ms | ✅ | 待比较 |

## 图片

![Swell Note 标志](/swell-note.svg "240")

图片下方继续输入，验证软键盘弹出后光标不会被遮挡。

## 代码、公式与图表

\`\`\`ts
type EditorResult = {
  name: string
  markdown: string
  latencyMs: number
}
\`\`\`

行内公式 $E = mc^2$。

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

\`\`\`mermaid
flowchart LR
  Markdown --> Editor
  Editor --> Markdown
\`\`\`

## 往返保真陷阱

保留  两个空格、引用式链接 [项目主页][project]、脚注[^1] 和一段内嵌 HTML：<kbd>Cmd</kbd> + <kbd>Z</kbd>。

[project]: https://github.com/ "引用式链接标题"
[^1]: 编辑后检查脚注位置、空行和链接形式是否被改写。
`

export function markdownStats(markdown: string): MarkdownStats {
  return {
    characters: markdown.length,
    lines: markdown.length === 0 ? 0 : markdown.split("\n").length,
    words: markdown.trim() ? markdown.trim().split(/\s+/u).length : 0,
  }
}

export function markdownDiffSummary(source: string, output: string): MarkdownDiffSummary {
  if (source === output) return { addedLines: 0, exact: true, removedLines: 0 }
  let addedLines = 0
  let removedLines = 0
  for (const part of diffLines(source, output)) {
    if (part.added) addedLines += countChangedLines(part.value)
    if (part.removed) removedLines += countChangedLines(part.value)
  }
  return { addedLines, exact: false, removedLines }
}

export function expandMarkdown(source: string, repeats: number) {
  if (repeats <= 1) return source
  const sections = Array.from({ length: repeats }, (_, index) => {
    const body = source.replace(/^# /m, "### ")
    return `## 长文重复段 ${index + 1}\n\n${body}`
  })
  return `# 长文性能测试 · ${repeats} 份\n\n${sections.join("\n\n---\n\n")}`
}

function countChangedLines(value: string) {
  const withoutTrailingBreak = value.endsWith("\n") ? value.slice(0, -1) : value
  return withoutTrailingBreak ? withoutTrailingBreak.split("\n").length : 0
}
