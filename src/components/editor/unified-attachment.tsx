import { syntaxTree } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"
import { EditorView, WidgetType } from "@codemirror/view"
import { createRoot, type Root } from "react-dom/client"
import { isRelativeAttachmentHref, parseVaultAssetHref } from "@/services/markdown/markdown-preview-utils"
import type { CompatibilityBlockOptions } from "./compatibility-blocks"
import { VaultAttachment } from "./vault-attachment"

export type AttachmentBlock = { kind: "attachment"; from: number; to: number; source: string; href: string; label: string }
export function collectAttachmentBlocks(state: EditorState): AttachmentBlock[] {
  const blocks: AttachmentBlock[] = []
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== "Link") return
    const url = node.node.getChild("URL")
    if (!url) return
    const line = state.doc.lineAt(node.from)
    const source = state.sliceDoc(node.from, node.to)
    // 只接管独占一行的附件，句内链接仍保留文本选区和正常 Markdown 编辑。
    if (line.text.trim() !== source || state.doc.lineAt(node.to).number !== line.number) return
    const raw = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, "")
    const href = parseVaultAssetHref(raw) ?? (isRelativeAttachmentHref(raw) ? raw : null)
    if (!href) return
    blocks.push({ kind: "attachment", from: line.from, to: line.to, source: line.text, href, label: /^\[([^\]]*)\]/.exec(source)?.[1] || href })
  } })
  return blocks
}

export class AttachmentBlockWidget extends WidgetType {
  private root?: Root
  private readOnly: boolean
  constructor(readonly block: AttachmentBlock, readonly options: CompatibilityBlockOptions, readonly view: EditorView) { super(); this.readOnly = view.state.readOnly }
  eq(other: AttachmentBlockWidget) { return other.block.source === this.block.source && other.block.from === this.block.from && other.options.assetScope === this.options.assetScope && other.readOnly === this.readOnly }
  toDOM() {
    const host = document.createElement("div")
    host.className = "cm-md-attachment"
    const output = document.createElement("div")
    host.append(output)
    this.root = createRoot(output)
    this.root.render(<VaultAttachment onResolveAsset={this.options.onResolveAsset ?? (() => Promise.resolve(null))} source={this.block.href}>{this.block.label}</VaultAttachment>)
    if (!this.view.state.readOnly) {
      const edit = document.createElement("button")
      edit.type = "button"; edit.textContent = "编辑附件引用"
      edit.addEventListener("click", () => {
        // 异步预览与引用编辑互不改写；只有当前源码仍属于该 Widget 时才能回到引用选区。
        if (this.view.state.readOnly || this.view.state.sliceDoc(this.block.from, this.block.to) !== this.block.source) return
        this.view.dispatch({ selection: { anchor: this.block.from, head: this.block.to }, scrollIntoView: true })
        this.view.focus()
      })
      host.append(edit)
    }
    return host
  }
  destroy() { const root = this.root; this.root = undefined; queueMicrotask(() => root?.unmount()) }
  ignoreEvent() { return true }
}
