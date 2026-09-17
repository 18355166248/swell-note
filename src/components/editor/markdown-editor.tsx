import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { syntaxTree } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { undo, redo, undoDepth, redoDepth } from "@codemirror/commands"
import type { EditorState, SelectionRange } from "@codemirror/state"
import { EditorView, type DecorationSet } from "@codemirror/view"

import { writeClipboardText } from "@/services/clipboard/clipboard-text"
import { collectClipboardFiles, readClipboardContent, readClipboardEvent, validateClipboardFiles } from "@/services/clipboard/clipboard-content"
import type { VaultAsset } from "@/services/vault/vault-adapter"

import { bottomOverlayHeight, scrollCursorIntoView } from "./cursor-visibility"
import { applyLinkTarget, detectFormatState, focusExistingLinkUrl, linkInsertion, linkTargetAt, linkTargetInText, removeLinkTarget, type EditorFormatState, type EditorLinkTarget, type InlineMarkKind, markdownInputEnhancements, toggleBlockFormat, toggleInlineMark, wrapSelectionAsLink } from "./markdown-input"
import { htmlToMarkdown, isInlineMarkdownFragment } from "./html-to-markdown"
import { buildLivePreviewDecorationsForRanges, markdownLivePreview, type EditorLinkTap } from "./live-preview"
import type { EmbeddedWikiNoteResult } from "./markdown-preview"
import { wikiLinkCompletion, type WikiLinkSuggestion } from "./wiki-link-completion"
import { ImageZoomOverlay } from "./image-zoom"
import { activeTableEdit } from "./table-edit-target"
import { rememberEditorSession, restoreEditorSession } from "./editor-session"
import { selectionRenderingExtensions } from "./selection-rendering"
import "./markdown-table.css"

import { TABLE_INSERT_TEMPLATE, type LinkCellSnapshot, type MarkdownEditorHandle, type MarkdownFindResult } from "./editor-contract"

export { TABLE_INSERT_TEMPLATE }
export type { LinkCellSnapshot, MarkdownEditorHandle, MarkdownFindResult }

export { shouldDrawCodeMirrorSelection } from "./selection-rendering"

// 链接面板在表格单元格编辑中打开时的现场快照：保存前校验单元格内容未变，
// 取消时据此把焦点与选区还给单元格 textarea。
// 一次装饰更新里可能同时挂着好几张表格的 wrapper，用起点行号才能挑出这次刚插入的那一张。
export function findTableWrapperAtLine(root: ParentNode, lineStart: number): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(".cm-md-table-wrap"))
    .find((candidate) => Number(candidate.dataset.tableFrom) === lineStart) ?? null
}

// 新表格插入后光标停在整段 Markdown 之后，用户还得再点一次单元格才能改表头，
// 体验上比"插入即可编辑"的其它模板慢一拍。这里等表格 Widget 渲染完，
// 直接程序化点击第一个表头格，沿用单元格光标编辑路径。
function focusFirstTableHeaderCell(view: EditorView, insertFrom: number) {
  window.setTimeout(() => {
    const lineStart = view.state.doc.lineAt(Math.min(insertFrom, view.state.doc.length)).from
    const wrapper = findTableWrapperAtLine(view.contentDOM, lineStart)
    wrapper?.querySelector<HTMLElement>("th")?.click()
  }, 0)
}

// 链接面板写单元格：目标仍是当前活动单元格且内容没被改动过才落笔，
// 任一不满足都返回 false 让面板保留输入，而不是写到已过期的位置上。
function applyCellLink(view: EditorView, cell: LinkCellSnapshot, target: EditorLinkTarget | null, label: string, url: string): boolean {
  if (activeTableEdit(view) !== cell.target || cell.target.input.value !== cell.value) return false
  const inserted = linkInsertion(target, label, url)
  if (!inserted) return false
  delete cell.target.input.dataset.contextMenuActive
  cell.target.replace(target?.from ?? cell.from, target?.to ?? cell.to, inserted)
  return true
}

type MarkdownEditorProps = {
  sessionKey?: string
  onHistoryChange?: (undo: boolean, redo: boolean) => void
  onEditingTargetChange?: (table: boolean) => void
  compact?: boolean
  onChange: (value: string) => void
  onCursorChange?: (line: number, column: number) => void
  // 光标 / 选区的格式状态（工具栏高亮）；表格单元格编辑时由单元格汇报行内格式。
  onFormatStateChange?: (state: EditorFormatState | null) => void
  onInsertFiles?: (files: File[], position?: number) => void
  onPasteError?: (message: string) => void
  // 移动端点按已有链接时不直接跳转，交给宿主弹出「打开 / 编辑 / 移除」菜单。
  onLinkMenu?: (tap: EditorLinkTap) => void
  onLoadWikiNote?: (target: string) => void
  onOpenWikiLink?: (target: string) => void
  onResolveAsset?: (source: string) => Promise<VaultAsset | null>
  onResolveWikiNote?: (target: string) => EmbeddedWikiNoteResult
  onSelectionChange?: (hasSelection: boolean) => void
  getWikiLinkSuggestions?: () => WikiLinkSuggestion[]
  readOnly?: boolean
  storageKey?: string
  value: string
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ sessionKey, onHistoryChange, onEditingTargetChange, onFormatStateChange, onLinkMenu, onPasteError, compact = false, getWikiLinkSuggestions, onChange, onCursorChange, onInsertFiles, onLoadWikiNote, onOpenWikiLink, onResolveAsset, onResolveWikiNote, onSelectionChange, readOnly = false, storageKey, value }, ref) {
    const editorRef = useRef<ReactCodeMirrorRef>(null)
    const sessionKeyRef = useRef(sessionKey)
    sessionKeyRef.current = sessionKey
    const insertionMarks = useRef(new Set<{ anchor?: number; from: number; head?: number; to: number }>())
    const [initialState] = useState(() => restoreEditorSession(sessionKey, value))
    const [theme, setTheme] = useState<"dark" | "light">(() => document.documentElement.classList.contains("dark") ? "dark" : "light")
    useEffect(() => {
      const observer = new MutationObserver(() => setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light"))
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
      return () => observer.disconnect()
    }, [])

    // CodeMirror 的扩展数组一旦换引用就会整体重配置（语言也会重新解析）；
    // 调用方传入的回调多为内联函数，用 ref 中转后扩展只在只读状态切换时重建。
    const handlers = useRef({ getWikiLinkSuggestions, onCursorChange, onFormatStateChange, onInsertFiles, onLinkMenu, onLoadWikiNote, onOpenWikiLink, onPasteError, onResolveAsset, onResolveWikiNote, onSelectionChange, onHistoryChange })
    useEffect(() => {
      handlers.current = { getWikiLinkSuggestions, onCursorChange, onFormatStateChange, onInsertFiles, onLinkMenu, onLoadWikiNote, onOpenWikiLink, onPasteError, onResolveAsset, onResolveWikiNote, onSelectionChange, onHistoryChange }
    })

    // 切换笔记会按 key 重建编辑器，卸载时要撤回选区状态，新笔记才不会带着上一篇的选区操作条打开。
    useEffect(() => () => handlers.current.onSelectionChange?.(false), [])

    useEffect(() => {
      const viewport = window.visualViewport
      if (!compact || !viewport) return
      // 键盘升起会把可视区压掉一半，此前落在下半屏的光标就藏到了键盘后面。
      // 布局要等 --keyboard-inset 写入后才是最终高度，所以推迟一帧再量。
      let frame = 0
      const follow = () => {
        frame = 0
        const view = editorRef.current?.view
        if (view?.hasFocus) scrollCursorIntoView(view)
      }
      const schedule = () => {
        if (frame) return
        frame = requestAnimationFrame(follow)
      }
      viewport.addEventListener("resize", schedule)
      return () => {
        if (frame) cancelAnimationFrame(frame)
        viewport.removeEventListener("resize", schedule)
      }
    }, [compact])

    const extensions = useMemo(() => [
      // GFM 基座：表格、删除线与任务列表才能进入语法树，供语法高亮与即时渲染装饰使用。
      // codeLanguages 让围栏代码块按 info 字符串套用对应语言的高亮，与阅读态保持一致；
      // 各语言由官方的 language-data 按需动态加载，不写代码块的笔记不会为此付出代价。
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      markdownLivePreview({
        assetScope: storageKey,
        onLoadWikiNote: (target) => handlers.current.onLoadWikiNote?.(target),
        onOpenWikiLink: (target) => handlers.current.onOpenWikiLink?.(target),
        // 移动端点按链接交给宿主菜单（打开/编辑/移除），桌面端与只读笔记维持单击直接打开。
        onLinkTap: compact && !readOnly ? (tap) => {
          const menu = handlers.current.onLinkMenu
          if (!menu) return false
          menu(tap)
          return true
        } : undefined,
        onResolveAsset: (source) => handlers.current.onResolveAsset?.(source) ?? Promise.resolve(null),
        onResolveWikiNote: (target) => handlers.current.onResolveWikiNote?.(target) ?? { status: "missing" },
        onTableFormatState: (state) => handlers.current.onFormatStateChange?.(state ? { ...state, heading: 0 } : null),
        tableStorageKey: storageKey,
      }),
      // 列表 / 引用回车续写、结构行 Tab 缩进、选中文字敲 * ` ~ 即包裹。
      markdownInputEnhancements(),
      wikiLinkCompletion(() => handlers.current.getWikiLinkSuggestions?.() ?? []),
      selectionRenderingExtensions(),
      EditorView.lineWrapping,
      EditorView.scrollHandler.of((view, range, options) => {
        const viewport = view.dom.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
        if (!viewport) return false
        // 正文使用外层 ScrollArea，默认 CodeMirror 滚动无法定位屏外命中。
        // 行块位置在虚拟行尚未挂载时也可用；这里仅滚动，不在测量阶段 dispatch。
        const block = view.lineBlockAt(range.head)
        const top = view.documentTop + block.top
        const bottom = top + block.height
        const visible = viewport.getBoundingClientRect()
        // 手机上键盘之上有格式栏/选区条压底，固定边距会把文末行留在条子后面。
        const bottomMargin = compact ? 24 + bottomOverlayHeight(view.dom) : 24
        let delta = 0
        if (options.y === "start") delta = top - visible.top - options.yMargin
        else if (options.y === "end") delta = bottom - visible.bottom + options.yMargin
        else if (options.y === "center") delta = (top + bottom - visible.top - visible.bottom) / 2
        else if (top < visible.top + 24) delta = top - visible.top - 24
        else if (bottom > visible.bottom - bottomMargin) delta = bottom - visible.bottom + bottomMargin
        if (delta) viewport.scrollTop += delta
        return true
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) for (const mark of insertionMarks.current) {
          mark.from = update.changes.mapPos(mark.from, 1)
          mark.to = Math.max(mark.from, update.changes.mapPos(mark.to, -1))
          // 「选区是否保持不动」的对照点随同一事务映射，用户在书签前输入不会误判成动过选区。
          if (mark.anchor !== undefined) mark.anchor = update.changes.mapPos(mark.anchor, 1)
          if (mark.head !== undefined) mark.head = update.changes.mapPos(mark.head, -1)
        }
        rememberEditorSession(sessionKey, update.state)
        if (update.docChanged) handlers.current.onHistoryChange?.(undoDepth(update.state) > 0, redoDepth(update.state) > 0)
        if (!update.selectionSet && !update.docChanged) return
        const position = update.state.selection.main.head
        const line = update.state.doc.lineAt(position)
        handlers.current.onCursorChange?.(line.number, position - line.from + 1)
        handlers.current.onSelectionChange?.(!update.state.selection.main.empty)
        // 工具栏高亮跟随光标与选区；表格单元格编辑时由单元格自己的汇报接管。
        if (!activeTableEdit(update.view)) handlers.current.onFormatStateChange?.(detectFormatState(update.state))
        // 打字打到可视区边缘、或光标跳到远处时同样要跟过去，否则又落到键盘后面。
        if (compact && update.view.hasFocus) scrollCursorIntoView(update.view)
      }),
      EditorView.domEventHandlers({
        copy(event, view) {
          if (isEditableFormControl(event.target)) return false
          if (!hasEditorClipboardContext(view)) return false
          const selected = selectedMarkdownRanges(view)
          if (selected.length === 0) return false
          if (!writeClipboardEventText(event, selected.map((range) => range.text).join("\n"))) return false
          event.preventDefault()
          return true
        },
        cut(event, view) {
          if (isEditableFormControl(event.target) || view.state.readOnly) return false
          if (!hasEditorClipboardContext(view)) return false
          const selected = selectedMarkdownRanges(view)
          if (selected.length === 0) return false
          // 原生 cut 只有先写入剪贴板才允许删除；写入失败时吞掉事件，避免默认路径删掉但没复制成功。
          if (!writeClipboardEventText(event, selected.map((range) => range.text).join("\n"))) {
            event.preventDefault()
            return true
          }
          event.preventDefault()
          view.dispatch({
            changes: selected.map((range) => ({ from: range.from, to: range.to })),
            selection: { anchor: selected[0].from },
            userEvent: "delete.cut",
          })
          return true
        },
        // CodeMirror 的选区不随失焦清空：点走标题输入框后选区高亮已经没了，
        // 选区操作条却会继续占着底部，所以焦点变化时同步汇报一次。
        blur() {
          handlers.current.onSelectionChange?.(false)
          return false
        },
        focus(_event, view) {
          handlers.current.onSelectionChange?.(!view.state.selection.main.empty)
          return false
        },
        // 正文以表格结尾时，点最后一块下方的空白本该在表格后面接着写，
        // 但紧邻表格的那一行会被 Markdown 并进表格，先补出空行再落光标。
        // 其余情况交给 CodeMirror 自己定位，拖选等原生行为保持不变。
        mousedown(event, view) {
          if (event.button !== 0 || event.shiftKey || event.target !== view.contentDOM) return false
          if (view.state.readOnly) return false
          const lastBlock = view.lineBlockAt(view.state.doc.length)
          if (event.clientY <= view.documentTop + lastBlock.bottom) return false
          const separator = paragraphSeparatorAtEnd(view.state)
          if (!separator) return false
          event.preventDefault()
          const end = view.state.doc.length
          view.dispatch({
            changes: { from: end, insert: separator },
            scrollIntoView: true,
            selection: { anchor: end + separator.length },
          })
          view.focus()
          return true
        },
        drop(event, view) {
          const onInsertFiles = handlers.current.onInsertFiles
          const files = collectClipboardFiles(event.dataTransfer)
          if (!onInsertFiles || readOnly || files.length === 0) return false
          event.preventDefault()
          // 附件落在拖放指向的位置（与 CodeMirror dropCursor 的指示一致），不用旧光标。
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
          onInsertFiles(files, position ?? undefined)
          return true
        },
        paste(event, view) {
          const clipboard = readClipboardEvent(event.clipboardData)
          const text = clipboard.text
          // 代码范围中的粘贴必须保持字面内容：URL 不能包成链接，HTML 也不能转换成强调/列表。
          // 返回 false 交给 CodeMirror 原生粘贴，可保留一次撤销且不改动选区之外的文本。
          if (!readOnly && shouldPasteAsPlainText(view.state)) return false
          // 选中文字时粘一个链接，直接包成 [选中文字](URL)。
          if (text && !readOnly && wrapSelectionAsLink(view, text)) {
            event.preventDefault()
            return true
          }
          // 截图与图片文件的剪贴板不带纯文本；Excel 等来源同时带文本时仍按普通粘贴处理。
          const onInsertFiles = handlers.current.onInsertFiles
          const files = clipboard.files
          if (files.length > 0 && ((!text && !clipboard.html) || isImageClipboardWithIncidentalName(files, text, clipboard.html))) {
            if (!onInsertFiles || readOnly) return false
            try { validateClipboardFiles(files) }
            catch (error) {
              event.preventDefault()
              handlers.current.onPasteError?.(error instanceof Error ? error.message : "剪贴板文件无法插入")
              return true
            }
            event.preventDefault()
            onInsertFiles(files)
            return true
          }
          // 网页/Office 的混合剪贴板继续进入 HTML 转 Markdown；其中附带的资源文件不是用户要插入的附件。
          // 富文本（网页 / Word / Excel）粘贴：HTML 转成 Markdown 后插入；
          // 转换失败或没有可用结构时返回 null，走原生纯文本粘贴，内容不丢。
          if (!readOnly) {
            const html = clipboard.html
            const markdown = html ? htmlToMarkdown(html) : null
            if (markdown) {
              event.preventDefault()
              const range = view.state.selection.main
              // 行内片段（单个加粗词、链接等）原位插入，不拆当前段落。
              // 块级结构（标题/列表/表格等）必须落在独立行上：插入点两侧不在行边界时补空行，
              // 否则表格尾行会和后面的文字粘成一行，被表格语法吞掉（内容看似丢失）。
              if (isInlineMarkdownFragment(markdown)) {
                view.dispatch({
                  changes: { from: range.from, to: range.to, insert: markdown },
                  selection: { anchor: range.from + markdown.length },
                  scrollIntoView: true,
                  userEvent: "input.paste",
                })
                return true
              }
              const doc = view.state.doc
              const prevChar = range.from > 0 ? doc.sliceString(range.from - 1, range.from) : "\n"
              const prevPrevChar = range.from > 1 ? doc.sliceString(range.from - 2, range.from - 1) : "\n"
              const nextChar = range.to < doc.length ? doc.sliceString(range.to, range.to + 1) : "\n"
              const nextNextChar = range.to + 1 < doc.length ? doc.sliceString(range.to + 1, range.to + 2) : "\n"
              const prefix = prevChar === "\n" ? (prevPrevChar === "\n" ? "" : "\n") : "\n\n"
              const suffix = nextChar === "\n" ? (nextNextChar === "\n" ? "" : "\n") : "\n\n"
              const insert = prefix + markdown + suffix
              view.dispatch({
                changes: { from: range.from, to: range.to, insert },
                // 光标落在插入内容之后（含补的空行），后续输入不会粘进表格/标题行。
                selection: { anchor: range.from + insert.length },
                scrollIntoView: true,
                userEvent: "input.paste",
              })
              return true
            }
          }
          // macOS WebView 的 paste 事件可能完全不暴露图片；仅在事件确实为空时才显式读原生剪贴板，
          // 普通文字粘贴不会触发权限调用。异步结果会在落笔前核验原文、选区和编辑器实例。
          if (!readOnly && !text && !clipboard.html && handlers.current.onInsertFiles) {
            event.preventDefault()
            const onInsertFiles = handlers.current.onInsertFiles
            const pasteSessionKey = sessionKey
            const pasteState = view.state
            void pasteClipboardAtSnapshot(
              view,
              onInsertFiles,
              handlers.current.onPasteError,
              () => editorRef.current?.view === view
                && sessionKeyRef.current === pasteSessionKey
                && handlers.current.onInsertFiles === onInsertFiles
                && view.dom.isConnected
                && !view.state.readOnly
                && view.state.doc === pasteState.doc
                && view.state.selection.eq(pasteState.selection),
            )
            return true
          }
          return false
        },
        keydown(event, view) {
          if (event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return false
          const key = event.key.toLocaleLowerCase()
          if (key === "s") {
            // 文档变化已实时进入本地工作副本；拦截浏览器“保存网页”即可避免误操作。
            event.preventDefault()
            return true
          }
          if (view.state.readOnly) return false
          if (key === "k" && !event.shiftKey) {
            event.preventDefault()
            // 光标没有选区、正落在已有链接文字里时改地址，而不是在原文字中间插一段新链接。
            if (focusExistingLinkUrl(view)) return true
            // 选中文字则作为链接文案，否则用占位文案；两种情况都把 https:// 选中，方便直接粘地址。
            const range = view.state.selection.main
            const label = view.state.sliceDoc(range.from, range.to) || "链接文字"
            const inserted = `[${label}](https://)`
            const urlFrom = range.from + label.length + 3
            view.dispatch({
              changes: { from: range.from, to: range.to, insert: inserted },
              selection: { anchor: urlFrom, head: urlFrom + 8 },
              scrollIntoView: true,
            })
            view.focus()
            return true
          }
          if (key !== "b" && key !== "i") return false
          event.preventDefault()
          return toggleInlineMark(view, key === "b" ? "strong" : "emphasis", key === "b" ? "加粗文字" : "斜体文字")
        },
      }),
    ], [compact, readOnly, storageKey, sessionKey])

    useImperativeHandle(ref, () => ({
      applyLink(target, label, url, cell) {
        const view = editorRef.current?.view
        if (!view || readOnly) return false
        if (cell) return applyCellLink(view, cell, target, label, url)
        return applyLinkTarget(view, target, label, url)
      },
      captureInsertion(position) {
        const view = editorRef.current?.view
        const target = view ? activeTableEdit(view) : undefined
        const tableEnd = target?.input.closest<HTMLElement>(".cm-md-table-wrap")?.dataset.tableTo
        const oldLength = view?.state.doc.length ?? 0
        target?.commit()
        const range = view?.state.selection.main
        const end = tableEnd ? Number(tableEnd) + (view?.state.doc.length ?? 0) - oldLength : undefined
        // 书签永远是零宽插入点：有选区时取选区起点，选中文字原样保留；
        // position 是文件拖入的落点坐标换算结果，与当前光标无关。
        const at = end ?? position ?? range?.from ?? 0
        const mark = { anchor: end === undefined && position === undefined ? range?.anchor : undefined, from: at, head: end === undefined && position === undefined ? range?.head : undefined, to: at }
        // 上传期间按每次文档变化映射书签，单纯移动光标不会改变上传发起的位置。
        insertionMarks.current.add(mark)
        const dispose = () => { insertionMarks.current.delete(mark) }
        let settled = false
        return { dispose, insert(text: string) {
          dispose()
          // 书签只许落笔一次：迟到的重复回调（重试、双回调）不能重复插入。
          if (settled) return false
          settled = true
          if (!view?.dom.isConnected || view.state.readOnly) return false
          const { from, to } = mark
          const gap = paragraphSeparatorAt(view.state, from)
          const insert = "\n".repeat(Math.max(0, gap.length - (text.match(/^\n*/)?.[0].length ?? 0))) + text
          // 用户没动过选区（粘贴后等待）才把光标带到图片之后并滚动聚焦；
          // 等待期间已移到别处写作时只做正文变更，选区随事务映射，不打断输入。
          const selectionUntouched = mark.anchor !== undefined
            && view.state.selection.main.anchor === mark.anchor
            && view.state.selection.main.head === mark.head
          // 路由栈会保活上一页编辑器；异步附件可以继续写回它绑定的文档，
          // 但隐藏页绝不能在完成时抢焦点或滚动，否则当前笔记会突然跳动。
          const editorIsActive = !view.dom.closest("[inert]")
          if (selectionUntouched && editorIsActive) {
            view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.attachment", scrollIntoView: true })
            view.focus()
          } else {
            view.dispatch({ changes: { from, to, insert }, userEvent: "input.attachment" })
          }
          return true
        } }
      },
      collapseSelection() {
        const view = editorRef.current?.view
        if (!view || view.state.selection.main.empty) return
        // 不抢焦点：点空白与点标题输入框都会走到这里，抢回来会把刚给出去的焦点又夺走。
        view.dispatch({ selection: { anchor: view.state.selection.main.head } })
      },
      async copySelection() {
        const view = editorRef.current?.view
        const input = activeTableEdit(view)?.input
        const selected = input
          ? input.value.slice(input.selectionStart, input.selectionEnd)
          : selectedMarkdownRanges(view).map((range) => range.text).join("\n")
        if (!selected) return false
        return writeClipboardText(selected, "text")
      },
      async cutSelection() {
        const view = editorRef.current?.view
        const target = activeTableEdit(view)
        const ranges = target ? [] : selectedMarkdownRanges(view)
        const selected = target
          ? target.input.value.slice(target.input.selectionStart, target.input.selectionEnd)
          : ranges.map((range) => range.text).join("\n")
        if (!view || readOnly || !selected) return false
        const state = view.state
        const inputValue = target?.input.value
        const inputFrom = target?.input.selectionStart
        const inputTo = target?.input.selectionEnd
        if (!await writeClipboardText(selected, "text")) return false
        // 剪贴板授权可能异步返回；期间正文/选区变了就只复制，不删除任何新选区。
        if (target) {
          if (activeTableEdit(view) !== target || target.input.value !== inputValue || target.input.selectionStart !== inputFrom || target.input.selectionEnd !== inputTo) return false
          target.input.setRangeText("", inputFrom, inputTo, "end")
          target.commit()
        } else {
          if (view.state.doc !== state.doc || !view.state.selection.eq(state.selection) || view.state.readOnly || !view.dom.isConnected) return false
          view.dispatch({
            changes: ranges.map((range) => ({ from: range.from, to: range.to })),
            selection: { anchor: ranges[0].from },
            userEvent: "delete.cut",
          })
        }
        view.focus()
        return true
      },
      focus() {
        editorRef.current?.view?.focus()
      },
      findText(query, direction = "next", fromStart = false) {
        return findTextInView(editorRef.current?.view, query, direction, fromStart)
      },
      insertText(text) {
        const view = editorRef.current?.view
        if (!view || readOnly || !text) return

        const tableTarget = activeTableEdit(view)
        if (tableTarget) { tableTarget.format(text); return }
        if (toggleBlockFormat(view, text)) return
        if (text === "[链接](https://)" && focusExistingLinkUrl(view)) return

        // 加粗 / 斜体 / 删除线 / 行内代码走带「再点一次取消」的独立路径，其余模板保持原逻辑。
        const inlineMark = INLINE_MARK_TEMPLATES[text]
        if (inlineMark) {
          toggleInlineMark(view, inlineMark.kind, inlineMark.placeholder)
          return
        }

        // 格式工具栏优先包装当前选区；没有选区时才插入带占位文案的模板。
        const selection = view.state.selection.main
        const selected = view.state.sliceDoc(selection.from, selection.to)
        const formatted = formatToolbarText(text, selected)
        // 插入块或附件时补足表格边界，避免 GFM 把图片吞作下一行单元格。
        const gap = selection.empty ? paragraphSeparatorAt(view.state, selection.to) : ""
        const leading = gap ? Math.max(0, gap.length - (formatted.text.match(/^\n*/)?.[0].length ?? 0)) : 0
        if (leading) {
          formatted.text = "\n".repeat(leading) + formatted.text
          if (formatted.selection) { formatted.selection.from += leading; formatted.selection.to += leading }
        }
        const insertFrom = selection.from
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: formatted.text },
          selection: formatted.selection
            ? { anchor: selection.from + formatted.selection.from, head: selection.from + formatted.selection.to }
            : { anchor: selection.from + formatted.text.length },
          scrollIntoView: true,
        })
        view.focus()
        // 模板固定以换行开头，表格真正的第一行从插入点之后一个字符算起。
        if (text === TABLE_INSERT_TEMPLATE) focusFirstTableHeaderCell(view, insertFrom + leading + 1)
      },
      lineAtViewportTop(clientY) {
        const view = editorRef.current?.view
        if (!view) return null
        // 编辑器本身不滚动，可视区由外层容器决定，所以按屏幕坐标反查位置而不是读编辑器的滚动量。
        const bounds = view.contentDOM.getBoundingClientRect()
        const position = view.posAtCoords({ x: bounds.left + 1, y: clientY + 1 }, false)
        return position === null ? null : view.state.doc.lineAt(position).number
      },
      async pasteAtSelection() {
        const view = editorRef.current?.view
        if (!view || readOnly) return false
        const target = activeTableEdit(view)
        const state = view.state
        const onInsertFiles = handlers.current.onInsertFiles
        const pasteSessionKey = sessionKey
        const inputSnapshot = target ? { value: target.input.value, from: target.input.selectionStart, to: target.input.selectionEnd } : undefined
        const isCurrentPaste = () => editorRef.current?.view === view
          && sessionKeyRef.current === pasteSessionKey
          && handlers.current.onInsertFiles === onInsertFiles
          && view.dom.isConnected
          && !view.state.readOnly
          && view.state.doc === state.doc
          && view.state.selection.eq(state.selection)
          && (!target || (activeTableEdit(view) === target
            && target.input.value === inputSnapshot?.value
            && target.input.selectionStart === inputSnapshot.from
            && target.input.selectionEnd === inputSnapshot.to))
        let content
        try { content = await readClipboardContent() }
        catch (error) {
          if (isCurrentPaste()) handlers.current.onPasteError?.(error instanceof Error ? error.message : "读取剪贴板失败")
          return false
        }
        if (!isCurrentPaste()) return false
        const text = content.text
        if ((!text && content.files.length === 0) || !view.dom.isConnected) {
          if (view.dom.isConnected) handlers.current.onPasteError?.("剪贴板中没有可粘贴的内容")
          return false
        }
        if (!text && content.files.length > 0) {
          if (!onInsertFiles) return false
          if (shouldPasteAsPlainText(state)) {
            handlers.current.onPasteError?.("代码范围内不能插入图片")
            return false
          }
          // 回调也绑定在用户点击粘贴的那一刻；父级即使复用了编辑器实例并换了笔记，
          // 迟到结果也不会借用新笔记的附件写入函数。
          // 已确认选区未变化，交给 captureInsertion 记录 anchor/head；附件完成后光标才能跟到图片后，
          // live preview 随即把引用渲染成图片。显式 position 只留给真正的鼠标拖放落点。
          onInsertFiles(content.files)
          return true
        }
        if (!text) return false
        if (target) {
          target.input.setRangeText(text, target.input.selectionStart, target.input.selectionEnd, "end")
          target.input.dispatchEvent(new Event("input", { bubbles: true }))
          return true
        }
        // 菜单关闭 / 焦点恢复也会产生事务；只核验正文与选区，避免把无关状态更新误判为用户改写。
        const selection = view.state.selection.main
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: text },
          selection: { anchor: selection.from + text.length },
          scrollIntoView: true,
        })
        view.focus()
        return true
      },
      readLinkContext() {
        const view = editorRef.current?.view
        if (!view || readOnly) return null
        // 单元格编辑中 CodeMirror 的选区是进入单元格前的旧位置，链接必须写进单元格
        // textarea；面板输入框会抢走焦点，先挂 contextMenuActive 标记抑制 blur 时的
        // 自动提交，让未保存内容与选区在面板期间都留在原单元格里。
        const table = activeTableEdit(view)
        if (table) {
          const { input } = table
          const from = input.selectionStart ?? 0
          const to = input.selectionEnd ?? from
          input.dataset.contextMenuActive = "true"
          return {
            cell: { from, target: table, to, value: input.value },
            hadFocus: false,
            selectedText: input.value.slice(from, to),
            target: linkTargetInText(input.value, from, to),
          }
        }
        const range = view.state.selection.main
        return {
          hadFocus: view.hasFocus,
          selectedText: view.state.sliceDoc(range.from, range.to),
          target: linkTargetAt(view.state, range.from, range.to),
        }
      },
      redo() {
        runHistory(editorRef.current?.view, true)
      },
      removeLink(target, cell) {
        const view = editorRef.current?.view
        if (!view || readOnly) return false
        if (cell) {
          if (activeTableEdit(view) !== cell.target || cell.target.input.value !== cell.value) return false
          delete cell.target.input.dataset.contextMenuActive
          cell.target.replace(target.from, target.to, target.label)
          return true
        }
        return removeLinkTarget(view, target)
      },
      restoreCellFocus(cell) {
        if (!cell) return false
        const { input } = cell.target
        // 无论单元格是否还在，面板期间的抑制标记都要清掉，避免残留影响下一次 blur 提交。
        delete input.dataset.contextMenuActive
        if (!input.isConnected) return false
        input.focus({ preventScroll: true })
        input.setSelectionRange(cell.from, cell.to)
        return true
      },
      replaceAll(query, replacement) {
        const view = editorRef.current?.view
        if (!view || readOnly || !query) return 0
        const matches = findPlainTextMatches(view.state.doc.toString(), query)
        if (matches.length === 0) return 0
        // CodeMirror 以同一个 transaction 应用全部变更，整次替换可被一次撤销恢复。
        view.dispatch({
          changes: matches.map((match) => ({ from: match.from, insert: replacement, to: match.to })),
        })
        view.focus()
        return matches.length
      },
      replaceCurrent(query, replacement) {
        const view = editorRef.current?.view
        if (!view || readOnly || !query) return { current: 0, total: 0 }
        const selection = view.state.selection.main
        const selected = view.state.sliceDoc(selection.from, selection.to)
        if (selected.toLocaleLowerCase() !== query.toLocaleLowerCase()) {
          return findTextInView(view, query, "next", false)
        }
        view.dispatch({
          changes: { from: selection.from, insert: replacement, to: selection.to },
          selection: { anchor: selection.from + replacement.length },
        })
        return findTextInView(view, query, "next", false)
      },
      revealLine(line) {
        const view = editorRef.current?.view
        if (!view) return
        const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
        view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true })
        view.focus()
        // 键盘未升起时格式栏也占着底部，dispatch 的滚动不感知它；下一帧按可视带再校正一次。
        requestAnimationFrame(() => {
          const current = editorRef.current?.view
          if (current?.hasFocus) scrollCursorIntoView(current)
        })
      },
      scrollLineToTop(line) {
        const view = editorRef.current?.view
        if (!view) return false
        const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
        // 不动选区也不抢焦点：这是切换视图时的对位，手机上抢焦点会顺带把键盘顶起来。
        view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: "start" }) })
        return true
      },
      selectAll() {
        const view = editorRef.current?.view
        if (!view) return
        const table = activeTableEdit(view)
        if (table) { table.input.select(); return }
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
        view.focus()
      },
      undo() {
        runHistory(editorRef.current?.view, false)
      },
    }), [readOnly])

    return (
      <>
      <ImageZoomOverlay />
      <CodeMirror
        aria-label="Markdown 编辑器"
        basicSetup={{
          bracketMatching: true,
          closeBrackets: true,
          drawSelection: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          lineNumbers: false,
        }}
        editable={!readOnly}
        extensions={extensions}
        height="100%"
        initialState={initialState}
        theme={theme}
        onCreateEditor={(view) => {
          rememberEditorSession(sessionKey, view.state)
          handlers.current.onHistoryChange?.(undoDepth(view.state) > 0, redoDepth(view.state) > 0)
        }}
        onFocusCapture={(event) => onEditingTargetChange?.(Boolean((event.target as HTMLElement).closest(".cm-md-table-cell-input")))}
        onBlurCapture={() => queueMicrotask(() => onEditingTargetChange?.(Boolean(activeTableEdit(editorRef.current?.view))))}
        onChange={onChange}
        placeholder="开始记录你的想法…"
        readOnly={readOnly}
        ref={editorRef}
        value={value}
      />
      </>
    )
  },
)

function isImageClipboardWithIncidentalName(files: File[], text: string | null, html: string | null) {
  if (html || files.some((file) => !file.type.startsWith("image/"))) return false
  if (!text) return true
  const normalized = text.trim().replace(/^file:\/\//, "").split(/[\\/]/).pop()?.toLocaleLowerCase()
  return files.some((file) => normalized === file.name.toLocaleLowerCase())
}

async function pasteClipboardAtSnapshot(view: EditorView, onInsertFiles: (files: File[], position?: number) => void, onError?: (message: string) => void, isCurrent: () => boolean = () => true) {
  const state = view.state
  try {
    const content = await readClipboardContent()
    if (!isCurrent() || !view.dom.isConnected || view.state.doc !== state.doc || !view.state.selection.eq(state.selection) || view.state.readOnly) return false
    if (content.text) {
      const range = state.selection.main
      view.dispatch({ changes: { from: range.from, to: range.to, insert: content.text }, selection: { anchor: range.from + content.text.length }, scrollIntoView: true, userEvent: "input.paste" })
      return true
    }
    if (content.files.length > 0) {
      onInsertFiles(content.files)
      return true
    }
    if (isCurrent()) onError?.("剪贴板中没有可粘贴的内容")
  } catch (error) {
    if (isCurrent()) onError?.(error instanceof Error ? error.message : "读取剪贴板失败")
  }
  return false
}

export function selectedMarkdownRange(view: EditorView | undefined) {
  return selectedMarkdownRanges(view)[0] ?? null
}

function selectedMarkdownRanges(view: EditorView | undefined) {
  if (!view) return []
  const ranges = view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => normalizedMarkdownRange(view, range))
    .filter((range): range is { from: number; text: string; to: number } => range !== null)
  return mergeMarkdownRanges(view.state, ranges)
}

function mergeMarkdownRanges(state: EditorState, ranges: Array<{ from: number; text: string; to: number }>) {
  const merged: Array<{ from: number; text: string; to: number }> = []
  for (const range of [...ranges].sort((left, right) => left.from - right.from || left.to - right.to)) {
    const previous = merged[merged.length - 1]
    if (!previous || range.from > previous.to) {
      merged.push({ ...range })
      continue
    }
    previous.to = Math.max(previous.to, range.to)
    previous.text = state.sliceDoc(previous.from, previous.to)
  }
  return merged
}

function normalizedMarkdownRange(view: EditorView, range: SelectionRange) {
  let from = range.from
  let to = range.to
  const line = view.state.doc.lineAt(from)
  const decorations = clipboardLineDecorations(view, range.from, range.to)
  const hiddenPrefixEnd = hiddenStructuralPrefixEnd(view.state, decorations, line.from, line.text)
  let expandedStart = false
  // 即时预览只在源码标记被真实替换时才需要补范围；并且必须覆盖首项可见整行，
  // 否则从正文开头随手选几个字也会被误升级成整条 Markdown。
  if (
    hiddenPrefixEnd !== null
    && from >= hiddenPrefixEnd
    && rangeFullyHiddenSourceMarks(decorations, hiddenPrefixEnd, from)
    && selectionCoversVisibleLineEnd(decorations, to, line.to)
  ) {
    from = line.from
    expandedStart = true
  }
  const endLine = view.state.doc.lineAt(to)
  if ((expandedStart || range.from < endLine.from) && to < endLine.to && rangeFullyHiddenSourceMarks(decorations, to, endLine.to)) to = endLine.to
  if (from >= to) return null
  return { from, text: view.state.sliceDoc(from, to), to }
}

function clipboardLineDecorations(view: EditorView, from: number, to: number) {
  const startLine = view.state.doc.lineAt(from)
  const endLine = view.state.doc.lineAt(to)
  const ranges = startLine.number === endLine.number
    ? [{ from: startLine.from, to: startLine.to }]
    : [{ from: startLine.from, to: startLine.to }, { from: endLine.from, to: endLine.to }]
  return buildLivePreviewDecorationsForRanges(view, ranges)
}

function hiddenStructuralPrefixEnd(state: EditorState, decorations: DecorationSet, lineFrom: number, text: string) {
  const candidateEnd = structuralHiddenLineContentStart(text)
  if (candidateEnd === null) return null
  const to = lineFrom + candidateEnd
  return isStructuralMarkdownLine(state, lineFrom, to) && prefixNonWhitespaceHiddenByReplacement(state, decorations, lineFrom, to) ? to : null
}

function structuralHiddenLineContentStart(text: string) {
  let offset = 0
  let structural = false
  while (offset < text.length) {
    const quote = text.slice(offset).match(/^(?: {0,3}>\s?)/)
    if (!quote) break
    offset += quote[0].length
    structural = true
  }
  const rest = text.slice(offset)
  const heading = rest.match(/^#{1,6}\s+/)
  const task = rest.match(/^[ \t]*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s+/)
  const unordered = rest.match(/^[ \t]*[-+*]\s+/)
  const mark = heading?.[0] ?? task?.[0] ?? unordered?.[0]
  if (mark) {
    offset += mark.length
    structural = true
  }
  return structural && offset > 0 && offset <= text.length ? offset : null
}

function selectionCoversVisibleLineEnd(decorations: DecorationSet, to: number, lineTo: number) {
  if (to >= lineTo) return true
  return rangeFullyHiddenSourceMarks(decorations, to, lineTo)
}

function prefixNonWhitespaceHiddenByReplacement(state: EditorState, decorations: DecorationSet, from: number, to: number) {
  if (from >= to) return false
  const hidden: Array<{ from: number; to: number }> = []
  decorations.between(from, to, (rangeFrom, rangeTo, decoration) => {
    if (rangeFrom < rangeTo && isReplacementDecoration(decoration.spec)) hidden.push({ from: rangeFrom, to: rangeTo })
  })
  for (let position = from; position < to; position += 1) {
    if (state.sliceDoc(position, position + 1).trim() === "") continue
    if (!hidden.some((range) => position >= range.from && position < range.to)) return false
  }
  return hidden.length > 0
}

function rangeFullyHiddenSourceMarks(decorations: DecorationSet, from: number, to: number) {
  if (from >= to) return true
  let cursor = from
  decorations.between(from, to, (rangeFrom, rangeTo, decoration) => {
    if (!isSourceHiddenDecoration(decoration.spec) || rangeFrom > cursor) return
    cursor = Math.max(cursor, rangeTo)
  })
  return cursor >= to
}

function isReplacementDecoration(spec: Record<string, unknown>) {
  return !("class" in spec) && (!("attributes" in spec) || !spec.attributes)
}

function isSourceHiddenDecoration(spec: Record<string, unknown>) {
  return isReplacementDecoration(spec) && (!("widget" in spec) || !spec.widget)
}

function writeClipboardEventText(event: ClipboardEvent, text: string) {
  if (!event.clipboardData || !text) return false
  try {
    event.clipboardData.clearData()
    event.clipboardData.setData("text/plain", text)
    return true
  } catch {
    return false
  }
}

function hasEditorClipboardContext(view: EditorView) {
  const selection = document.getSelection()
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const anchor = selection.anchorNode
    const focus = selection.focusNode
    return !!anchor && !!focus && view.contentDOM.contains(anchor) && view.contentDOM.contains(focus)
  }
  return view.hasFocus || view.dom.contains(document.activeElement)
}

function isEditableFormControl(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

function isStructuralMarkdownLine(state: EditorState, lineFrom: number, contentStart: number) {
  for (let node: MdNode | null = syntaxTree(state).resolveInner(Math.min(contentStart, state.doc.length), -1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "Table") return false
    if (node.name === "Blockquote" || node.name === "ListItem" || /^ATXHeading[1-6]$/.test(node.name)) return true
  }
  for (let node: MdNode | null = syntaxTree(state).resolveInner(lineFrom, 1); node; node = node.parent) {
    if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "Table") return false
    if (node.name === "Blockquote" || node.name === "ListItem" || /^ATXHeading[1-6]$/.test(node.name)) return true
  }
  return false
}

// 只用到节点名与父链；按结构声明，避免为类型引入 @lezer/common 显式依赖。
type MdNode = { name: string; parent: MdNode | null }

function isInsideTable(state: EditorState, position: number) {
  for (let node: MdNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name === "Table") return true
  }
  return false
}

export function shouldPasteAsPlainText(state: EditorState) {
  const range = state.selection.main
  const positions = range.empty ? [range.head] : [range.from, Math.max(range.from, range.to - 1)]
  return positions.every((position) => {
    for (let node: MdNode | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
      if (node.name === "InlineCode" || node.name === "FencedCode" || node.name === "CodeBlock") return true
    }
    return false
  })
}

// 在表格末行、或紧邻其后的空行插入块时都需要边界，不能只处理文档末尾。
function paragraphSeparatorAt(state: EditorState, position: number) {
  const line = state.doc.lineAt(position)
  if (position === line.to && isInsideTable(state, line.from)) return "\n\n"
  if (!line.text.trim() && line.number > 1 && isInsideTable(state, state.doc.line(line.number - 1).from)) return "\n"
  return ""
}

// 表格会把紧随其后的非空行并进自己，只有隔开一个空行，新写的内容才是独立段落。
export function paragraphSeparatorAtEnd(state: EditorState) {
  const { doc } = state
  const lastLine = doc.line(doc.lines)
  if (lastLine.text.trim() !== "") return isInsideTable(state, lastLine.from) ? "\n\n" : ""
  if (doc.lines < 2) return ""
  const previous = doc.line(doc.lines - 1)
  if (previous.text.trim() === "") return ""
  return isInsideTable(state, previous.from) ? "\n" : ""
}


export function findPlainTextMatches(text: string, query: string) {
  if (!query) return []
  const matches: Array<{ from: number; to: number }> = []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu")
  for (const match of text.matchAll(pattern)) {
    const from = match.index
    matches.push({ from, to: from + match[0].length })
  }
  return matches
}

function findTextInView(
  view: EditorView | undefined,
  query: string,
  direction: "next" | "previous",
  fromStart: boolean,
): MarkdownFindResult {
  if (!view || !query) return { current: 0, total: 0 }
  const matches = findPlainTextMatches(view.state.doc.toString(), query)
  if (matches.length === 0) return { current: 0, total: 0 }

  const selection = view.state.selection.main
  let index = 0
  if (!fromStart && direction === "next") {
    index = matches.findIndex((match) => match.from >= selection.to)
    if (index < 0) index = 0
  } else if (!fromStart) {
    index = matches.length - 1
    while (index >= 0 && matches[index].to > selection.from) index -= 1
    if (index < 0) index = matches.length - 1
  }
  const match = matches[index]
  // 查找栏需要持续接收键盘输入；这里只移动编辑器选区，不抢回输入框焦点。
  view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true })
  return { current: index + 1, total: matches.length }
}

// 工具栏的加粗 / 斜体 / 删除线 / 行内代码按钮走 toggleInlineMark，选区已在对应标记里时可以取消。
const INLINE_MARK_TEMPLATES: Record<string, { kind: InlineMarkKind; placeholder: string }> = {
  "**加粗文字**": { kind: "strong", placeholder: "加粗文字" },
  "*斜体文字*": { kind: "emphasis", placeholder: "斜体文字" },
  "~~删除线文字~~": { kind: "strike", placeholder: "删除线文字" },
  "`行内代码`": { kind: "code", placeholder: "行内代码" },
}

// 工具栏模板 → 包裹选中文字用的前后缀。没有选区时按原模板（含占位文案）整段插入。
const WRAP_TEMPLATES: Record<string, [string, string]> = {
  "**加粗文字**": ["**", "**"],
  "*斜体文字*": ["*", "*"],
  "~~删除线文字~~": ["~~", "~~"],
  "`行内代码`": ["`", "`"],
}

export function formatToolbarText(template: string, selected: string) {
  if (template === "[链接](https://)") {
    const label = selected || "链接"
    const from = label.length + 3
    return { text: `[${label}](https://)`, selection: { from, to: from + 8 } }
  }
  if (template === "\n```\n\n```\n") {
    return { text: `\n\`\`\`\n${selected}\n\`\`\`\n`, selection: { from: 5, to: 5 + selected.length } }
  }
  if (!selected) return { text: template }
  const wrap = WRAP_TEMPLATES[template]
  if (wrap) return { text: `${wrap[0]}${selected}${wrap[1]}` }

  const prefix = template.match(/^\n(#{1,3} |> |- |- \[ \] )$/)?.[1]
  if (prefix) return { text: selected.split("\n").map((line) => `${prefix}${line}`).join("\n") }
  return { text: template }
}

function runHistory(view: EditorView | undefined, forward: boolean) {
  if (!view || view.state.readOnly) return
  const target = activeTableEdit(view)
  // 未提交的单元格先形成同一份文档历史，再执行撤销；不能只撤销正文而留下悬空的 textarea。
  target?.commit()
  ;(forward ? redo : undo)(view)
  view.focus()
}

export default MarkdownEditor
