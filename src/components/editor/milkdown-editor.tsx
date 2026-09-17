import { Crepe, CrepeFeature } from "@milkdown/crepe"
import { commandsCtx, editorViewCtx, parserCtx } from "@milkdown/kit/core"
import { redo as redoCommand, redoDepth, undo as undoCommand, undoDepth } from "@milkdown/kit/prose/history"
import { Slice, type Node as ProseNode } from "@milkdown/kit/prose/model"
import { AllSelection, TextSelection } from "@milkdown/kit/prose/state"
import type { EditorView } from "@milkdown/kit/prose/view"
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  listItemSchema,
  orderedListSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark"
import { createTable, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm"
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"

import { collectClipboardFiles, readClipboardContent } from "@/services/clipboard/clipboard-content"
import { writeClipboardText } from "@/services/clipboard/clipboard-text"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import type { MarkdownEditorHandle, MarkdownFindResult } from "./editor-contract"
import type { EditorLinkTap } from "./live-preview"
import type { EditorFormatState, EditorLinkTarget } from "./markdown-input"

import "@milkdown/crepe/theme/common/style.css"
import "./milkdown-editor.css"

type MilkdownEditorProps = {
  sessionKey?: string
  onHistoryChange?: (undo: boolean, redo: boolean) => void
  onEditingTargetChange?: (table: boolean) => void
  compact?: boolean
  onChange: (value: string) => void
  onCursorChange?: (line: number, column: number) => void
  onFormatStateChange?: (state: EditorFormatState | null) => void
  onInsertFiles?: (files: File[], position?: number) => void
  onPasteError?: (message: string) => void
  onLinkMenu?: (tap: EditorLinkTap) => void
  onLoadWikiNote?: (target: string) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  onResolveWikiNote?: (target: string) => unknown
  onSelectionChange?: (hasSelection: boolean) => void
  getWikiLinkSuggestions?: () => unknown[]
  readOnly?: boolean
  storageKey?: string
  value: string
}

type TextMatch = { from: number; to: number }

const URL_SCHEME = /^(?:data:|blob:|https?:)/i

export function splitMarkdownFrontmatter(markdown: string) {
  if (!markdown.startsWith("---\n")) return { body: markdown, frontmatter: "" }
  const closing = markdown.indexOf("\n---\n", 4)
  if (closing < 0) return { body: markdown, frontmatter: "" }
  const end = closing + 5
  return { body: markdown.slice(end), frontmatter: markdown.slice(0, end) }
}

function bytesToObjectUrl(asset: VaultAsset) {
  return URL.createObjectURL(new Blob([asset.data as BlobPart], { type: asset.mimeType || "application/octet-stream" }))
}

function textMatches(doc: ProseNode, query: string): TextMatch[] {
  if (!query) return []
  const needle = query.toLocaleLowerCase()
  const matches: TextMatch[] = []
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return
    const haystack = node.text.toLocaleLowerCase()
    let offset = 0
    while (offset <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, offset)
      if (found < 0) break
      matches.push({ from: position + found, to: position + found + query.length })
      offset = found + Math.max(1, query.length)
    }
  })
  return matches
}

function formatStateFromSelection(selection: TextSelection): EditorFormatState {
  const { $from } = selection
  const marks = $from.marks()
  const hasMark = (name: string) => marks.some((mark) => mark.type.name === name)
  let heading: EditorFormatState["heading"] = 0
  let bulletList = false
  let orderedList = false
  let quote = false
  let taskList = false
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === "heading") heading = Math.min(6, Math.max(1, Number(node.attrs.level))) as EditorFormatState["heading"]
    if (node.type.name === "bullet_list") bulletList = true
    if (node.type.name === "ordered_list") orderedList = true
    if (node.type.name === "blockquote") quote = true
    if (node.type.name === "list_item" && typeof node.attrs.checked === "boolean") taskList = true
  }
  return {
    bulletList,
    code: hasMark("inlineCode") || hasMark("inline_code"),
    emphasis: hasMark("emphasis") || hasMark("em"),
    heading,
    orderedList,
    quote,
    strike: hasMark("strike_through") || hasMark("strikethrough"),
    strong: hasMark("strong"),
    taskList,
  }
}

function lineAndColumn(markdown: string, offset: number) {
  const prefix = markdown.slice(0, Math.max(0, Math.min(offset, markdown.length)))
  const lines = prefix.split("\n")
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

function blockElementForLine(root: HTMLElement, markdown: string, line: number) {
  const target = markdown.split("\n")[Math.max(0, line - 1)]?.replace(/^\s*(?:#{1,6}|[-*+] |\d+[.)] |> ?)/, "").trim()
  if (!target) return null
  return Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre"))
    .find((element) => element.textContent?.trim().includes(target)) ?? null
}

export const MilkdownEditor = forwardRef<MarkdownEditorHandle, MilkdownEditorProps>(function MilkdownEditor({
  sessionKey,
  onHistoryChange,
  onEditingTargetChange,
  onChange,
  onCursorChange,
  onFormatStateChange,
  onInsertFiles,
  onPasteError,
  onOpenWikiLink,
  onResolveAsset,
  onSelectionChange,
  readOnly = false,
  value,
}, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const callbacks = useRef({ onChange, onCursorChange, onEditingTargetChange, onFormatStateChange, onHistoryChange, onInsertFiles, onOpenWikiLink, onPasteError, onResolveAsset, onSelectionChange })
  const latestMarkdown = useRef(value)
  const appliedValue = useRef(value)
  const userEditPending = useRef(false)
  const frontmatter = useRef(splitMarkdownFrontmatter(value).frontmatter)
  const findIndex = useRef(-1)
  const objectUrls = useRef(new Map<string, string>())
  const [error, setError] = useState<string | null>(null)
  callbacks.current = { onChange, onCursorChange, onEditingTargetChange, onFormatStateChange, onHistoryChange, onInsertFiles, onOpenWikiLink, onPasteError, onResolveAsset, onSelectionChange }

  const withView = <T,>(run: (crepe: Crepe, view: EditorView) => T): T | undefined => {
    const crepe = crepeRef.current
    if (!crepe) return undefined
    return crepe.editor.action((ctx) => run(crepe, ctx.get(editorViewCtx)))
  }

  const insertMarkdown = (markdown: string, position?: number) => withView((crepe, view) => crepe.editor.action((ctx) => {
    userEditPending.current = true
    const parser = ctx.get(parserCtx)
    const parsed = parser(markdown)
    const selection = position === undefined
      ? view.state.selection
      : TextSelection.near(view.state.doc.resolve(Math.max(0, Math.min(position, view.state.doc.content.size))))
    const tr = view.state.tr.setSelection(selection)
    view.dispatch(tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView())
    view.focus()
    return true
  })) ?? false

  const applyFormat = (syntax: string) => withView((crepe, view) => crepe.editor.action((ctx) => {
    userEditPending.current = true
    const commands = ctx.get(commandsCtx)
    if (syntax === "**加粗文字**") commands.call(toggleStrongCommand.key)
    else if (syntax === "*斜体文字*") commands.call(toggleEmphasisCommand.key)
    else if (syntax === "~~删除线文字~~") commands.call(toggleStrikethroughCommand.key)
    else if (syntax === "`行内代码`") commands.call(toggleInlineCodeCommand.key)
    else if (/^\n#{1,6} $/.test(syntax)) commands.call(setBlockTypeCommand.key, { nodeType: headingSchema.type(ctx), attrs: { level: syntax.trim().length - 1 } })
    else if (syntax === "\n> ") commands.call(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) })
    else if (syntax === "\n- ") commands.call(wrapInBlockTypeCommand.key, { nodeType: bulletListSchema.type(ctx) })
    else if (syntax === "\n1. ") commands.call(wrapInBlockTypeCommand.key, { nodeType: orderedListSchema.type(ctx) })
    else if (syntax === "\n- [ ] ") commands.call(wrapInBlockTypeCommand.key, { nodeType: listItemSchema.type(ctx), attrs: { checked: false } })
    else if (syntax.startsWith("\n```")) commands.call(setBlockTypeCommand.key, { nodeType: codeBlockSchema.type(ctx) })
    else if (syntax === "\n---\n") commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) })
    else if (syntax.includes("| 列 1 | 列 2 |")) commands.call(addBlockTypeCommand.key, { nodeType: createTable(ctx, 3, 3) })
    else return insertMarkdown(syntax)
    view.focus()
    return true
  })) ?? false

  useImperativeHandle(ref, () => ({
    applyLink(target, label, url) {
      return withView((_crepe, view) => {
        const from = target?.from ?? view.state.selection.from
        const to = target?.to ?? view.state.selection.to
        const mark = view.state.schema.marks.link
        if (!mark || !url.trim()) return false
        userEditPending.current = true
        let tr = view.state.tr
        if (from !== to && view.state.doc.textBetween(from, to, " ") !== label) tr = tr.insertText(label, from, to)
        const end = from + label.length
        tr = tr.addMark(from, end, mark.create({ href: url.trim() })).setSelection(TextSelection.near(tr.doc.resolve(end)))
        view.dispatch(tr.scrollIntoView())
        view.focus()
        return true
      }) ?? false
    },
    captureInsertion(position) {
      const captured = withView((_crepe, view) => position ?? view.state.selection.from)
      const owner = crepeRef.current
      return {
        insert: (text) => owner !== null && owner === crepeRef.current && captured !== undefined && insertMarkdown(text, captured),
        dispose: () => {},
      }
    },
    collapseSelection() {
      withView((_crepe, view) => view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.selection.head)))))
    },
    async copySelection() {
      const text = withView((_crepe, view) => view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n"))
      return text ? writeClipboardText(text, "text") : false
    },
    async cutSelection() {
      const result = withView((_crepe, view) => ({ from: view.state.selection.from, text: view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n"), to: view.state.selection.to, view }))
      if (!result?.text || !(await writeClipboardText(result.text, "text"))) return false
      userEditPending.current = true
      result.view.dispatch(result.view.state.tr.delete(result.from, result.to))
      return true
    },
    focus: () => { withView((_crepe, view) => view.focus()) },
    findText(query, direction = "next", fromStart = false) {
      return withView((_crepe, view) => {
        const matches = textMatches(view.state.doc, query)
        if (!matches.length) { findIndex.current = -1; return { current: 0, total: 0 } }
        if (fromStart || findIndex.current < 0 || findIndex.current >= matches.length) findIndex.current = direction === "next" ? 0 : matches.length - 1
        else findIndex.current = (findIndex.current + (direction === "next" ? 1 : -1) + matches.length) % matches.length
        const match = matches[findIndex.current]
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView())
        view.focus()
        return { current: findIndex.current + 1, total: matches.length }
      }) ?? { current: 0, total: 0 }
    },
    insertText: (text) => { applyFormat(text) },
    lineAtViewportTop(clientY) {
      const root = rootRef.current
      if (!root) return null
      const bounds = root.getBoundingClientRect()
      const element = document.elementFromPoint(bounds.left + bounds.width / 2, clientY + 2) as HTMLElement | null
      const block = element?.closest<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre")
      const text = block?.textContent?.trim()
      if (!text) return null
      const line = latestMarkdown.current.split("\n").findIndex((source) => source.includes(text.slice(0, 24)))
      return line < 0 ? null : line + 1
    },
    async pasteAtSelection() {
      try {
        const clipboard = await readClipboardContent()
        if (clipboard.text) return insertMarkdown(clipboard.text)
        if (clipboard.files.length && callbacks.current.onInsertFiles) {
          callbacks.current.onInsertFiles(clipboard.files, withView((_crepe, view) => view.state.selection.from))
          return true
        }
        return false
      } catch (pasteError) {
        callbacks.current.onPasteError?.(pasteError instanceof Error ? pasteError.message : "读取剪贴板失败")
        return false
      }
    },
    readLinkContext() {
      return withView((_crepe, view) => {
        const { from, to, empty, $from } = view.state.selection
        const link = (view.state.storedMarks ?? $from.marks()).find((mark) => mark.type.name === "link")
        const selectedText = view.state.doc.textBetween(from, to, " ")
        const target: EditorLinkTarget | null = link && !empty ? {
          from,
          label: selectedText,
          source: selectedText,
          to,
          url: String(link.attrs.href ?? ""),
        } : null
        return { hadFocus: view.hasFocus(), selectedText, target }
      }) ?? null
    },
    redo: () => { withView((_crepe, view) => { userEditPending.current = true; redoCommand(view.state, view.dispatch, view); view.focus() }) },
    removeLink(target) {
      return withView((_crepe, view) => {
        const mark = view.state.schema.marks.link
        if (!mark) return false
        userEditPending.current = true
        view.dispatch(view.state.tr.removeMark(target.from, target.to, mark))
        view.focus()
        return true
      }) ?? false
    },
    replaceAll(query, replacement) {
      return withView((_crepe, view) => {
        const matches = textMatches(view.state.doc, query)
        if (!matches.length) return 0
        userEditPending.current = true
        let tr = view.state.tr
        for (const match of [...matches].reverse()) tr = tr.insertText(replacement, match.from, match.to)
        view.dispatch(tr)
        return matches.length
      }) ?? 0
    },
    replaceCurrent(query, replacement): MarkdownFindResult {
      return withView((_crepe, view) => {
        const matches = textMatches(view.state.doc, query)
        if (!matches.length) return { current: 0, total: 0 }
        userEditPending.current = true
        const index = Math.max(0, Math.min(findIndex.current, matches.length - 1))
        const match = matches[index]
        view.dispatch(view.state.tr.insertText(replacement, match.from, match.to))
        const remaining = textMatches(view.state.doc, query).length - 1
        findIndex.current = remaining ? Math.min(index, remaining - 1) : -1
        return { current: remaining ? findIndex.current + 1 : 0, total: remaining }
      }) ?? { current: 0, total: 0 }
    },
    restoreCellFocus: () => false,
    revealLine(line) { this.scrollLineToTop(line) },
    scrollLineToTop(line) {
      const root = rootRef.current
      if (!root) return false
      const target = blockElementForLine(root, latestMarkdown.current, line)
      if (!target) return false
      const viewport = root.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
      if (!viewport) { target.scrollIntoView({ block: "start" }); return true }
      viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      return true
    },
    selectAll() {
      withView((_crepe, view) => {
        view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
        view.focus()
      })
    },
    undo: () => { withView((_crepe, view) => { userEditPending.current = true; undoCommand(view.state, view.dispatch, view); view.focus() }) },
  }), [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let disposed = false
    let crepe: Crepe | null = null
    queueMicrotask(() => {
      if (disposed) return
      crepe = new Crepe({
        root,
        defaultValue: splitMarkdownFrontmatter(value).body,
        features: { [CrepeFeature.BlockEdit]: !readOnly },
        featureConfigs: {
          [CrepeFeature.BlockEdit]: {
            blockHandle: { getOffset: () => 8 },
            textGroup: { label: "文本", text: { label: "正文" }, h1: { label: "一级标题" }, h2: { label: "二级标题" }, h3: { label: "三级标题" }, h4: { label: "四级标题" }, h5: { label: "五级标题" }, h6: { label: "六级标题" }, quote: { label: "引用" }, divider: { label: "分割线" } },
            listGroup: { label: "列表", bulletList: { label: "无序列表" }, orderedList: { label: "有序列表" }, taskList: { label: "任务列表" } },
            advancedGroup: { label: "高级", image: { label: "图片" }, codeBlock: { label: "代码块" }, table: { label: "表格" }, math: { label: "公式" } },
          },
          [CrepeFeature.ImageBlock]: {
            proxyDomURL: async (source) => {
              if (URL_SCHEME.test(source)) return source
              const cached = objectUrls.current.get(source)
              if (cached) return cached
              const asset = await callbacks.current.onResolveAsset?.(source)
              if (!asset) return source
              const url = bytesToObjectUrl(asset)
              objectUrls.current.set(source, url)
              return url
            },
          },
        },
      })
      crepeRef.current = crepe
      crepe.setReadonly(readOnly)
      crepe.on((listener) => {
        listener.markdownUpdated((ctx, markdown) => {
          if (disposed) return
          const completeMarkdown = frontmatter.current + markdown
          latestMarkdown.current = completeMarkdown
          // Crepe 的图片、表格等插件在挂载时也可能派发 docChanged；没有真实输入意图时绝不回写笔记。
          if (!userEditPending.current) return
          userEditPending.current = false
          appliedValue.current = completeMarkdown
          callbacks.current.onChange(completeMarkdown)
          const view = ctx.get(editorViewCtx)
          callbacks.current.onHistoryChange?.(undoDepth(view.state) > 0, redoDepth(view.state) > 0)
        })
        listener.selectionUpdated((_ctx, selection) => {
          if (disposed) return
          callbacks.current.onSelectionChange?.(!selection.empty)
          callbacks.current.onEditingTargetChange?.(selection.$from.parent.type.name.includes("table"))
          callbacks.current.onFormatStateChange?.(formatStateFromSelection(selection as TextSelection))
          const position = lineAndColumn(latestMarkdown.current, selection.from)
          callbacks.current.onCursorChange?.(position.line, position.column)
        })
        listener.blur(() => callbacks.current.onSelectionChange?.(false))
      })
      void crepe.create().then(() => {
        if (disposed || !crepe) return
        latestMarkdown.current = frontmatter.current + crepe.getMarkdown()
        callbacks.current.onHistoryChange?.(false, false)
      }).catch((creationError: unknown) => {
        if (!disposed) setError(creationError instanceof Error ? creationError.message : "Milkdown 初始化失败")
      })
    })
    return () => {
      disposed = true
      if (crepeRef.current === crepe) crepeRef.current = null
      if (crepe) void crepe.destroy()
      for (const url of objectUrls.current.values()) URL.revokeObjectURL(url)
      objectUrls.current.clear()
      callbacks.current.onSelectionChange?.(false)
      callbacks.current.onFormatStateChange?.(null)
    }
  }, [sessionKey])

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly)
  }, [readOnly])

  useEffect(() => {
    const crepe = crepeRef.current
    if (!crepe || value === appliedValue.current || value === latestMarkdown.current) return
    appliedValue.current = value
    const next = splitMarkdownFrontmatter(value)
    frontmatter.current = next.frontmatter
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const parsed = ctx.get(parserCtx)(next.body)
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, parsed.content).setMeta("addToHistory", false))
      latestMarkdown.current = value
    })
  }, [value])

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = collectClipboardFiles(event.clipboardData)
    if (readOnly || !files.length || !callbacks.current.onInsertFiles) return
    event.preventDefault()
    callbacks.current.onInsertFiles(files, withView((_crepe, view) => view.state.selection.from))
  }

  return (
    <div
      className="swell-milkdown-editor"
      data-readonly={readOnly || undefined}
      onBeforeInputCapture={() => { userEditPending.current = true }}
      onKeyDownCapture={(event) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift", "Alt", "Control", "Meta", "Escape", "Tab"].includes(event.key)) userEditPending.current = true
      }}
      onPaste={handlePaste}
      onPointerDownCapture={(event) => {
        const target = event.target instanceof Element ? event.target : null
        if (target?.closest(".milkdown-block-handle,.milkdown-slash-menu,.milkdown-toolbar,.milkdown-link-edit,.milkdown-table-block")) userEditPending.current = true
      }}
    >
      {error ? <p className="swell-milkdown-error" role="alert">{error}</p> : null}
      <div ref={rootRef} />
    </div>
  )
})

export default MilkdownEditor
