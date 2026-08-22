import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"

import { parseWikiHref, rewriteWikiLinks } from "@/services/markdown/markdown-preview-utils"

type MarkdownPreviewProps = {
  content: string
  onWikiLink: (target: string) => void
}

const remarkPlugins = [remarkGfm]

export default function MarkdownPreview({ content, onWikiLink }: MarkdownPreviewProps) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        components={{
          a({ children, href }) {
            const wikiTarget = parseWikiHref(href)
            if (wikiTarget) {
              return (
                <button className="wiki-link" onClick={() => onWikiLink(wikiTarget)} type="button">
                  {children}
                </button>
              )
            }

            return (
              <a href={href} rel="noreferrer noopener" target="_blank">
                {children}
              </a>
            )
          },
        }}
        remarkPlugins={remarkPlugins}
        urlTransform={(url) => parseWikiHref(url) ? url : defaultUrlTransform(url)}
      >
        {rewriteWikiLinks(content)}
      </ReactMarkdown>
    </div>
  )
}
