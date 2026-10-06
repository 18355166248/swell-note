import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { remarkObsidian } from "@/services/markdown/remark-obsidian"
import { remarkImagePresentation } from "@/services/markdown/image-presentation"
import { isRelativeAttachmentHref, parseVaultAssetHref, parseWikiEmbedHref, parseWikiHref, parseMarkdownNoteHref, rewriteWikiLinks } from "@/services/markdown/markdown-preview-utils"
import type { VaultAsset } from "@/services/vault/vault-adapter"

type MdNode = { type: string; url?: string; identifier?: string; lang?: string; value?: string; children?: MdNode[] }
const css = `body{max-width:900px;margin:40px auto;padding:0 24px;color:#202833;background:#fff;font:17px/1.8 system-ui,"PingFang SC",sans-serif;overflow-wrap:anywhere}h1,h2,h3,h4{line-height:1.35;margin-top:1.5em}img,svg{max-width:100%;height:auto}table{width:100%;border-collapse:collapse;overflow-wrap:anywhere}th,td{border:1px solid #bfc7d0;padding:8px;text-align:left}thead{display:table-header-group}pre{white-space:pre-wrap;background:#f5f7fa;padding:16px;border-radius:8px}blockquote,.obsidian-callout{border-left:4px solid #94a3b8;padding:8px 16px;background:#f5f7fa}.obsidian-callout-title{font-weight:bold}a{color:#275db4}math[display="block"]{display:block;margin:1em 0}.delivery-warning{border:1px solid #bd8115;background:#fff8e9;padding:12px}input[type="checkbox"]{pointer-events:none}@page{size:A4;margin:16mm}@media print{body{margin:0;max-width:none;padding:0;font-size:11pt}h1,h2,h3,h4{break-after:avoid}img,svg,pre,blockquote{break-inside:avoid}a{color:inherit}.delivery-warning{font-size:9pt}}`

function dataUrl(asset: VaultAsset) {
  let binary = ""
  for (let at = 0; at < asset.data.length; at += 8192) binary += String.fromCharCode(...asset.data.slice(at, at + 8192))
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(asset.mimeType ?? "") ? asset.mimeType : "application/octet-stream"
  return `data:${type};base64,${btoa(binary)}`
}

export async function createHtmlDocument({ content, title, readAsset }: { content: string; title: string; readAsset: (source: string) => Promise<VaultAsset | null> }) {
  const urls = new Set<string>(), diagrams = new Set<string>(), warnings: string[] = [], assets = new Map<string, string>(), svg = new Map<string, string>()
  const text = rewriteWikiLinks(content)
  const collect = () => (tree: MdNode) => {
    const definitions = new Map<string, string>()
    const gatherDefinitions = (node: MdNode) => {
      if (node.type === "definition" && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url)
      node.children?.forEach(gatherDefinitions)
    }
    gatherDefinitions(tree)
    const visit = (node: MdNode) => {
      if (node.url && (parseWikiEmbedHref(node.url) || parseWikiHref(node.url) || parseMarkdownNoteHref(node.url))) warnings.push(`库内笔记链接或嵌入未包含目标正文：${parseWikiEmbedHref(node.url) ?? parseWikiHref(node.url) ?? node.url}`)
      const url = node.url ?? (node.identifier ? definitions.get(node.identifier.toLowerCase()) : undefined)
      if (url && ["image", "link", "imageReference", "linkReference"].includes(node.type)) {
        if (parseVaultAssetHref(url) || isRelativeAttachmentHref(url)) urls.add(url)
        else if (node.type.startsWith("image") && /^https?:/i.test(url)) warnings.push(`外部图片依赖联网：${url}`)
      }
      if (node.type === "code" && node.lang === "mermaid" && node.value) diagrams.add(node.value)
      node.children?.forEach(visit)
    }
    visit(tree)
  }
  // 先解析完整 Markdown 树，引用式图片/链接也会收集，不能只用 ]( 正则遗漏定义式附件。
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, collect]}>{text}</ReactMarkdown>)
  let bytes = 0
  for (const url of urls) {
    const source = parseVaultAssetHref(url) ?? url
    try {
      const asset = await readAsset(source)
      if (!asset) throw new Error("未找到或无法读取")
      if (bytes + asset.data.byteLength > 30 * 1024 * 1024) throw new Error("超过 HTML 内嵌附件总量 30MB")
      bytes += asset.data.byteLength
      assets.set(url, dataUrl(asset))
    } catch (error) { warnings.push(`未包含附件：${source}（${error instanceof Error ? error.message : "读取失败"}）`) }
  }
  if (diagrams.size) {
    const { default: mermaid } = await import("mermaid")
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: "default" })
    for (const diagram of diagrams) {
      try { svg.set(diagram, (await mermaid.render(`delivery${crypto.randomUUID().replace(/-/g, "")}`, diagram)).svg) }
      catch { warnings.push("图表无法绘制，导出中保留 Mermaid 源码") }
    }
  }
  const body = renderToStaticMarkup(<>
    <h1>{title}</h1>
    {warnings.length ? <aside className="delivery-warning"><strong>导出说明</strong><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></aside> : null}
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkObsidian, remarkImagePresentation]} rehypePlugins={[[rehypeKatex, { output: "mathml", strict: "ignore", trust: false }]]} remarkRehypeOptions={{ footnoteLabel: "脚注", footnoteBackLabel: "返回正文" }} urlTransform={(url) => assets.get(url) ?? (urls.has(url) || parseWikiHref(url) || parseWikiEmbedHref(url) || parseMarkdownNoteHref(url) ? "" : defaultUrlTransform(url))} components={{
      img: ({ node, src, alt, title }) => {
        // 导出和编辑器只认同一份显式尺寸元数据，数字说明不会被误当成宽度。
        const width = node?.properties?.dataImageWidth ?? node?.properties?.["data-image-width"]
        if (!src) return <span>未包含图片：{alt}</span>
        return <img src={src} alt={alt} title={title} style={width && width !== "auto" ? { width: Number(width), maxWidth: "100%" } : undefined} />
      },
      a: ({ href, children }) => href ? <a href={href} download={href.startsWith("data:") ? "附件" : undefined}>{children}</a> : <span>{children}</span>,
      div: ({ node, children, className }) => node?.properties?.["data-wiki-embed"] ? <aside>笔记嵌入：{String(node.properties["data-wiki-embed"])}（请在原库查看）</aside> : <div className={className}>{children}</div>,
      code: ({ children, className }) => {
        const diagram = String(children).replace(/\n$/, "")
        return className === "language-mermaid" && svg.has(diagram) ? <span className="delivery-diagram" dangerouslySetInnerHTML={{ __html: svg.get(diagram)! }} /> : <code className={className}>{children}</code>
      },
    }}>{text}</ReactMarkdown>
  </>)
  // 导出文件不执行脚本；本地资源内嵌为 data URL，外链保留但在说明中明确联网边界。
  const nonce = document.querySelector<HTMLStyleElement>("style[nonce]")?.nonce ?? ""
  const style = renderToStaticMarkup(<style nonce={nonce || undefined}>{css}</style>)
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:;">${renderToStaticMarkup(<title>{title}</title>)}${style}</head><body>${body}</body></html>`
  return { html, warnings }
}
