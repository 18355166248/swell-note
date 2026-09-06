import ReactMarkdown, { type Options } from "react-markdown"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"

// 仅公式笔记下载数学排版依赖；不信任公式中的 HTML/外链扩展，语法错误保留可读原文。
export default function MathMarkdown(props: Options) {
  return <ReactMarkdown {...props} remarkPlugins={[...(props.remarkPlugins ?? []), remarkMath]} rehypePlugins={[...(props.rehypePlugins ?? []), [rehypeKatex, { trust: false, strict: "ignore", throwOnError: false }]]} />
}
