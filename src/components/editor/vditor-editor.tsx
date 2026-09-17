import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import Vditor from "vditor"

import { readClipboardContent } from "@/services/clipboard/clipboard-content"
import { writeClipboardText } from "@/services/clipboard/clipboard-text"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import type { MarkdownEditorHandle, MarkdownFindResult } from "./editor-contract"

import "vditor/dist/index.css"
import "./vditor-editor.css"

type VditorEditorProps = {
  sessionKey?: string
  onHistoryChange?: (undo: boolean, redo: boolean) => void
  onChange: (value: string) => void
  onCursorChange?: (line: number, column: number) => void
  onInsertFiles?: (files: File[], position?: number) => void
  onPasteError?: (message: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  onSelectionChange?: (hasSelection: boolean) => void
  readOnly?: boolean
  value: string
}

type TextMatch = { from: number; to: number }

const URL_SCHEME = /^(?:data:|blob:|https?:)/i
const VDITOR_CDN = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/vendor/vditor`
const TOOLBAR: IOptions["toolbar"] = [
  "undo", "redo", "|", "headings", "bold", "italic", "strike", "|",
  "list", "ordered-list", "check", "quote", "table", "upload", "|",
  { name: "more", toolbar: ["link", "inline-code", "code", "line", "fullscreen", "edit-mode"] },
]

export function markdownTextMatches(markdown: string, query: string): TextMatch[] {
  if (!query) return []
  const source = markdown.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const matches: TextMatch[] = []
  let offset = 0
  while (offset <= source.length - needle.length) {
    const found = source.indexOf(needle, offset)
    if (found < 0) break
    matches.push({ from: found, to: found + query.length })
    offset = found + Math.max(1, query.length)
  }
  return matches
}

function activeEditorElement(editor: Vditor) {
  const mode = editor.getCurrentMode()
  if (mode === "sv") return editor.vditor.sv?.element ?? null
  if (mode === "wysiwyg") return editor.vditor.wysiwyg?.element ?? null
  return editor.vditor.ir?.element ?? null
}

function currentEditorRange(editor: Vditor) {
  const root = activeEditorElement(editor)
  const selection = window.getSelection()
  if (root && selection?.rangeCount) {
    const range = selection.getRangeAt(0)
    if (root.contains(range.commonAncestorContainer)) return range.cloneRange()
  }
  const mode = editor.getCurrentMode()
  const stored = mode === "ir" ? editor.vditor.ir?.range : mode === "wysiwyg" ? editor.vditor.wysiwyg?.range : null
  return stored?.startContainer.isConnected ? stored.cloneRange() : null
}

function restoreRange(range: Range | null) {
  if (!range?.startContainer.isConnected) return false
  const selection = window.getSelection()
  if (!selection) return false
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

function selectRenderedOccurrence(root: HTMLElement | null, query: string, occurrence: number) {
  if (!root || !query) return false
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const needle = query.toLocaleLowerCase()
  let remaining = occurrence
  let node = walker.nextNode()
  while (node) {
    const text = node.textContent ?? ""
    const lower = text.toLocaleLowerCase()
    let offset = 0
    while (offset <= lower.length - needle.length) {
      const found = lower.indexOf(needle, offset)
      if (found < 0) break
      if (remaining === 0) {
        const range = document.createRange()
        range.setStart(node, found)
        range.setEnd(node, found + query.length)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        range.startContainer.parentElement?.scrollIntoView({ block: "center" })
        return true
      }
      remaining -= 1
      offset = found + Math.max(1, query.length)
    }
    node = walker.nextNode()
  }
  return false
}

function lineForBlock(markdown: string, block: Element | null) {
  const fragments = block?.textContent?.split("\n").map((part) => part.trim()).filter(Boolean) ?? []
  if (!fragments.length) return null
  const lines = markdown.split("\n")
  for (const fragment of fragments) {
    const needle = fragment.slice(0, 24)
    const line = lines.findIndex((source) => source.replace(/^\s*(?:#{1,6}|[-*+] |\d+[.)] |> ?)/, "").includes(needle))
    if (line >= 0) return line + 1
  }
  return null
}

function editorTheme() {
  return document.documentElement.classList.contains("dark") ? "dark" : "classic"
}

export const VditorEditor = forwardRef<MarkdownEditorHandle, VditorEditorProps>(function VditorEditor({
  sessionKey,
  onHistoryChange,
  onChange,
  onCursorChange,
  onInsertFiles,
  onPasteError,
  onResolveAsset,
  onSelectionChange,
  readOnly = false,
  value,
}, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Vditor | null>(null)
  const callbacks = useRef({ onChange, onCursorChange, onHistoryChange, onInsertFiles, onPasteError, onResolveAsset, onSelectionChange })
  const latestMarkdown = useRef(value)
  const appliedValue = useRef(value)
  const readOnlyRef = useRef(readOnly)
  const findIndex = useRef(-1)
  const objectUrls = useRef(new Map<string, string>())
  const historyTimer = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  callbacks.current = { onChange, onCursorChange, onHistoryChange, onInsertFiles, onPasteError, onResolveAsset, onSelectionChange }
  readOnlyRef.current = readOnly

  const reportHistory = (editor: Vditor) => {
    const undo = editor.vditor.toolbar?.elements?.undo?.firstElementChild
    const redo = editor.vditor.toolbar?.elements?.redo?.firstElementChild
    callbacks.current.onHistoryChange?.(
      Boolean(undo && !undo.classList.contains("vditor-menu--disabled")),
      Boolean(redo && !redo.classList.contains("vditor-menu--disabled")),
    )
  }

  const scheduleHistoryReport = (editor: Vditor) => {
    if (historyTimer.current !== null) window.clearTimeout(historyTimer.current)
    historyTimer.current = window.setTimeout(() => reportHistory(editor), 850)
  }

  const reportCursor = (editor: Vditor) => {
    const root = activeEditorElement(editor)
    const range = currentEditorRange(editor)
    if (!root || !range) return
    const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const block = element?.closest("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,div[data-block]") ?? null
    const line = lineForBlock(latestMarkdown.current, block) ?? 1
    callbacks.current.onCursorChange?.(line, Math.max(1, range.startOffset + 1))
  }

  const resolveImages = async (editor: Vditor) => {
    const root = activeEditorElement(editor)
    if (!root) return
    const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[src]"))
    await Promise.all(images.map(async (image) => {
      const source = image.getAttribute("src") ?? ""
      if (!source || URL_SCHEME.test(source)) return
      const cached = objectUrls.current.get(source)
      if (cached) { image.src = cached; return }
      const asset = await callbacks.current.onResolveAsset?.(source)
      if (!asset || editorRef.current !== editor) return
      const url = URL.createObjectURL(new Blob([asset.data as BlobPart], { type: asset.mimeType || "application/octet-stream" }))
      objectUrls.current.set(source, url)
      image.src = url
    }))
  }

  const commitValue = (editor: Vditor, markdown = editor.getValue()) => {
    latestMarkdown.current = markdown
    appliedValue.current = markdown
    callbacks.current.onChange(markdown)
    scheduleHistoryReport(editor)
    queueMicrotask(() => { reportCursor(editor); void resolveImages(editor) })
  }

  const syncAfterCommand = (editor: Vditor) => {
    queueMicrotask(() => {
      if (editorRef.current !== editor) return
      const markdown = editor.getValue()
      if (markdown !== latestMarkdown.current) commitValue(editor, markdown)
      else scheduleHistoryReport(editor)
    })
  }

  useImperativeHandle(ref, () => ({
    captureInsertion() {
      const owner = editorRef.current
      const range = owner ? currentEditorRange(owner) : null
      return {
        insert: (text) => {
          if (!owner || editorRef.current !== owner) return false
          owner.focus()
          restoreRange(range)
          owner.insertMD(text)
          syncAfterCommand(owner)
          return true
        },
        dispose: () => {},
      }
    },
    collapseSelection() {
      const selection = window.getSelection()
      if (selection?.rangeCount) selection.collapseToEnd()
    },
    async copySelection() {
      const text = editorRef.current?.getSelection() ?? ""
      return text ? writeClipboardText(text, "text") : false
    },
    async cutSelection() {
      const editor = editorRef.current
      const text = editor?.getSelection() ?? ""
      if (!editor || !text || !(await writeClipboardText(text, "text"))) return false
      editor.deleteValue()
      syncAfterCommand(editor)
      return true
    },
    focus: () => editorRef.current?.focus(),
    findText(query, direction = "next", fromStart = false) {
      const editor = editorRef.current
      const matches = markdownTextMatches(latestMarkdown.current, query)
      if (!editor || !matches.length) { findIndex.current = -1; return { current: 0, total: 0 } }
      if (fromStart || findIndex.current < 0 || findIndex.current >= matches.length) findIndex.current = direction === "next" ? 0 : matches.length - 1
      else findIndex.current = (findIndex.current + (direction === "next" ? 1 : -1) + matches.length) % matches.length
      editor.focus()
      selectRenderedOccurrence(activeEditorElement(editor), query, findIndex.current)
      return { current: findIndex.current + 1, total: matches.length }
    },
    insertText(text) {
      const editor = editorRef.current
      if (!editor) return
      editor.focus()
      editor.insertMD(text)
      syncAfterCommand(editor)
    },
    lineAtViewportTop(clientY) {
      const editor = editorRef.current
      const root = editor ? activeEditorElement(editor) : null
      if (!root) return null
      const bounds = root.getBoundingClientRect()
      const element = document.elementFromPoint(bounds.left + Math.min(bounds.width / 2, 220), clientY + 2)
      return lineForBlock(latestMarkdown.current, element?.closest("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,div[data-block]") ?? null)
    },
    async pasteAtSelection() {
      const editor = editorRef.current
      if (!editor) return false
      try {
        const clipboard = await readClipboardContent()
        if (clipboard.text) {
          editor.insertMD(clipboard.text)
          syncAfterCommand(editor)
          return true
        }
        if (clipboard.files.length && callbacks.current.onInsertFiles) {
          callbacks.current.onInsertFiles(clipboard.files)
          return true
        }
        return false
      } catch (pasteError) {
        callbacks.current.onPasteError?.(pasteError instanceof Error ? pasteError.message : "读取剪贴板失败")
        return false
      }
    },
    redo() {
      const editor = editorRef.current
      if (!editor) return
      editor.vditor.undo?.redo(editor.vditor)
      syncAfterCommand(editor)
    },
    replaceAll(query, replacement) {
      const editor = editorRef.current
      const matches = markdownTextMatches(latestMarkdown.current, query)
      if (!editor || !matches.length) return 0
      let next = latestMarkdown.current
      for (const match of [...matches].reverse()) next = next.slice(0, match.from) + replacement + next.slice(match.to)
      editor.setValue(next)
      commitValue(editor, next)
      findIndex.current = -1
      return matches.length
    },
    replaceCurrent(query, replacement): MarkdownFindResult {
      const editor = editorRef.current
      const matches = markdownTextMatches(latestMarkdown.current, query)
      if (!editor || !matches.length) return { current: 0, total: 0 }
      const index = Math.max(0, Math.min(findIndex.current, matches.length - 1))
      const match = matches[index]
      const next = latestMarkdown.current.slice(0, match.from) + replacement + latestMarkdown.current.slice(match.to)
      editor.setValue(next)
      commitValue(editor, next)
      const remaining = markdownTextMatches(next, query).length
      findIndex.current = remaining ? Math.min(index, remaining - 1) : -1
      if (remaining) queueMicrotask(() => selectRenderedOccurrence(activeEditorElement(editor), query, findIndex.current))
      return { current: remaining ? findIndex.current + 1 : 0, total: remaining }
    },
    revealLine(line) { this.scrollLineToTop(line) },
    scrollLineToTop(line) {
      const editor = editorRef.current
      const root = editor ? activeEditorElement(editor) : null
      const source = latestMarkdown.current.split("\n")[Math.max(0, line - 1)]?.replace(/^\s*(?:#{1,6}|[-*+] |\d+[.)] |> ?)/, "").trim()
      if (!root || !source) return false
      const target = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,div[data-block]"))
        .find((element) => element.textContent?.includes(source.slice(0, 24)))
      if (!target) return false
      target.scrollIntoView({ block: "start" })
      return true
    },
    selectAll() {
      const editor = editorRef.current
      const root = editor ? activeEditorElement(editor) : null
      if (!root) return
      const range = document.createRange()
      range.selectNodeContents(root)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      callbacks.current.onSelectionChange?.(true)
    },
    undo() {
      const editor = editorRef.current
      if (!editor) return
      editor.vditor.undo?.undo(editor.vditor)
      syncAfterCommand(editor)
    },
  }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let editor: Vditor | null = null
    let themeObserver: MutationObserver | null = null
    queueMicrotask(() => {
      if (disposed) return
      try {
        const theme = editorTheme()
        editor = new Vditor(host, {
          _lutePath: `${VDITOR_CDN}/dist/js/lute/lute.min.js`,
          after: () => {
            if (disposed || !editor) return
            editorRef.current = editor
            latestMarkdown.current = editor.getValue()
            appliedValue.current = latestMarkdown.current
            if (readOnly) editor.disabled()
            reportHistory(editor)
            void resolveImages(editor)
            themeObserver = new MutationObserver(() => {
              if (!editor || disposed) return
              const nextTheme = editorTheme()
              editor.setTheme(nextTheme, nextTheme === "dark" ? "dark" : "light", nextTheme === "dark" ? "github-dark" : "github")
            })
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
          },
          blur: () => callbacks.current.onSelectionChange?.(false),
          cache: { enable: false },
          cdn: VDITOR_CDN,
          height: "auto",
          input: (markdown) => {
            if (!disposed && editor) commitValue(editor, markdown)
          },
          keydown: () => {
            if (editor) queueMicrotask(() => { if (editor) reportCursor(editor) })
          },
          lang: "zh_CN",
          mode: "ir",
          placeholder: "开始写作…",
          preview: {
            delay: 120,
            hljs: { style: theme === "dark" ? "github-dark" : "github" },
            markdown: { gfmAutoLink: true, mark: true },
            mode: "editor",
            theme: { current: theme === "dark" ? "dark" : "light", path: `${VDITOR_CDN}/dist/css/content-theme` },
          },
          select: (selected) => {
            callbacks.current.onSelectionChange?.(Boolean(selected))
            if (editor) reportCursor(editor)
          },
          theme,
          toolbar: TOOLBAR,
          toolbarConfig: { pin: true },
          undoDelay: 400,
          unSelect: () => {
            callbacks.current.onSelectionChange?.(false)
            if (editor) reportCursor(editor)
          },
          upload: {
            accept: "image/*,.pdf,.txt,.md,.zip",
            handler: (files) => {
              if (readOnlyRef.current || !callbacks.current.onInsertFiles) return "当前笔记不能插入附件"
              callbacks.current.onInsertFiles(files)
              return null
            },
            multiple: true,
          },
          value,
        })
      } catch (creationError) {
        if (!disposed) setError(creationError instanceof Error ? creationError.message : "Vditor 初始化失败")
      }
    })
    return () => {
      disposed = true
      themeObserver?.disconnect()
      if (historyTimer.current !== null) window.clearTimeout(historyTimer.current)
      if (editorRef.current === editor) editorRef.current = null
      if (editor?.vditor?.element) editor.destroy()
      for (const url of objectUrls.current.values()) URL.revokeObjectURL(url)
      objectUrls.current.clear()
      callbacks.current.onSelectionChange?.(false)
    }
  }, [sessionKey])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (readOnly) editor.disabled()
    else editor.enable()
  }, [readOnly])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || value === appliedValue.current || value === latestMarkdown.current) return
    editor.setValue(value, true)
    latestMarkdown.current = value
    appliedValue.current = value
    reportHistory(editor)
    queueMicrotask(() => { void resolveImages(editor) })
  }, [value])

  return (
    <div
      className="swell-vditor-editor"
      data-readonly={readOnly || undefined}
      onKeyUpCapture={() => { const editor = editorRef.current; if (editor) queueMicrotask(() => reportCursor(editor)) }}
      onPointerUpCapture={() => { const editor = editorRef.current; if (editor) queueMicrotask(() => reportCursor(editor)) }}
    >
      {error ? <p className="swell-vditor-error" role="alert">{error}</p> : null}
      <div ref={hostRef} />
    </div>
  )
})

export default VditorEditor
